export type Grade = "A" | "B" | "C" | "D" | "F";

export interface GradeInfo {
  grade: Grade;
  spendPercentile: number; // 0-100, higher = more spend = better
}

export interface GradeStyle {
  bg: string;
  text: string;
}

export const GRADE_STYLES: Record<Grade, GradeStyle> = {
  A: { bg: "bg-emerald-700", text: "text-white" },
  B: { bg: "bg-emerald-500", text: "text-white" },
  C: { bg: "bg-amber-400", text: "text-amber-950" },
  D: { bg: "bg-orange-500", text: "text-white" },
  F: { bg: "bg-red-600", text: "text-white" },
};

/**
 * Grade each creative purely by spend percentile within the account.
 *
 * Thesis: Meta allocates spend to the ads it predicts will perform best, so
 * spend itself is the truth signal. The more spend an ad carries relative to
 * its peers, the higher its grade. ROAS/CTR are intentionally NOT factored in.
 *
 * Only ads with spend > 0 are graded; an ad Meta hasn't backed has no grade.
 * Returns a Map<ad_id, GradeInfo>.
 */
export function gradeCreatives(creatives: any[]): Map<string, GradeInfo> {
  const grades = new Map<string, GradeInfo>();
  const withSpend = creatives.filter((c) => (Number(c.spend) || 0) > 0);
  if (withSpend.length === 0) return grades;

  // Sort spend values ascending for percentile calculation
  const spendValues = withSpend
    .map((c) => Number(c.spend) || 0)
    .sort((a, b) => a - b);

  const percentile = (sorted: number[], value: number): number => {
    let count = 0;
    for (const v of sorted) {
      if (v < value) count++;
      else break;
    }
    return (count / sorted.length) * 100;
  };

  for (const c of withSpend) {
    const spend = Number(c.spend) || 0;
    const spendPct = percentile(spendValues, spend);

    let grade: Grade;
    if (spendPct >= 80) {
      grade = "A";
    } else if (spendPct >= 60) {
      grade = "B";
    } else if (spendPct >= 40) {
      grade = "C";
    } else if (spendPct >= 20) {
      grade = "D";
    } else {
      grade = "F";
    }

    grades.set(c.ad_id, { grade, spendPercentile: Math.round(spendPct) });
  }

  return grades;
}

/** Numeric value for sorting grades (lower = better) */
export function gradeOrder(grade: Grade): number {
  const map: Record<Grade, number> = { A: 1, B: 2, C: 3, D: 4, F: 5 };
  return map[grade] ?? 6;
}
