/**
 * "All accounts" export scores each account with its own threshold (audit plan item 6.5, part 6).
 *
 * The Creative Performance export took the scale threshold of the first row's account and
 * scored every account's creatives with it (and pooled the average CPA across accounts). The
 * Tag Performance export used 2.0 for everyone when "All accounts" was picked. Each creative
 * is now scored against its own account.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeScoreMap } from "@/lib/creativeScore";
import { exportScoreMap, scaleThresholdFor } from "@/lib/exportScores";

const accounts = [
  { id: "act_a", scale_threshold: 1.0 },
  { id: "act_b", scale_threshold: 4.0 },
];
const a1 = { ad_id: "a1", account_id: "act_a", roas: 2, spend: 500, cpa: 10, purchases: 50, ctr: 1, impressions: 10000, clicks: 100 };
const a2 = { ad_id: "a2", account_id: "act_a", roas: 1.5, spend: 300, cpa: 12, purchases: 25, ctr: 1, impressions: 8000, clicks: 80 };
const b1 = { ad_id: "b1", account_id: "act_b", roas: 2, spend: 500, cpa: 50, purchases: 10, ctr: 1, impressions: 10000, clicks: 100 };
const b2 = { ad_id: "b2", account_id: "act_b", roas: 5, spend: 300, cpa: 40, purchases: 8, ctr: 1, impressions: 8000, clicks: 80 };

describe("exportScoreMap", () => {
  it("scores each creative against its own account, the same as a single-account export", () => {
    const all = exportScoreMap([a1, a2, b1, b2], accounts);
    const onlyA = computeScoreMap([a1, a2], 1.0);
    const onlyB = computeScoreMap([b1, b2], 4.0);
    expect(all.get("a1")).toEqual(onlyA.get("a1"));
    expect(all.get("a2")).toEqual(onlyA.get("a2"));
    expect(all.get("b1")).toEqual(onlyB.get("b1"));
    expect(all.get("b2")).toEqual(onlyB.get("b2"));
  });

  it("the fixture really separates the two rules", () => {
    // Account B's 2x creative scored with account A's 1.0 threshold is not its real score.
    expect(computeScoreMap([a1, a2, b1, b2], 1.0).get("b1")).not.toEqual(computeScoreMap([b1, b2], 4.0).get("b1"));
  });

  it("scaleThresholdFor falls back to 2.0", () => {
    expect(scaleThresholdFor(accounts, "act_b")).toBe(4);
    expect(scaleThresholdFor(accounts, "all")).toBe(2);
  });
});

describe("Tag Performance export", () => {
  it("counts a winner against the creative's own account threshold", () => {
    const src = readFileSync(resolve(__dirname, "../components/settings/DataExportSection.tsx"), "utf8");
    expect(src).toMatch(/scaleThresholdFor\(accounts, \(?c(?: as any)?\)?\.account_id\)/);
  });
});
