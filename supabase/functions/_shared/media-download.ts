// Shared body read for media downloads (cache-creative-image, preview-capture).
//
// Returns the response bytes, or null when a video is larger than maxVideoBytes.
// Callers still run their own content-type, HTML and minimum-size guards on the bytes.

export async function readMediaBody(
  res: Response,
  type: "image" | "video",
  maxVideoBytes: number,
): Promise<Uint8Array | null> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (type === "video" && bytes.byteLength > maxVideoBytes) return null;
  return bytes;
}
