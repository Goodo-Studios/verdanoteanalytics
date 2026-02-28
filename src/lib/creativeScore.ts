import type { WoWTrend } from "@/hooks/useWoWTrends";
import type { FatigueResult } from "@/lib/fatigueScore";

export interface ScoringConfig {
  roas_weight: number;
  ctr_weight: number;
  hook_rate_weight: number;
  spend_efficiency_weight: number;
  momentum_weight: number;
  fatigue_weight: number;
  scale_threshold: number;
  kill_threshold: number;
  min_spend: number;
  ctr_benchmark: number;
  hook_rate_benchmark: number;
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  roas_weight: 35,
  ctr_weight: 20,
  hook_rate_weight: 15,
  spend_efficiency_weight: 10,
  momentum_weight: 10,
  fatigue_weight: 10,
  scale_threshold: 2.0,
  kill_threshold: 0.8,
  min_spend: 100,
  ctr_benchmark: 3.0,
  hook_rate_benchmark: 25.0,
};

export interface ScoreBreakdown {
  roas: number;
  ctr: number;
  hookRate: number;
  cpaEfficiency: number;
  momentum: number;
  fatiguePenalty: number;
  total: number;
}

export interface CreativeScore {
  score: number;
  breakdown: ScoreBreakdown;
  tier: "green" | "amber" | "red";
}

/**
 * Compute a unified Creative Score (0-100) combining all performance signals.
 * Uses configurable weights from ScoringConfig.
 */
export function computeCreativeScore(
  creative: any,
  opts: {
    scaleThreshold?: number;
    avgCpa?: number;
    wowTrend?: WoWTrend;
    fatigue?: FatigueResult;
  },
  cfg: ScoringConfig = DEFAULT_SCORING_CONFIG,
): CreativeScore {
  const scaleThreshold = opts.scaleThreshold || cfg.scale_threshold;
  const roas = Number(creative.roas) || 0;
  const ctr = Number(creative.ctr) || 0;
  const hookRate = Number(creative.thumb_stop_rate) || 0;
  const cpa = Number(creative.cpa) || 0;

  // Each component is scored 0-1, then multiplied by its weight
  // ROAS component — ratio to scale threshold, capped at 1
  const roasRatio = Math.min(1, roas / scaleThreshold);
  const roasScore = roasRatio * cfg.roas_weight;

  // CTR component — ratio to benchmark, capped at 1
  const ctrRatio = Math.min(1, ctr / cfg.ctr_benchmark);
  const ctrScore = ctrRatio * cfg.ctr_weight;

  // Hook Rate component — ratio to benchmark, capped at 1
  const hookRatio = Math.min(1, hookRate / cfg.hook_rate_benchmark);
  const hookRateScore = hookRatio * cfg.hook_rate_weight;

  // CPA efficiency — at or below avg = full marks, scales to 0 at 2x avg
  let cpaScore = 0;
  if (opts.avgCpa && opts.avgCpa > 0 && cpa > 0) {
    const ratio = cpa / opts.avgCpa;
    if (ratio <= 1) {
      cpaScore = cfg.spend_efficiency_weight;
    } else if (ratio < 2) {
      cpaScore = cfg.spend_efficiency_weight * (1 - (ratio - 1));
    }
  } else if (cpa === 0 && (Number(creative.spend) || 0) === 0) {
    cpaScore = 0;
  }

  // Momentum bonus
  let momentumRatio = 0.5; // default neutral
  if (opts.wowTrend && opts.wowTrend.direction !== "insufficient") {
    if (opts.wowTrend.direction === "up") momentumRatio = 1;
    else if (opts.wowTrend.direction === "flat") momentumRatio = 0.5;
    else momentumRatio = 0;
  }
  const momentumScore = momentumRatio * cfg.momentum_weight;

  // Fatigue penalty (subtracted)
  let fatiguePenalty = 0;
  if (opts.fatigue) {
    fatiguePenalty = -Math.min(cfg.fatigue_weight, (opts.fatigue.score / 100) * cfg.fatigue_weight);
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
      momentum: Math.round(momentumScore * 10) / 10,
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
  scoringConfig?: ScoringConfig,
): Map<string, CreativeScore> {
  const cfg = scoringConfig || DEFAULT_SCORING_CONFIG;
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
    }, cfg));
  }

  return map;
}
