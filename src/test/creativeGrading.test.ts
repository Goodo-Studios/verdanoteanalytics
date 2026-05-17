import { describe, it, expect } from "vitest";
import { gradeCreatives, gradeOrder } from "@/lib/creativeGrading";

const creative = (ad_id: string, roas: number, ctr: number, spend: number) => ({
  ad_id,
  roas,
  ctr,
  spend,
});

describe("gradeCreatives", () => {
  it("returns empty map when all creatives have zero spend", () => {
    const result = gradeCreatives([
      creative("a1", 2.0, 0.02, 0),
      creative("a2", 1.5, 0.01, 0),
    ]);
    expect(result.size).toBe(0);
  });

  it("returns empty map when input is empty", () => {
    expect(gradeCreatives([]).size).toBe(0);
  });

  it("grades F when ROAS is below killThreshold", () => {
    const creatives = [
      creative("bad", 0.5, 0.03, 500),
      creative("good", 3.0, 0.05, 500),
      creative("great", 5.0, 0.08, 500),
    ];
    const result = gradeCreatives(creatives, 1.0);
    expect(result.get("bad")!.grade).toBe("F");
  });

  it("grades A for top ROAS + top CTR", () => {
    // 5 creatives — top ROAS (rank 5/5 = 80th pct) + top CTR earns A
    const creatives = [
      creative("c1", 1.0, 0.01, 100),
      creative("c2", 1.5, 0.02, 100),
      creative("c3", 2.0, 0.03, 100),
      creative("c4", 3.0, 0.04, 100),
      creative("c5", 5.0, 0.06, 100),
    ];
    const result = gradeCreatives(creatives, 1.0);
    expect(result.get("c5")!.grade).toBe("A");
  });

  it("roasPercentile is clamped to 0-100 integer", () => {
    const creatives = [creative("only", 2.0, 0.03, 200)];
    const result = gradeCreatives(creatives, 1.0);
    const pct = result.get("only")!.roasPercentile;
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
    expect(Number.isInteger(pct)).toBe(true);
  });

  it("handles zero roas (not NaN) gracefully", () => {
    const creatives = [
      creative("zero", 0, 0, 100),
      creative("pos", 2.0, 0.03, 100),
    ];
    expect(() => gradeCreatives(creatives, 1.0)).not.toThrow();
    const result = gradeCreatives(creatives, 1.0);
    expect(result.get("zero")!.grade).toBe("F");
  });

  it("handles null/undefined fields without throwing", () => {
    const creatives = [
      { ad_id: "n1", roas: null, ctr: undefined, spend: 100 },
      { ad_id: "n2", roas: 2.0, ctr: 0.03, spend: 100 },
    ];
    expect(() => gradeCreatives(creatives as any, 1.0)).not.toThrow();
  });
});

describe("gradeOrder", () => {
  it("A sorts before F", () => {
    expect(gradeOrder("A")).toBeLessThan(gradeOrder("F"));
  });

  it("grades sort in correct order A < B < C < D < F", () => {
    const grades = ["B", "D", "A", "F", "C"] as const;
    const sorted = [...grades].sort((a, b) => gradeOrder(a) - gradeOrder(b));
    expect(sorted).toEqual(["A", "B", "C", "D", "F"]);
  });
});
