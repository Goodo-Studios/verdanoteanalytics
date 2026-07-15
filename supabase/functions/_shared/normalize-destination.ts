// Landing Pages report (Creative Terminal — Phase 1, Feature 1), foundation F4.
//
// normalizeDestinationUrl() collapses the many tracking-decorated URLs an ad can
// point at into one canonical "destination key", so ads that land on the same
// page consolidate in the Landing Pages report. It strips UTM + click-id params,
// lowercases scheme/host, drops the fragment, and normalizes the trailing slash,
// while preserving the meaningful path and any non-tracking query params.
//
// Returns null for empty/invalid input (caller stores NULL destination_key and
// excludes the creative from the report).

// Best-effort extraction of an ad's click destination from a Meta creative object
// (object_story_spec / asset_feed_spec). Returns the raw URL string, or null when no
// usable link is present. Shared by the backfill-destination-key function AND the
// going-forward sync forward-fill so both derive the same link with no split/merge
// drift. Pass the `creative` sub-object (ad.creative), not the whole ad.
//
// Intentionally total + throwing-free: it only reads optional fields and returns null
// on anything unexpected, so callers can invoke it on partial/unknown Meta payloads
// without a try/catch of their own (the sync still wraps it defensively).
// deno-lint-ignore no-explicit-any
export function extractDestinationLink(creative: any): string | null {
  const spec = creative?.object_story_spec;
  if (spec) {
    const fromLinkData = spec.link_data?.link;
    if (fromLinkData) return fromLinkData;
    const fromVideoCta = spec.video_data?.call_to_action?.value?.link;
    if (fromVideoCta) return fromVideoCta;
    const fromTemplate = spec.template_data?.link;
    if (fromTemplate) return fromTemplate;
    // deno-lint-ignore no-explicit-any
    const child = spec.link_data?.child_attachments?.find((c: any) => c?.link)?.link;
    if (child) return child;
  }
  const feed = creative?.asset_feed_spec;
  // deno-lint-ignore no-explicit-any
  const feedLink = feed?.link_urls?.find((l: any) => l?.website_url)?.website_url;
  if (feedLink) return feedLink;
  return null;
}

// Query params that carry only tracking/attribution noise, never destination identity.
const TRACKING_PARAM_PREFIXES = ["utm_"];
const TRACKING_PARAM_EXACT = new Set([
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "ttclid",
  "twclid",
  "msclkid",
  "dclid",
  "yclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
  "vero_id",
  "ref",
  "ref_src",
  "ref_url",
  "cmpid",
  "campaign_id",
  "ad_id",
  "adset_id",
  "adgroupid",
  "hsa_acc",
  "hsa_cam",
  "hsa_grp",
  "hsa_ad",
]);

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  if (TRACKING_PARAM_EXACT.has(lower)) return true;
  return TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export function normalizeDestinationUrl(
  rawUrl: string | null | undefined,
): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (trimmed === "") return null;

  const tryParse = (s: string): URL | null => {
    try {
      return new URL(s);
    } catch {
      return null;
    }
  };

  // Parse as-is first. If it carries a real scheme, it must be http(s) — reject
  // mailto:, tel:, javascript:, etc. If it has no scheme (bare host), it fails to
  // parse and we retry with https:// prepended.
  let url = tryParse(trimmed);
  if (url) {
    const scheme = url.protocol.toLowerCase();
    if (scheme !== "http:" && scheme !== "https:") return null;
  } else {
    url = tryParse(`https://${trimmed}`);
    if (!url) return null;
  }

  // Normalize scheme + host: always https for keying, lowercase host, drop default port.
  const host = url.hostname.toLowerCase();
  if (host === "") return null;

  // Path: drop a single trailing slash (but keep root "/").
  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }

  // Keep only non-tracking query params, sorted for a stable key.
  const kept: [string, string][] = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (!isTrackingParam(key)) kept.push([key, value]);
  }
  kept.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  const query = kept.length
    ? "?" + kept.map(([k, v]) => `${k}=${v}`).join("&")
    : "";

  // Fragment intentionally dropped.
  return `https://${host}${path}${query}`;
}
