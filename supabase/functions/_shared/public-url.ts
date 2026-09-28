const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  return octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? octets
    : null;
}

/** Returns false for private, loopback, link-local, multicast, and unspecified IPs. */
export function isPublicIpAddress(rawIp: string): boolean {
  const ip = rawIp.toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = parseIpv4(ip);
  if (v4) {
    const [a, b, c] = v4;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }

  if (!ip.includes(":")) return false;
  if (ip === "::" || ip === "::1") return false;
  // Reject the entire IPv4-mapped range. Supporting public mapped addresses is
  // unnecessary here and risks alternate-notation bypasses such as ::ffff:7f00:1.
  if (ip.startsWith("::ffff:")) return false;
  if (
    ip.startsWith("2001:db8:") ||
    ip.startsWith("fc") ||
    ip.startsWith("fd") ||
    /^fe[89ab]/.test(ip) ||
    ip.startsWith("ff")
  ) return false;
  return true;
}

/** Performs the URL-shape checks that are safe to run synchronously. */
export function isPublicHttpUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (url.username || url.password) return false;
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!hostname || BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost")) return false;
    if (parseIpv4(hostname) || hostname.includes(":")) return isPublicIpAddress(hostname);
    return true;
  } catch {
    return false;
  }
}

type ResolveDns = (hostname: string, recordType: "A" | "AAAA") => Promise<string[]>;

/**
 * Rejects DNS rebinding targets before a server-side fetch. Call this for the
 * initial URL and every redirect target.
 */
export async function assertPublicNetworkTarget(
  rawUrl: string,
  resolveDns: ResolveDns = Deno.resolveDns,
): Promise<URL> {
  if (!isPublicHttpUrl(rawUrl)) throw new Error("Unsafe destination URL");
  const url = new URL(rawUrl);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (parseIpv4(hostname) || hostname.includes(":")) return url;

  const answers = (
    await Promise.all([
      resolveDns(hostname, "A").catch(() => []),
      resolveDns(hostname, "AAAA").catch(() => []),
    ])
  ).flat();
  if (answers.length === 0 || answers.some((ip) => !isPublicIpAddress(ip))) {
    throw new Error("Destination hostname did not resolve exclusively to public IPs");
  }
  return url;
}
