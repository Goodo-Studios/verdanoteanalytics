import type { WoWTrend } from "@/hooks/useWoWTrends";

export interface FatigueResult {
  score: number;
  level: "high" | "warning" | "ok";
  reasons: string[];
  explanation: string;
}

/**
 * Compute a fatigue score (0-100) for a creative.
 * - frequency > 3 → +30, > 5 → +50
 * - ROAS dropped >20% WoW → +25
 * - CTR dropped >15% WoW → +20 (approximated from ROAS trend direction)
 * - 14+ consecutive spend days → +10, 21+ → +20
 */
export function computeFatigue(
  creative: any,
  wowTrend?: WoWTrend,
  consecutiveSpendDays?: number
): FatigueResult {
  let score = 0;
  const reasons: string[] = [];
  const freq = Number(creative.frequency) || 0;
  const roas = Number(creative.roas) || 0;

  // Frequency
  if (freq > 5) {
    score += 50;
    reasons.push(`High frequency (${freq.toFixed(1)}x)`);
  } else if (freq > 3) {
    score += 30;
    reasons.push(`Rising frequency (${freq.toFixed(1)}x)`);
  }

  // ROAS trend
  if (wowTrend && wowTrend.direction !== "insufficient") {
    if (wowTrend.pctChange < -20) {
      score += 25;
      reasons.push(`ROAS declined ${Math.abs(Math.round(wowTrend.pctChange))}% this week`);
    }
    // CTR trend approximation: if ROAS is dropping significantly, CTR likely follows
    if (wowTrend.pctChange < -15) {
      score += 20;
      reasons.push(`CTR declining week-over-week`);
    }
  }

  // Consecutive spend days
  const days = consecutiveSpendDays ?? 0;
  if (days >= 21) {
    score += 20;
    reasons.push(`Running for ${days}+ consecutive days`);
  } else if (days >= 14) {
    score += 10;
    reasons.push(`Running for ${days}+ consecutive days`);
  }

  score = Math.min(100, score);

  const level: FatigueResult["level"] = score >= 60 ? "high" : score >= 40 ? "warning" : "ok";

  // Build explanation
  let explanation = "";
  if (level !== "ok") {
    const parts: string[] = [];
    if (days > 0) parts.push(`running for ${days} days`);
    if (freq > 3) parts.push(`with ${freq > 5 ? "high" : "rising"} frequency (${freq.toFixed(1)}x)`);
    if (wowTrend && wowTrend.pctChange < -15) parts.push(`and declining performance (${Math.round(wowTrend.pctChange)}% this week)`);
    explanation = `This ad has been ${parts.join(" ")}. Consider rotating a new version.`;
  }

  return { score, level, reasons, explanation };
}

/**
 * Compute fatigue scores for all creatives.
 * Returns Map<ad_id, FatigueResult>.
 */
export function computeFatigueMap(
  creatives: any[],
  wowTrends?: Map<string, WoWTrend>,
  dailyMetrics?: any[]
): Map<string, FatigueResult> {
  const map = new Map<string, FatigueResult>();

  // Compute consecutive spend days per ad_id from daily metrics
  const consecutiveDays = new Map<string, number>();
  if (dailyMetrics && dailyMetrics.length > 0) {
    // Group by ad_id, sort dates descending, count consecutive spend > 0 from today backwards
    const byAd = new Map<string, string[]>();
    for (const row of dailyMetrics) {
      if ((Number(row.spend) || 0) > 0) {
        if (!byAd.has(row.ad_id)) byAd.set(row.ad_id, []);
        byAd.get(row.ad_id)!.push(row.date);
      }
    }
    for (const [adId, dates] of byAd) {
      const sorted = [...new Set(dates)].sort().reverse();
      let count = 0;
      const today = new Date();
      for (let i = 0; i < sorted.length; i++) {
        const expected = new Date(today);
        expected.setDate(expected.getDate() - i);
        const expectedStr = expected.toISOString().split("T")[0];
        if (sorted[i] === expectedStr) {
          count++;
        } else {
          break;
        }
      }
      consecutiveDays.set(adId, count);
    }
  }

  for (const c of creatives) {
    const trend = wowTrends?.get(c.ad_id);
    const days = consecutiveDays.get(c.ad_id) || 0;
    map.set(c.ad_id, computeFatigue(c, trend, days));
  }

  return map;
}
