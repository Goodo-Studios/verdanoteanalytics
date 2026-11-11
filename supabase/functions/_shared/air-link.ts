// The one rule for the review link a client may open (the ClickUp "Link to Asset" field).
//
// Owner decision 2026-11-10: the "Link to Asset" custom field holds the link into Air that a client can
// open, so a card shows it as "View asset". The value is typed by staff, so it is checked here before it
// is stored, and checked again by a database constraint and by the page before it becomes a link:
//
//   - https only (no http, javascript:, data:, mailto: or file:)
//   - the host is air.inc or a subdomain of it (app.air.inc, a custom share host under air.inc)
//   - no user name or password in the address, no custom port, no whitespace inside, 500 characters at most
//
// Anything else is dropped (null). A look-alike such as air.inc.evil.com or evilair.inc is not an Air host.
// Keep src/lib/airLink.ts in step; src/test/airLink.test.ts runs the same cases against it.

export const AIR_HOST = "air.inc";
export const MAX_ASSET_LINK_LENGTH = 500;

export function parseAssetLink(raw: unknown): string | null {
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
