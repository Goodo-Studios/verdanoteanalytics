// Second-round audit L13: pages that open with a secret link or no login must not be indexed.
// Each one gets an X-Robots-Tag header from vercel.json (exact path and wildcard, because the SPA
// rewrite serves every sub-path as index.html) and a Disallow line in public/robots.txt. The CSP
// header rule stays as it was.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(`${process.cwd()}/${file}`, "utf8");
const vercel = JSON.parse(read("vercel.json")) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const robots = read("public/robots.txt");
const app = read("src/App.tsx");

// The public routes in src/App.tsx that open without a login and are reached by a shared link.
const PUBLIC_PREFIXES = [
  "/public/reports",
  "/briefs/share",
  "/shared/ad-board",
  "/vault/share",
  "/approve",
  "/cast",
  "/locations-board",
  "/call-sheet",
  "/creatorapply",
  "/actorapply",
  "/apply",
];

const robotsTag = (source: string) =>
  vercel.headers.find((h) => h.source === source)?.headers.find((h) => h.key === "X-Robots-Tag")?.value;

describe("public token routes are not indexed", () => {
  it.each(PUBLIC_PREFIXES)("%s is a public route in App.tsx", (prefix) => {
    expect(app).toContain(`path="${prefix}`);
  });

  it.each(PUBLIC_PREFIXES)("%s and everything under it carry X-Robots-Tag noindex, nofollow", (prefix) => {
    expect(robotsTag(prefix)).toBe("noindex, nofollow");
    expect(robotsTag(`${prefix}/(.*)`)).toBe("noindex, nofollow");
  });

  it("robots.txt disallows each of them for every crawler group", () => {
    const groups = robots.split(/\n\s*\n/).filter((g) => g.includes("User-agent:"));
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      for (const prefix of PUBLIC_PREFIXES) {
        const line = /^(\/approve|\/cast|\/locations-board|\/call-sheet|\/public\/reports|\/briefs\/share|\/shared\/ad-board|\/vault\/share)$/.test(prefix)
          ? `Disallow: ${prefix}/`
          : `Disallow: ${prefix}`;
        expect(group, `${prefix} in group`).toContain(line);
      }
    }
  });

  it("leaves the content security policy rule as it was", () => {
    const rule = vercel.headers.find((h) => h.source === "/(.*)")!;
    const csp = rule.headers.find((h) => h.key === "Content-Security-Policy")!.value;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).toContain("connect-src 'self' https://*.supabase.co wss://*.supabase.co");
    // The new rules are separate entries; they do not add a header to the catch-all rule.
    expect(rule.headers.some((h) => h.key === "X-Robots-Tag")).toBe(false);
  });
});
