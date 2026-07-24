// Detect an image's real media type from its leading bytes (magic numbers),
// independent of any file extension or HTTP Content-Type header.
//
// Why this exists: uploads and stored objects are frequently mislabeled — e.g. a
// PNG saved with a `.jpeg` name is served by storage as `Content-Type: image/jpeg`.
// When such an image is forwarded to Claude's vision API declared as image/jpeg,
// the API sniffs the bytes, sees PNG, and rejects the whole request with a 400
// ("The image was specified using the image/jpeg media type, but the image appears
// to be a image/png image"). Sniffing the bytes ourselves and declaring the true
// type keeps the vision call valid regardless of how the file was labeled.
//
// Returns one of the four media types Claude accepts, or null when the bytes match
// none (caller falls back to the header-provided type).

export type ClaudeImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

/** Sniff the image media type from magic bytes. Returns null if unrecognized. */
export function sniffImageMediaType(bytes: Uint8Array): ClaudeImageMediaType | null {
  if (bytes.length < 4) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes.length >= 8 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";

  // GIF: "GIF8" (47 49 46 38) — covers GIF87a and GIF89a
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";

  // WEBP: "RIFF" (52 49 46 46) at 0..3 and "WEBP" (57 45 42 50) at 8..11
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";

  return null;
}

/**
 * Resolve the media type to declare for a vision call: prefer the sniffed byte
 * signature; fall back to the header-provided type only when the bytes are
 * unrecognized; and default to image/jpeg when neither is usable.
 */
export function resolveImageMediaType(
  bytes: Uint8Array,
  headerContentType?: string | null,
): ClaudeImageMediaType {
  const sniffed = sniffImageMediaType(bytes);
  if (sniffed) return sniffed;
  const header = (headerContentType ?? "").split(";")[0].trim().toLowerCase();
  if (header === "image/jpeg" || header === "image/jpg") return "image/jpeg";
  if (header === "image/png") return "image/png";
  if (header === "image/gif") return "image/gif";
  if (header === "image/webp") return "image/webp";
  return "image/jpeg";
}
