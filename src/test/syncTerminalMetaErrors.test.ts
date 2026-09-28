// Regression guards for the 2026-09-28 sync-queue wedge. A bulk "sync all"
// queued the demo account act_demo_glowdrip, which does not exist on Meta.
// Every call returned code 100 / subcode 33, and the Phase 1 campaign-list
// error branch retried forever (26k+ Meta calls over 10+ hours) while holding
// the single-runner lock, so 14 real accounts stayed queued.
//
// Pure helpers are imported from _shared (Deno-free). The sync entrypoint
// touches Deno at load, so its wiring is checked by reading the source, the
// same pattern as syncPhaseErrorHandling.test.ts.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  isMetaAdAccountId,
  isTerminalMetaError,
  MAX_CAMPAIGN_LIST_ERROR_RETRIES,
  shouldRetryCampaignList,
  urlTargetsAccount,
} from "../../supabase/functions/_shared/meta-errors";

const syncSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/functions/sync/index.ts"),
  "utf8",
);

describe("isMetaAdAccountId", () => {
  it("accepts real Meta ad account ids", () => {
    expect(isMetaAdAccountId("act_570190447554146")).toBe(true);
    expect(isMetaAdAccountId("act_44401754")).toBe(true);
  });
  it("rejects demo/seed and malformed ids", () => {
    expect(isMetaAdAccountId("act_demo_glowdrip")).toBe(false);
    expect(isMetaAdAccountId("570190447554146")).toBe(false);
    expect(isMetaAdAccountId("act_")).toBe(false);
    expect(isMetaAdAccountId(null)).toBe(false);
    expect(isMetaAdAccountId(undefined)).toBe(false);
  });
});

describe("isTerminalMetaError", () => {
  it("treats 'object does not exist' (100/33) as permanent", () => {
    expect(isTerminalMetaError({ code: 100, error_subcode: 33 })).toBe(true);
  });
  it("treats bad token and permission errors as permanent", () => {
    expect(isTerminalMetaError({ code: 190 })).toBe(true);
    expect(isTerminalMetaError({ code: 10 })).toBe(true);
    expect(isTerminalMetaError({ code: 200 })).toBe(true);
    expect(isTerminalMetaError({ code: 272 })).toBe(true);
  });
  it("leaves transient and other errors retryable", () => {
    expect(isTerminalMetaError({ code: 1, error_subcode: 99 })).toBe(false);
    expect(isTerminalMetaError({ code: 2 })).toBe(false);
    expect(isTerminalMetaError({ code: 100 })).toBe(false); // generic invalid param
    expect(isTerminalMetaError({ code: 17 })).toBe(false); // rate limit
    expect(isTerminalMetaError(null)).toBe(false);
  });
});

describe("urlTargetsAccount", () => {
  it("matches account-scoped Graph URLs", () => {
    expect(urlTargetsAccount("https://graph.facebook.com/v21.0/act_demo_glowdrip/campaigns?fields=id", "act_demo_glowdrip")).toBe(true);
    expect(urlTargetsAccount("https://graph.facebook.com/v21.0/act_1/insights?level=ad", "act_1")).toBe(true);
  });
  it("does not match per-object URLs", () => {
    expect(urlTargetsAccount("https://graph.facebook.com/v21.0/12345/ads?fields=id", "act_1")).toBe(false);
    expect(urlTargetsAccount("not a url", "act_1")).toBe(false);
  });
});

describe("shouldRetryCampaignList", () => {
  it("allows retries up to the cap, then stops", () => {
    for (let prior = 0; prior < MAX_CAMPAIGN_LIST_ERROR_RETRIES; prior++) {
      expect(shouldRetryCampaignList(prior)).toBe(true);
    }
    expect(shouldRetryCampaignList(MAX_CAMPAIGN_LIST_ERROR_RETRIES)).toBe(false);
  });
});

describe("sync wiring", () => {
  it("metaFetch flags permanent account-level errors on ctx", () => {
    expect(syncSrc).toMatch(/isTerminalMetaError\(json\.error\)[\s\S]{0,200}urlTargetsAccount\(url, ctx\.accountId\)[\s\S]{0,80}ctx\.terminalError = fullErrMsg/);
    expect(syncSrc).toContain("accountId: syncLog.account_id, terminalError: null");
  });

  it("campaign-list error branch fails on permanent errors and caps retries", () => {
    const block = syncSrc.match(/const result = await metaFetch\(campUrl, ctx\);[\s\S]*?if \(result\.rateLimited/);
    expect(block, "campaign-list error branch not found").not.toBeNull();
    const b = block![0];
    expect(b).toContain("if (ctx.terminalError)");
    expect(b).toMatch(/saveState\(1, \{[^}]*\}, "failed"\)/);
    expect(b).toContain("shouldRetryCampaignList(priorRetries)");
    // The old unbounded retry must be gone.
    expect(b).not.toMatch(/will retry next continue"\);\s*await saveState\(1, \{ campaigns: \[\], creatives_fetched: fetchedCount \}\);/);
  });

  it("Phase 4 error branch fails on permanent errors instead of retrying", () => {
    expect(syncSrc).toMatch(/if \(ctx\.terminalError\) \{[\s\S]{0,400}saveState\(4, \{[^}]*\}, "failed"\)/);
  });

  it("never queues non-Meta (demo) accounts", () => {
    expect(syncSrc).toContain("accounts.filter((a: any) => isMetaAdAccountId(a.id))");
  });
});
