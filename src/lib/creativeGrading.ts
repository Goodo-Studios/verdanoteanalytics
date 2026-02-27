export type Grade = "A" | "B" | "C" | "D" | "F";

export interface GradeInfo {
  grade: Grade;
  roasPercentile: number; // 0-100, higher = better
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
 * Compute percentile thresholds and grade each creative.
 * Returns a Map<ad_id, GradeInfo>.
 */
export function gradeCreatives(
  creatives: any[],
  killThreshold: number = 1.0
): Map<string, GradeInfo> {
  const grades = new Map<string, GradeInfo>();
  const withSpend = creatives.filter((c) => (Number(c.spend) || 0) > 0);
  if (withSpend.length === 0) return grades;

  // Sort ROAS values ascending for percentile calculation
  const roasValues = withSpend
    .map((c) => Number(c.roas) || 0)
    .sort((a, b) => a - b);
  const ctrValues = withSpend
    .map((c) => Number(c.ctr) || 0)
    .sort((a, b) => a - b);

  const percentile = (sorted: number[], value: number): number => {
    let count = 0;
    for (const v of sorted) {
      if (v < value) count++;
      else break;
    }
    return (count / sorted.length) * 100;
  };

  const median = roasValues[Math.floor(roasValues.length / 2)];

  for (const c of creatives) {
    const roas = Number(c.roas) || 0;
    const ctr = Number(c.ctr) || 0;
    const roasPct = percentile(roasValues, roas);
    const ctrPct = percentile(ctrValues, ctr);

    let grade: Grade;
    if (roas < killThreshold) {
      grade = "F";
    } else if (roasPct >= 80 && ctrPct >= 70) {
      grade = "A";
    } else if (roasPct >= 60) {
      grade = "B";
    } else if (roas >= median * 0.8) {
      grade = "C";
    } else {
      grade = "D";
    }

    grades.set(c.ad_id, { grade, roasPercentile: Math.round(roasPct) });
  }

  return grades;
}

/** Numeric value for sorting grades (lower = better) */
export function gradeOrder(grade: Grade): number {
  const map: Record<Grade, number> = { A: 1, B: 2, C: 3, D: 4, F: 5 };
  return map[grade] ?? 6;
}
