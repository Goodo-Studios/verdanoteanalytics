// vault-transcribe — pure, testable transcription-classification logic.
//
// The vault-transcribe edge function downloads stored media and POSTs it to
// Groq Whisper. Two classes of decision are pure (no Deno, no network) and are
// extracted here so they can be unit-tested under Vitest:
//
//   1. isImageOnlyMedia — should we even send this media to Whisper? Image
//      creatives (static ads, carousels) have no audio; sending the .jpg to
//      Groq returns "no audio track found" and used to hard-error the item.
//
//   2. classifyGroqFailure — when Groq returns a non-2xx, decide whether the
//      item should be (a) skipped gracefully as ready (genuinely no audio to
//      transcribe), (b) marked an honest error (file too large for Groq's
//      upload cap — audio extraction not yet supported), or (c) re-thrown as
//      an unexpected error with Groq's raw message.
//
// HISTORY: the prior code silently marked over-limit (413) AND
// "could not process" items `ready` with no transcript. That produced a
// deceptive card that played fine but threw "No transcript found for item"
// the moment a user clicked Run analysis. Groq Whisper's sync upload cap is
// 25 MB (free) / 100 MB (dev tier); a 2-minute 720p ad is ~28 MB, so it 413'd
// and vanished. We now fail honestly on too-large and only skip when there is
// genuinely no audio.
//
// This module is intentionally dependency-free so it imports cleanly into both
// the Deno edge runtime and a Vitest/Node runtime.

const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "avif",
  "heic",
  "tif",
  "tiff",
]);

/**
 * True when the only media we have for an item is a still image — there is no
 * audio to transcribe, so we must NOT send it to Whisper. Decided on the file
 * path's extension (the durable vault copy) with the remote video_url as an
 * override: if a real video URL exists, it is not image-only.
 */
export function isImageOnlyMedia(input: {
  file_path?: string | null;
  video_url?: string | null;
}): boolean {
  if (input.video_url && input.video_url.trim()) return false;
  const path = (input.file_path ?? "").trim().toLowerCase();
  if (!path) return false;
  // Strip any query/fragment before reading the extension.
  const clean = path.split(/[?#]/)[0];
  const dot = clean.lastIndexOf(".");
  if (dot === -1) return false;
  const ext = clean.slice(dot + 1);
  return IMAGE_EXTENSIONS.has(ext);
}

export type GroqFailureKind =
  // No audio in the media (image / silent video). Not an error — mark ready,
  // skip transcription, do NOT chain to analyze.
  | "skip_no_audio"
  // File exceeds Groq's upload cap. Honest error — the media is saved and
  // viewable, but we cannot transcribe it until audio extraction lands.
  | "error_too_large"
  // Anything else Groq rejected. Re-throw with the raw message so it surfaces
  // honestly as an item error rather than a silent skip.
  | "error_other";

/**
 * Classify a non-2xx Groq Whisper response into an action. `errText` is the
 * raw response body (matched case-insensitively for known signatures).
 */
export function classifyGroqFailure(
  status: number,
  errText: string,
): GroqFailureKind {
  const text = (errText ?? "").toLowerCase();

  // Genuinely nothing to transcribe — image or silent video. Graceful skip.
  if (text.includes("no audio track") || text.includes("no audio found")) {
    return "skip_no_audio";
  }

  // Upload too large. Groq signals this as 413, or occasionally a 400 whose
  // body mentions size limits. Honest error — audio extraction not yet built.
  if (
    status === 413 ||
    text.includes("too large") ||
    text.includes("maximum allowed size") ||
    text.includes("file size") ||
    text.includes("entity too large")
  ) {
    return "error_too_large";
  }

  return "error_other";
}

/**
 * Pull the transcript text out of a Deepgram /v1/listen prerecorded response.
 * Shape: results.channels[0].alternatives[0].transcript. Returns "" when
 * absent (no speech detected / malformed) so callers can treat blank as
 * "no audio to transcribe" rather than inserting an empty transcript row.
 */
export function extractDeepgramTranscript(dg: unknown): string {
  const alt = (dg as {
    results?: { channels?: Array<{ alternatives?: Array<{ transcript?: unknown }> }> };
  })?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  return typeof alt === "string" ? alt : "";
}

/** Human-readable error message for an over-cap file, sized in MB. */
export function tooLargeMessage(byteLength: number): string {
  const mb = (byteLength / (1024 * 1024)).toFixed(1);
  return (
    `Video too large to transcribe (${mb} MB exceeds the transcription ` +
    `upload limit). The ad is saved and viewable; audio extraction for large ` +
    `videos is not yet supported.`
  );
}
