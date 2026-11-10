import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The Deno test job reads remote modules (esm.sh, deno.land) from the checked-in
// vendor/ directory instead of the network. esm.sh served two different builds
// of the same exact-version URL (tslib@2.8.1/denonext/tslib.mjs) from different
// CDN edges on 2026-11-10, so the network download failed the lock check at
// random. Vendoring removes the download; these tests keep deno.lock the
// authority: every vendored file must hash to an entry in the lock, so the
// vendored code is exactly what the lock pinned.

const root = process.cwd();
const lock = JSON.parse(readFileSync(join(root, "deno.lock"), "utf8")) as {
  remote?: Record<string, string>;
  redirects?: Record<string, string>;
};
const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const vendorDir = join(root, "vendor");
const vendored = walk(vendorDir).filter((f) => relative(vendorDir, f) !== "manifest.json");
const sha256 = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");

describe("Deno vendored remote modules", () => {
  it("vendors the remote modules the edge function tests use", () => {
    expect(vendored.length).toBeGreaterThan(0);
    const paths = vendored.map((f) => relative(vendorDir, f));
    expect(paths).toContain(join("esm.sh", "tslib@2.8.1", "denonext", "tslib.mjs"));
  });

  it("every vendored file matches a hash pinned in deno.lock", () => {
    const pinned = new Set(Object.values(lock.remote ?? {}));
    expect(pinned.size).toBeGreaterThan(0);
    const unpinned = vendored
      .filter((f) => !pinned.has(sha256(f)))
      .map((f) => relative(root, f));
    expect(unpinned, "vendored files whose bytes are not in deno.lock").toEqual([]);
  });

  it("vendors tslib with the exact bytes deno.lock pinned", () => {
    const expected = lock.remote?.["https://esm.sh/tslib@2.8.1/denonext/tslib.mjs"];
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256(join(vendorDir, "esm.sh", "tslib@2.8.1", "denonext", "tslib.mjs"))).toBe(expected);
  });

  it("runs the Deno tests from vendor/ with the lock frozen", () => {
    const run = workflow.match(/run: deno test [^\n]*supabase\/functions\//);
    expect(run, "deno test step").not.toBeNull();
    expect(run![0]).toContain("--vendor");
    expect(run![0]).toContain("--frozen");
    // The lock check stays on.
    expect(run![0]).not.toContain("--no-lock");
    expect(workflow).not.toMatch(/DENO_NO_LOCK|--lock=false/);
  });
});
