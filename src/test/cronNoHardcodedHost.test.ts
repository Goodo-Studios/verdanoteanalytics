// Audit Batch 9 (cron URL): 34 cron migrations call the production functions host directly, so on
// staging those jobs point at production between a push and the lockdown script. New migrations
// must build the address with public.edge_function_url(name) instead. The existing files are
// listed here; moving their jobs over is a separate production change.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.resolve(process.cwd(), "supabase/migrations");
const PROD_HOST = ["gwyxaqoaldnaavkjqquv", "supabase.co/functions"].join(".");

// Migrations at or before this version may still carry the host; they are already applied.
const LAST_WITH_HOST = "20261216450000";

describe("cron migrations", () => {
  it("added after the cutoff never hard-code the production functions host", () => {
    const offenders = readdirSync(DIR)
      .filter((f) => f.endsWith(".sql") && f.split("_")[0] > LAST_WITH_HOST)
      .filter((f) => readFileSync(path.join(DIR, f), "utf8").includes(PROD_HOST));
    expect(offenders).toEqual([]);
  });

  it("have a helper to build the address from a setting", () => {
    const helper = readdirSync(DIR)
      .filter((f) => f.endsWith(".sql"))
      .some((f) => /CREATE OR REPLACE FUNCTION public\.edge_function_url\(/.test(readFileSync(path.join(DIR, f), "utf8")));
    expect(helper).toBe(true);
  });
});
