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

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

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
      .select("id, file_path, video_url")
      .eq("id", itemId)
      .single();

    if (!item) return json({ error: "Item not found" }, 404);

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
      // 413: file too large. 400 "could not process file": incompatible format.
      // In both cases the video is saved and viewable — skip transcription and mark ready.
      if (groqRes.status === 413 || (groqRes.status === 400 && errText.includes("could not process"))) {
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

    EdgeRuntime.waitUntil(
      fetch(`${supabaseUrl}/functions/v1/vault-analyze`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ item_id: itemId }),
      }).catch(console.error),
    );

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
