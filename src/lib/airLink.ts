// The page-side copy of the rule in supabase/functions/_shared/air-link.ts. The sync and a database
// constraint already keep anything but an https address on air.inc out of asset_link; the page checks
// again before a value becomes a link, so a bad value that got into a row some other way still renders
// as nothing. src/test/airLink.test.ts runs the same cases against both copies.
export const AIR_HOST = "air.inc";
export const MAX_ASSET_LINK_LENGTH = 500;

/** The address to open, or null when the value is not a valid Air link. */
export function safeAssetLink(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > MAX_ASSET_LINK_LENGTH || /\s/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (host !== AIR_HOST && !host.endsWith(`.${AIR_HOST}`)) return null;
  return url.href;
}
