/**
 * Portfolio reports belong to no single client (audit plan item 1.3).
 *
 * A portfolio report holds the numbers of several clients. The reports function used to set
 * account_id to the first account in the list, so that client's login could read every other
 * client's numbers through the "linked accounts" row rule. Now account_id is null (a database
 * check enforces it), and the staff Reports page lists a portfolio report under each of its
 * accounts through portfolio_account_ids.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { reportsForAccount } from "@/lib/reportFilters";

const reports = [
  { id: "r1", report_type: "standard", account_id: "act_a", portfolio_account_ids: null },
  { id: "r2", report_type: "standard", account_id: "act_b", portfolio_account_ids: null },
  { id: "p1", report_type: "portfolio", account_id: null, portfolio_account_ids: ["act_a", "act_c"] },
];

describe("portfolio report owner", () => {
  it("the reports function does not give a portfolio report a single owning account", () => {
    const src = readFileSync("supabase/functions/reports/index.ts", "utf8");
    expect(src).not.toMatch(/account_id:\s*account_ids\[0\]/);
  });

  it("all accounts shows every report", () => {
    expect(reportsForAccount(reports, "all").map((r) => r.id)).toEqual(["r1", "r2", "p1"]);
    expect(reportsForAccount(reports, null).map((r) => r.id)).toEqual(["r1", "r2", "p1"]);
  });

  it("one account shows its own reports and the portfolio reports that include it", () => {
    expect(reportsForAccount(reports, "act_a").map((r) => r.id)).toEqual(["r1", "p1"]);
    expect(reportsForAccount(reports, "act_b").map((r) => r.id)).toEqual(["r2"]);
    expect(reportsForAccount(reports, "act_c").map((r) => r.id)).toEqual(["p1"]);
  });

  it("the Reports page uses the shared filter", () => {
    expect(readFileSync("src/pages/ReportsPage.tsx", "utf8")).toMatch(/reportsForAccount\(/);
  });
});
