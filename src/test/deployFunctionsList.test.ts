/**
 * scripts/deploy-functions.sh deploys an explicit list. A function directory missing from the
 * list is never deployed (public-link was missing after its first merge and answered 404 on
 * staging), so every directory in supabase/functions must be in the list, and the list must
 * not name a directory that does not exist.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const script = readFileSync(join(root, "scripts", "deploy-functions.sh"), "utf8");
const listed = (script.match(/FUNCTIONS=\(([\s\S]*?)\n\)/)?.[1] ?? "").split(/\s+/).filter(Boolean);
const dirs = readdirSync(join(root, "supabase", "functions")).filter((n) => n !== "_shared" && statSync(join(root, "supabase", "functions", n)).isDirectory());

describe("deploy-functions.sh list", () => {
  it("names every function directory", () => {
    expect(dirs.filter((d) => !listed.includes(d))).toEqual([]);
  });
  it("names nothing that does not exist", () => {
    expect(listed.filter((n) => !dirs.includes(n))).toEqual([]);
  });
  it("names each function once", () => {
    expect(new Set(listed).size).toBe(listed.length);
  });
});
