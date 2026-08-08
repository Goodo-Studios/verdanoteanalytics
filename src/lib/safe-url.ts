// React does not sanitize the href attribute, so a stored `javascript:`,
// `data:`, or `vbscript:` URL would execute on click. safeExternalHref returns
// the URL only when it uses a safe web scheme (http/https); anything else
// collapses to undefined so the anchor renders inert.
export function safeExternalHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}
