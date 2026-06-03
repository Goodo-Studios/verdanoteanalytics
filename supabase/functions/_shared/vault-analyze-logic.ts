// vault-analyze — pure, testable branch-selection logic.
//
// Bug: uploading a STATIC image ad to the Creative Vault failed with
// "No transcript found for item". vault-analyze was written entirely around a
// short-form *video script*: it unconditionally required an inspiration_transcripts
// row and built every Claude call off the cleaned transcript. A static image has no
// spoken script, so the upload pipeline (vault-save → vault-analyze for non-video
// files) always errored and the item flipped to status='error'.
//
// The fix adds an image-only analysis branch. This module holds the pure decision
// of WHICH branch to run, extracted so it can be unit-tested under Vitest without
// Deno globals or any live network/DB — same pattern as vault-save-logic.ts.
//
// Dependency-free on purpose (no Deno, no esm.sh, no Supabase client) so it imports
// cleanly into both the Deno edge runtime and a Vitest/Node runtime.

// Image file extensions the vault stores. Mirrors InspirationCard's `isImageFile`
// regex so the frontend preview and the backend analysis agree on what counts as
// an image upload.
const IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|webp|avif)$/i;

/** Whether a storage path / URL points at a still image (by extension). Pure. */
export function isImagePath(path: unknown): boolean {
  return typeof path === "string" && IMAGE_EXT_RE.test(path.trim());
}

/**
 * Decide whether vault-analyze should run the image-only branch (vision analysis,
 * NO transcript required) instead of the legacy video-script branch.
 *
 * An item is image-only when it has no usable transcript AND either:
 *   • the caller passed media_kind === "image" — the fresh-upload path, where
 *     vault-save forwards the kind it derived from the upload's MIME type; or
 *   • the stored file_path has an image extension — the re-analyze path, where the
 *     button calls vault-analyze with just { item_id } and no media_kind hint.
 *
 * A VIDEO whose transcription failed has neither signal (no "image" kind, a video
 * file_path), so it correctly stays on the video branch and surfaces the
 * "No transcript found" error rather than being silently mis-analyzed as an image.
 *
 * Pure + deterministic.
 */
export function isImageOnlyAnalysis(input: {
  hasTranscript: boolean;
  mediaKind?: unknown;
  filePath?: unknown;
}): boolean {
  if (input.hasTranscript) return false;
  if (input.mediaKind === "image") return true;
  return isImagePath(input.filePath);
}

/**
 * Parse a Claude JSON response that may be wrapped in a ```json fence. Returns an
 * empty object when nothing parses, so callers can fall back to per-field nulls
 * rather than throwing. Pure.
 */
export function parseLooseJson(text: unknown): Record<string, unknown> {
  if (typeof text !== "string") return {};
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {
        /* leave empty */
      }
    }
    return {};
  }
}
