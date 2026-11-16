// Shared body read for media downloads (cache-creative-image, preview-capture).
//
// Returns the response bytes, or null when a video is larger than maxVideoBytes.
// Callers still run their own content-type, HTML and minimum-size guards on the bytes.
//
// Audit 8.7: both callers used to read the whole video with arrayBuffer() and only then
// compare it to the limit, so an oversized video could exhaust the worker's memory first.
// A video is now refused from its declared content-length before any byte is read, and a
// video with no (or a wrong) declared size is read in chunks and abandoned as soon as it
// passes the limit. Peak memory for a video is bounded by the limit. The bytes are still
// buffered because the callers hash them for the asset dedupe key.

export async function readMediaBody(
  res: Response,
  type: "image" | "video",
  maxVideoBytes: number,
): Promise<Uint8Array | null> {
  if (type !== "video") return new Uint8Array(await res.arrayBuffer());

  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxVideoBytes) {
    await res.body?.cancel().catch(() => {});
    return null;
  }

  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxVideoBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
