// Regression guards for the 2026-09-28 Cattasaurus rollup timeout.
//
// The per-row creative-count trigger recounted the account once per updated
// creative, so the Phase 5 rollup (one UPDATE over ~9.3k creatives) timed out
// and held the ad_accounts row lock. The follow-up last_data_sync and
// last_synced_at writes then failed with lock_timeout, and the sync ignored
// the returned errors. Behaviour is covered by the pgTAP test
// supabase/tests/creative_count_triggers_test.sql. These source checks run in
// the default vitest suite.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migration = readFileSync(
  path.join(root, "supabase/migrations/20260928000001_statement_level_creative_count_triggers.sql"),
  "utf8",
);
const syncSrc = readFileSync(path.join(root, "supabase/functions/sync/index.ts"), "utf8");

describe("creative-count triggers are statement-level", () => {
  it("drops the per-row trigger", () => {
    expect(migration).toContain("DROP TRIGGER IF EXISTS trg_refresh_account_creative_counts ON public.creatives;");
  });

  it("creates one statement-level trigger per event with transition tables", () => {
    for (const ev of ["ins", "upd", "del"]) {
      const m = migration.match(new RegExp(`CREATE TRIGGER trg_refresh_account_creative_counts_${ev}[\\s\\S]*?;`));
      expect(m, `trigger _${ev} not found`).not.toBeNull();
      expect(m![0]).toContain("FOR EACH STATEMENT");
      expect(m![0]).toContain("REFERENCING");
      expect(m![0]).not.toContain("FOR EACH ROW");
    }
  });

  it("the UPDATE trigger only recounts when account_id or tag_source changed", () => {
    const fn = migration.match(/FUNCTION public\.refresh_account_creative_counts_upd\(\)[\s\S]*?\$\$;/);
    expect(fn).not.toBeNull();
    expect(fn![0]).toContain("o.account_id IS DISTINCT FROM n.account_id");
    expect(fn![0]).toContain("o.tag_source IS DISTINCT FROM n.tag_source");
  });

  it("skips rewriting ad_accounts when counts are unchanged", () => {
    expect(migration).toMatch(/a\.creative_count IS DISTINCT FROM[\s\S]*a\.untagged_count IS DISTINCT FROM/);
  });
});

describe("sync surfaces failed ad_accounts stamps", () => {
  it("checks the last_data_sync update error", () => {
    expect(syncSrc).toMatch(/const \{ error: tsErr \} = await supabase\s*\.from\("ad_accounts"\)\s*\.update\(tsPatch\)/);
    expect(syncSrc).toContain("if (tsErr) throw tsErr;");
    expect(syncSrc).toContain("Failed to record last_data_sync");
  });

  it("checks the last_synced_at update error", () => {
    expect(syncSrc).toMatch(/const \{ error: stampErr \} = await supabase\.from\("ad_accounts"\)\.update\(\{[\s\S]{0,200}last_synced_at/);
    expect(syncSrc).toContain("Failed to record last_synced_at");
  });
});
