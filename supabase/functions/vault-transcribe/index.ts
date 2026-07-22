// vault-transcribe — port from Creative Vault (US-003).
// Differences from source:
//   • No workspace_id references — items are scoped by user_id directly.
//   • Called internally with service-role bearer by vault-extract / vault-save;
//     does its own work with service-role only, no end-user auth.
//
// Pipeline role: transcribes a saved creative's audio, writes the raw transcript
// to inspiration_transcripts, then kicks vault-analyze for framework extraction.
//
// PRIMARY: Deepgram /v1/listen by URL — Deepgram fetches the media itself and
// extracts audio server-side, so there is NO upload size cap (a 2-min 720p ad
// is ~28 MB of video but only ~1-2 MB of audio). FALLBACK: Groq Whisper via
// multipart upload, used when Deepgram is unconfigured/unavailable — works for
// small files, fails honestly (error, not silent skip) on files over its 25 MB
// cap. Image-only / no-audio media is detected and marked ready without an error.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { isImageOnlyItem } from "../_shared/vault-save-logic.ts";
import {
  classifyGroqFailure,
  extractDeepgramTranscript,
  tooLargeMessage,
} from "../_shared/vault-transcribe-logic.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen";
const DEEPGRAM_MODEL = Deno.env.get("DEEPGRAM_MODEL") ?? "nova-2";
// Bounded ack window for the vault-analyze kick-off (same pattern as vault-save):
// await the dispatch long enough to guarantee it left this isolate, then let the
// slow remainder ride on waitUntil.
const KICKOFF_ACK_TIMEOUT_MS = 10_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const groqKey = Deno.env.get("GROQ_API_KEY");
  const deepgramKey = Deno.env.get("DEEPGRAM_API_KEY");
  const db = createClient(supabaseUrl, serviceRoleKey);

  if (!groqKey && !deepgramKey) {
    return json(
      { error: "No transcription provider configured (set DEEPGRAM_API_KEY or GROQ_API_KEY)" },
      500,
    );
  }

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
      await db
        .from("inspiration_items")
        .update({ status: "ready", error_message: null })
        .eq("id", itemId);
      return json({ ok: true, item_id: itemId, skipped_transcription: true, reason: "image_only" });
    }

    // Clear any stale error from a prior failed attempt as we start fresh.
    await db
      .from("inspiration_items")
      .update({ status: "transcribing", error_message: null })
      .eq("id", itemId);

    // Resolve a fetchable media URL — prefer a signed URL for the durable stored
    // copy, fall back to the original remote URL. Both Deepgram (by URL) and the
    // Groq fallback (download → upload) consume this.
    let mediaUrl: string;
    let ext = "mp4";
    if (item.file_path) {
      const { data: signedData } = await db.storage
        .from("inspiration-media")
        .createSignedUrl(item.file_path, 600);
      if (!signedData?.signedUrl) throw new Error("Could not create signed URL for storage file");
      mediaUrl = signedData.signedUrl;
      ext = item.file_path.endsWith(".webm") ? "webm" : "mp4";
    } else if (item.video_url) {
      mediaUrl = item.video_url;
    } else {
      // No video on this item (e.g. Instagram image/carousel post scraped via
      // the metadata-only path). Mark ready without transcription — the thumbnail
      // and creator handle are already saved.
      await db.from("inspiration_items").update({ status: "ready" }).eq("id", itemId);
      return json({ ok: true, item_id: itemId, skipped_transcription: true, reason: "no_video" });
    }

    // Write the transcript and chain to vault-analyze. Replace-then-insert on
    // item_id: vault-analyze reads transcripts with .single(), so a re-transcription
    // (e.g. the analyze self-heal path, or a retry after a blank row from the old
    // code) must never leave two rows for one item.
    const finishWithTranscript = async (rawTranscript: string, provider: string) => {
      const wordCount = rawTranscript.split(/\s+/).filter(Boolean).length;
      await db.from("inspiration_transcripts").delete().eq("item_id", itemId);
      await db.from("inspiration_transcripts").insert({
        item_id: itemId,
        raw_transcript: rawTranscript,
        duration_seconds: null,
        word_count: wordCount,
      });

      await db.from("inspiration_items").update({ status: "analyzing" }).eq("id", itemId);

      // Per policy (verdanote-edge-fn-no-waituntil-for-required-calls), this chain
      // must not be fire-and-forget: a silently dropped dispatch leaves the item
      // stuck at status='analyzing' forever. Bounded ack: await the dispatch for a
      // short window (immediate failures mark the item errored so useItemStatus
      // surfaces them), then let the in-flight call ride on waitUntil — at that
      // point vault-analyze owns item status.
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

      return json({ ok: true, item_id: itemId, provider });
    };

    // Mark ready WITHOUT inserting a transcript (genuinely no audio / no speech).
    // Never insert a blank transcript: vault-analyze treats a falsy transcript as
    // "missing" and re-enters transcription, which would loop forever.
    const markReadyNoAudio = async (reason: string) => {
      await db
        .from("inspiration_items")
        .update({ status: "ready", error_message: null })
        .eq("id", itemId);
      return json({ ok: true, item_id: itemId, skipped_transcription: true, reason });
    };

    // ─── PRIMARY: Deepgram by URL (no size cap; server-side audio extraction) ──
    if (deepgramKey) {
      try {
        const dgRes = await fetch(
          `${DEEPGRAM_URL}?model=${DEEPGRAM_MODEL}&smart_format=true&punctuate=true`,
          {
            method: "POST",
            headers: { Authorization: `Token ${deepgramKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ url: mediaUrl }),
          },
        );
        if (dgRes.ok) {
          const transcript = extractDeepgramTranscript(await dgRes.json());
          if (transcript.trim()) return await finishWithTranscript(transcript, "deepgram");
          // Deepgram succeeded but found no speech → silent video / no audio.
          return await markReadyNoAudio("no_speech_detected");
        }
        console.error(
          `Deepgram error ${dgRes.status}: ${await dgRes.text()} — falling back to Groq`,
        );
      } catch (e) {
        console.error("Deepgram request failed — falling back to Groq:", e);
      }
    }

    // ─── FALLBACK: Groq Whisper (download bytes → multipart upload; 25 MB cap) ──
    if (!groqKey) throw new Error("Deepgram failed and GROQ_API_KEY is not configured");

    const dlRes = await fetch(mediaUrl);
    if (!dlRes.ok) throw new Error(`Media download failed: ${dlRes.status}`);
    const videoBytes = await dlRes.arrayBuffer();

    const formData = new FormData();
    formData.append("file", new Blob([videoBytes], { type: `video/${ext}` }), `video.${ext}`);
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
      const kind = classifyGroqFailure(groqRes.status, errText);

      // No audio in the media (image / silent video) — expected, not an error.
      if (kind === "skip_no_audio") return await markReadyNoAudio("no_audio_track");

      // Over Groq's upload cap. Fail HONESTLY (the prior code silently marked
      // these ready, leaving a transcript-less item that threw on Run analysis).
      if (kind === "error_too_large") {
        const message = tooLargeMessage(videoBytes.byteLength);
        await db
          .from("inspiration_items")
          .update({ status: "error", error_message: message })
          .eq("id", itemId);
        return json({ ok: false, item_id: itemId, error: "file_too_large", message }, 200);
      }

      throw new Error(`Groq error ${groqRes.status}: ${errText}`);
    }

    const groqData = await groqRes.json();
    const groqTranscript = (groqData.text ?? "") as string;
    if (!groqTranscript.trim()) return await markReadyNoAudio("no_audio_track");
    return await finishWithTranscript(groqTranscript, "groq");
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
