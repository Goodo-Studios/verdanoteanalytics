/**
 * The Creatives page shows the grade the server worked out over the whole list
 * (audit plan item 7.1, part 2).
 *
 * The page graded only the 100 rows it had loaded, so the same ad could be an A on one page
 * and a C on the next. creatives_list_page now returns grade and spend_percentile per row;
 * the page uses them and only falls back to grading the page when they are missing.
 */
import { describe, expect, it } from "vitest";
import { gradeCreatives, pageGrades } from "@/lib/creativeGrading";

// Page two of a spend-sorted list: these are the lowest spenders on this page, but over the
// whole account the server placed them at the 70th and 45th percentiles.
const pageTwo = [
  { ad_id: "x1", spend: 500, grade: "B", spend_percentile: 70 },
  { ad_id: "x2", spend: 200, grade: "C", spend_percentile: 45 },
  { ad_id: "x3", spend: 0, grade: null, spend_percentile: null },
];

describe("pageGrades", () => {
  it("uses the grades the server worked out over the whole list", () => {
    const g = pageGrades(pageTwo);
    expect(g.get("x1")).toEqual({ grade: "B", spendPercentile: 70 });
    expect(g.get("x2")).toEqual({ grade: "C", spendPercentile: 45 });
    expect(g.has("x3")).toBe(false);
  });

  it("the fixture really differs from grading the page alone", () => {
    expect(gradeCreatives(pageTwo).get("x1")?.grade).not.toBe("B");
  });

  it("falls back to grading the page when the server sent no grades", () => {
    const rows = [{ ad_id: "a", spend: 10 }, { ad_id: "b", spend: 20 }];
    expect(pageGrades(rows)).toEqual(gradeCreatives(rows));
  });
});
