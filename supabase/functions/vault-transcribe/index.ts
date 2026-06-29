// vault-transcribe — port from Creative Vault (US-003).
// Differences from source:
//   • No workspace_id references — items are scoped by user_id directly.
//   • Called internally with service-role bearer by vault-extract / vault-save;
//     does its own work with service-role only, no end-user auth.
//
// Pipeline role: downloads the stored video (storage or remote URL), sends it
// to Groq Whisper, writes the raw transcript to inspiration_transcripts, then
// kicks vault-analyze for framework extraction. On unsupported media (no video,
// 413, or Groq "could not process") the item is marked ready without an error.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { isImageOnlyItem } from "../_shared/vault-save-logic.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
// Bounded ack window for the vault-analyze kick-off (same pattern as vault-save):
// await the dispatch long enough to guarantee it left this isolate, then let the
// slow remainder ride on waitUntil.
const KICKOFF_ACK_TIMEOUT_MS = 10_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const groqKey = Deno.env.get("GROQ_API_KEY");
  const db = createClient(supabaseUrl, serviceRoleKey);

  if (!groqKey) return json({ error: "GROQ_API_KEY not configured" }, 500);

  let itemId = "";
  try {
    const body = await req.json();
    itemId = body.item_id;
    if (!itemId) return json({ error: "item_id required" }, 400);

    const { data: item } = await db
      .from("inspiration_items")
      .select("id, file_path, thumbnail_path, video_url")
      .eq("id", itemId)
      .single();

    if (!item) return json({ error: "Item not found" }, 404);

    // Image-only items have no audio/video track to transcribe. vault-save-creative
    // sets file_path = the still-image path when there is no video (so file_path ===
    // thumbnail_path), and other paths can save an image as the primary file too.
    // Sending an image to Whisper returns 400 "no audio track found in file", which
    // previously threw and marked the item status='error' despite a successful save.
    // Detect this up front and finish the item cleanly — the thumbnail + snapshot
    // are already saved and viewable.
    if (isImageOnlyItem(item)) {
      await db.from("inspiration_items").update({ status: "ready" }).eq("id", itemId);
      return json({ ok: true, item_id: itemId, skipped_transcription: true, reason: "image_only" });
    }

    await db.from("inspiration_items").update({ status: "transcribing" }).eq("id", itemId);

    // Resolve video bytes — prefer stored file, fall back to original URL
    let videoBytes: ArrayBuffer;
    let ext = "mp4";

    if (item.file_path) {
      const { data: signedData } = await db.storage
        .from("inspiration-media")
        .createSignedUrl(item.file_path, 300);
      const signedUrl = signedData?.signedUrl;
      if (!signedUrl) throw new Error("Could not create signed URL for storage file");

      ext = item.file_path.endsWith(".webm") ? "webm" : "mp4";
      const dlRes = await fetch(signedUrl);
      if (!dlRes.ok) throw new Error(`Storage download failed: ${dlRes.status}`);
      videoBytes = await dlRes.arrayBuffer();
    } else if (item.video_url) {
      const dlRes = await fetch(item.video_url);
      if (!dlRes.ok) throw new Error(`Video download failed: ${dlRes.status}`);
      const ct = dlRes.headers.get("content-type") ?? "";
      ext = ct.includes("webm") ? "webm" : "mp4";
      videoBytes = await dlRes.arrayBuffer();
    } else {
      // No video on this item (e.g. Instagram image/carousel post scraped via
      // the metadata-only path). Mark ready without transcription — the thumbnail
      // and creator handle are already saved.
      await db.from("inspiration_items").update({ status: "ready" }).eq("id", itemId);
      return json({ ok: true, item_id: itemId, skipped_transcription: true, reason: "no_video" });
    }

    // POST bytes to Groq Whisper as multipart form
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([videoBytes], { type: `video/${ext}` }),
      `video.${ext}`,
    );
    formData.append("model", "whisper-large-v3-turbo");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    const groqRes = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey}` },
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      const lowerErr = errText.toLowerCase();
      // 413: file too large. 400 "could not process file": incompatible format.
      // 400 "no audio track found": the media has no audio (e.g. an image, or a
      // silent video) — nothing to transcribe. In all of these the media is saved
      // and viewable, so skip transcription and mark ready rather than erroring.
      if (
        groqRes.status === 413 ||
        (groqRes.status === 400 &&
          (lowerErr.includes("could not process") || lowerErr.includes("no audio track")))
      ) {
        await db.from("inspiration_items").update({ status: "ready" }).eq("id", itemId);
        return json({ ok: true, item_id: itemId, skipped_transcription: true, reason: "groq_unsupported" });
      }
      throw new Error(`Groq error ${groqRes.status}: ${errText}`);
    }

    const groqData = await groqRes.json();
    const rawTranscript = groqData.text ?? "";
    const wordCount = rawTranscript.split(/\s+/).filter(Boolean).length;

    await db.from("inspiration_transcripts").insert({
      item_id: itemId,
      raw_transcript: rawTranscript,
      duration_seconds: null,
      word_count: wordCount,
    });

    await db.from("inspiration_items").update({ status: "analyzing" }).eq("id", itemId);

    // Per policy (verdanote-edge-fn-no-waituntil-for-required-calls), this chain
    // must not be fire-and-forget: a silently dropped dispatch leaves the item
    // stuck at status='analyzing' forever. vault-analyze does its full Anthropic
    // work before responding, so a full await would extend this function's wall
    // clock by minutes. Bounded ack instead: await the dispatch for a short
    // window (guarantees the request left this isolate; immediate failures mark
    // the item errored so useItemStatus surfaces them), then let the in-flight
    // call ride on waitUntil — at that point vault-analyze owns item status.
    const markKickoffFailed = async (reason: string) => {
      console.error(`vault-transcribe: vault-analyze kick-off failed for item ${itemId}:`, reason);
      const { error: markError } = await db
        .from("inspiration_items")
        .update({ status: "error", error_message: `Analyze kick-off failed: ${reason}` })
        .eq("id", itemId);
      if (markError) console.error("vault-transcribe: failed to mark item errored:", markError);
    };

    const kickoff = (async () => {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/vault-analyze`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ item_id: itemId }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          await markKickoffFailed(`vault-analyze responded ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`);
        }
      } catch (e) {
        await markKickoffFailed(e instanceof Error ? e.message : String(e));
      }
    })();

    const TIMED_OUT = Symbol("kickoff-ack-timeout");
    let ackTimer: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      kickoff,
      new Promise((resolve) => {
        ackTimer = setTimeout(() => resolve(TIMED_OUT), KICKOFF_ACK_TIMEOUT_MS);
      }),
    ]);
    if (ackTimer !== undefined) clearTimeout(ackTimer);
    if (settled === TIMED_OUT) {
      EdgeRuntime.waitUntil(kickoff);
    }

    return json({ ok: true, item_id: itemId });
  } catch (err) {
    console.error("vault-transcribe error:", err);
    if (itemId) {
      await db
        .from("inspiration_items")
        .update({ status: "error", error_message: String(err) })
        .eq("id", itemId);
    }
    return json({ error: String(err) }, 500);
  }
});
