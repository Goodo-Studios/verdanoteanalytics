// SSRF guards for server-side fetches.
//
// Edge functions that fetch a URL taken from request input or the database must
// restrict the target to known-good hosts. These are exact hostname / suffix
// matches, so internal targets (169.254.169.254 cloud metadata, localhost,
// private/link-local IPs, file://, other schemes) never pass — there is no need
// to separately parse IP ranges. Always require https.

// Media CDNs Meta serves creative bytes from, plus this project's own Supabase
// storage (cache-creative-image rewrites recovered URLs onto SUPABASE_URL).
// Used by quick-save, transcribe-ad, vault-save-creative, cache-creative-image.
export function isAllowedMediaUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  try {
    const supaHost = new URL(Deno.env.get("SUPABASE_URL")!).hostname.toLowerCase();
    if (host === supaHost) return true;
  } catch { /* no SUPABASE_URL — fall through to CDN allowlist */ }
  return (
    host === "fbcdn.net" || host.endsWith(".fbcdn.net") ||
    host === "cdninstagram.com" || host.endsWith(".cdninstagram.com")
  );
}

// General "is this a safe public https URL?" check for cases where the target
// is legitimately any public CDN (e.g. transcribe-ad handing an ad video URL to
// Deepgram) rather than a fixed allowlist. Requires https and rejects IP-literal
// hosts in loopback / private / link-local (incl. cloud-metadata 169.254.169.254)
// ranges plus localhost. Note: this does not resolve DNS, so it does not defend
// against DNS-rebinding — it blocks the direct internal-target case.
export function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  let host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1); // unwrap IPv6
  // IPv6 loopback / link-local (fe80::/10) / unique-local (fc00::/7)
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) {
    return false;
  }
  // IPv4 literal in a private / loopback / link-local / CGNAT range
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]), b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  return true;
}

// Facebook web hosts — the only hosts scrape-ad may fetch directly (Ad Library
// pages). Excludes any non-facebook host, so an attacker cannot smuggle an
// internal URL through the ad-scrape path.
export function isAllowedFacebookUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase();
  return (
    host === "facebook.com" || host.endsWith(".facebook.com") ||
    host === "fb.com" || host.endsWith(".fb.com")
  );
}
