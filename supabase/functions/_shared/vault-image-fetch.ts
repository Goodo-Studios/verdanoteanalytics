// Download an image for Vault analysis (audit plan item 2.3).
//
// The URL comes from an item's thumbnail_url, which a caller supplied when saving, or from a
// signed storage URL. Every hop (the first URL and each redirect) must resolve only to public
// addresses, so a saved URL cannot reach an internal service. Redirects are followed by hand, at
// most MAX_REDIRECTS times, and each target is checked before it is fetched.
//
// isAllowedMediaUrl is deliberately not used here: real TikTok and YouTube thumbnail hosts are
// not on that list and would be refused.
import { assertPublicNetworkTarget } from "./public-url.ts";
import { resolveImageMediaType, sniffImageMediaType } from "./image-media-type.ts";

const MAX_REDIRECTS = 3;
const MAX_BYTES = 20 * 1024 * 1024;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface ImageFetchDeps {
  fetchImpl?: typeof fetch;
  assertTarget?: (url: string) => Promise<URL>;
}

export async function fetchImageAsDataUrl(url: string, deps: ImageFetchDeps = {}): Promise<string | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const assertTarget = deps.assertTarget ?? ((u: string) => assertPublicNetworkTarget(u));
  try {
    let current = url;
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const target = await assertTarget(current);
      res = await fetchImpl(target.toString(), {
        headers: { "User-Agent": USER_AGENT },
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel();
        if (!location) return null;
        current = new URL(location, target).toString();
        res = null;
        continue;
      }
      break;
    }
    if (!res || !res.ok) {
      await res?.body?.cancel();
      return null;
    }
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_BYTES) {
      await res.body?.cancel();
      return null;
    }
    const headerContentType = res.headers.get("content-type") ?? "image/jpeg";
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) return null;
    // Trust the bytes, not the label: storage and CDNs often mislabel a PNG as image/jpeg.
    const isImageHeader = headerContentType.startsWith("image/");
    const mediaType = resolveImageMediaType(bytes, headerContentType);
    if (!isImageHeader && sniffImageMediaType(bytes) === null) return null;
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return `data:${mediaType};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}
