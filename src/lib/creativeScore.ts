import type { WoWTrend } from "@/hooks/useWoWTrends";
import type { FatigueResult } from "@/lib/fatigueScore";

export interface ScoreBreakdown {
  roas: number;       // 0-35
  ctr: number;        // 0-20
  hookRate: number;    // 0-15
  cpaEfficiency: number; // 0-10
  momentum: number;    // 0-10
  fatiguePenalty: number; // 0 to -10
  total: number;       // 0-100
}

export interface CreativeScore {
  score: number;
  breakdown: ScoreBreakdown;
  tier: "green" | "amber" | "red";
}

/**
 * Compute a unified Creative Score (0-100) combining all performance signals.
 */
export function computeCreativeScore(
  creative: any,
  opts: {
    scaleThreshold?: number;
    avgCpa?: number;
    wowTrend?: WoWTrend;
    fatigue?: FatigueResult;
  }
): CreativeScore {
  const scaleThreshold = opts.scaleThreshold || 2.0;
  const roas = Number(creative.roas) || 0;
  const ctr = Number(creative.ctr) || 0;
  const hookRate = Number(creative.thumb_stop_rate) || 0;
  const cpa = Number(creative.cpa) || 0;

  // ROAS component (35 pts max)
  const roasScore = Math.min(35, (roas / scaleThreshold) * 35);

  // CTR component (20 pts max) — 3% CTR = full 20 pts
  const ctrScore = Math.min(20, (ctr / 3.0) * 20);

  // Hook Rate component (15 pts max) — 25% = full 15 pts
  const hookRateScore = Math.min(15, (hookRate / 25) * 15);

  // CPA efficiency (10 pts max) — at or below avg = 10, scales to 0 at 2x avg
  let cpaScore = 0;
  if (opts.avgCpa && opts.avgCpa > 0 && cpa > 0) {
    const ratio = cpa / opts.avgCpa;
    if (ratio <= 1) {
      cpaScore = 10;
    } else if (ratio < 2) {
      cpaScore = 10 * (1 - (ratio - 1));
    }
  } else if (cpa === 0 && (Number(creative.spend) || 0) === 0) {
    cpaScore = 0; // no spend = no score
  }

  // Momentum bonus (10 pts max)
  let momentumScore = 5; // default neutral
  if (opts.wowTrend && opts.wowTrend.direction !== "insufficient") {
    if (opts.wowTrend.direction === "up") momentumScore = 10;
    else if (opts.wowTrend.direction === "flat") momentumScore = 5;
    else momentumScore = 0; // down
  }

  // Fatigue penalty (0 to -10)
  let fatiguePenalty = 0;
  if (opts.fatigue) {
    fatiguePenalty = -Math.min(10, opts.fatigue.score / 10);
  }

  const total = Math.max(0, Math.min(100, Math.round(
    roasScore + ctrScore + hookRateScore + cpaScore + momentumScore + fatiguePenalty
  )));

  const tier = total >= 75 ? "green" : total >= 50 ? "amber" : "red";

  return {
    score: total,
    breakdown: {
      roas: Math.round(roasScore * 10) / 10,
      ctr: Math.round(ctrScore * 10) / 10,
      hookRate: Math.round(hookRateScore * 10) / 10,
      cpaEfficiency: Math.round(cpaScore * 10) / 10,
      momentum: momentumScore,
      fatiguePenalty: Math.round(fatiguePenalty * 10) / 10,
      total,
    },
    tier,
  };
}

/**
 * Compute scores for all creatives. Returns Map<ad_id, CreativeScore>.
 */
export function computeScoreMap(
  creatives: any[],
  scaleThreshold: number,
  wowTrends?: Map<string, WoWTrend>,
  fatigueMap?: Map<string, FatigueResult>,
): Map<string, CreativeScore> {
  const map = new Map<string, CreativeScore>();
  if (creatives.length === 0) return map;

  // Compute average CPA
  const withSpend = creatives.filter((c: any) => (Number(c.spend) || 0) > 0 && (Number(c.cpa) || 0) > 0);
  const avgCpa = withSpend.length > 0
    ? withSpend.reduce((s: number, c: any) => s + (Number(c.cpa) || 0), 0) / withSpend.length
    : 0;

  for (const c of creatives) {
    map.set(c.ad_id, computeCreativeScore(c, {
      scaleThreshold,
      avgCpa,
      wowTrend: wowTrends?.get(c.ad_id),
      fatigue: fatigueMap?.get(c.ad_id),
    }));
  }

  return map;
}
