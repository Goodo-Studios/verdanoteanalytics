import { describe, it, expect } from "vitest";
import { gradeCreatives, gradeOrder } from "@/lib/creativeGrading";

const creative = (ad_id: string, spend: number, roas = 0, ctr = 0) => ({
  ad_id,
  spend,
  roas,
  ctr,
});

describe("gradeCreatives", () => {
  it("returns empty map when all creatives have zero spend", () => {
    const result = gradeCreatives([
      creative("a1", 0, 2.0, 0.02),
      creative("a2", 0, 1.5, 0.01),
    ]);
    expect(result.size).toBe(0);
  });

  it("returns empty map when input is empty", () => {
    expect(gradeCreatives([]).size).toBe(0);
  });

  it("does not grade zero-spend creatives (no Meta backing = no grade)", () => {
    const result = gradeCreatives([
      creative("spent", 500),
      creative("unspent", 0),
    ]);
    expect(result.has("spent")).toBe(true);
    expect(result.has("unspent")).toBe(false);
  });

  it("grades by spend percentile: top spender A, bottom spender F", () => {
    // 5 creatives, evenly spaced spend → percentiles 0/20/40/60/80
    const creatives = [
      creative("s1", 100),
      creative("s2", 200),
      creative("s3", 300),
      creative("s4", 400),
      creative("s5", 500),
    ];
    const result = gradeCreatives(creatives);
    expect(result.get("s5")!.grade).toBe("A"); // 80th pct
    expect(result.get("s4")!.grade).toBe("B"); // 60th pct
    expect(result.get("s3")!.grade).toBe("C"); // 40th pct
    expect(result.get("s2")!.grade).toBe("D"); // 20th pct
    expect(result.get("s1")!.grade).toBe("F"); // 0th pct
  });

  it("ignores ROAS entirely: high spend + low ROAS still grades best", () => {
    const creatives = [
      creative("lowspend_highroas", 50, 10.0, 0.09),
      creative("highspend_lowroas", 5000, 0.3, 0.005),
    ];
    const result = gradeCreatives(creatives);
    // ROAS ignored — pure spend ranking. Top spender outranks despite worse ROAS.
    expect(
      gradeOrder(result.get("highspend_lowroas")!.grade),
    ).toBeLessThan(gradeOrder(result.get("lowspend_highroas")!.grade));
    expect(result.get("lowspend_highroas")!.grade).toBe("F");
  });

  it("spendPercentile is clamped to 0-100 integer", () => {
    const creatives = [creative("only", 200)];
    const result = gradeCreatives(creatives);
    const pct = result.get("only")!.spendPercentile;
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
    expect(Number.isInteger(pct)).toBe(true);
  });

  it("handles null/undefined fields without throwing", () => {
    const creatives = [
      { ad_id: "n1", spend: 100, roas: null, ctr: undefined },
      { ad_id: "n2", spend: 200, roas: 2.0, ctr: 0.03 },
    ];
    expect(() => gradeCreatives(creatives as any)).not.toThrow();
    expect(gradeCreatives(creatives as any).size).toBe(2);
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
