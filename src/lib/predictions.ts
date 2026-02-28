import type { WoWTrend } from "@/hooks/useWoWTrends";
import type { FatigueResult } from "@/lib/fatigueScore";

export type PredictionAction = "scale" | "hold" | "iterate" | "pause";

export interface CreativePrediction {
  action: PredictionAction;
  projectedSpend7d: number;
  projectedRoas: number;
  recommendation: string;
  shortLabel: string;
}

const ACTION_META: Record<PredictionAction, { shortLabel: string }> = {
  scale: { shortLabel: "Scale Now" },
  hold: { shortLabel: "Hold" },
  iterate: { shortLabel: "Prepare Iteration" },
  pause: { shortLabel: "Pause" },
};

/**
 * Rule-based performance prediction for a single creative.
 */
export function predictCreative(
  creative: any,
  wowTrend?: WoWTrend,
  fatigue?: FatigueResult,
  killThreshold = 1.0
): CreativePrediction {
  const spend = Number(creative.spend) || 0;
  const roas = Number(creative.roas) || 0;
  const freq = Number(creative.frequency) || 0;
  const fatigueScore = fatigue?.score ?? 0;
  const wowPctChange = wowTrend?.pctChange ?? 0;
  const wowDirection = wowTrend?.direction ?? "insufficient";

  // ── Project spend ──
  // Use daily spend average × 7; if WoW data is present, apply momentum factor
  const daysActive = Math.max(1, Math.ceil(spend / Math.max(1, (Number(creative.cpm) || 5) * (Number(creative.impressions) || 100) / 1000)));
  const dailySpend = spend > 0 ? spend / Math.max(daysActive, 7) : 0;
  let momentumFactor = 1.0;
  if (wowDirection === "up") momentumFactor = 1 + Math.min(wowPctChange, 50) / 100;
  else if (wowDirection === "down") momentumFactor = Math.max(0.5, 1 + wowPctChange / 100);
  const projectedSpend7d = dailySpend * 7 * momentumFactor;

  // ── Project ROAS ──
  let projectedRoas = roas;
  if (wowTrend && wowDirection !== "insufficient") {
    const adjustedChange = wowPctChange * 0.5; // dampened projection
    projectedRoas = roas * (1 + adjustedChange / 100);
  }
  projectedRoas = Math.max(0, projectedRoas);

  // ── Determine action ──
  let action: PredictionAction;

  if (roas < killThreshold && wowPctChange < -20) {
    action = "pause";
  } else if (fatigueScore > 60 || wowPctChange < -15) {
    action = "iterate";
  } else if (fatigueScore < 30 && wowPctChange > 0 && freq < 3) {
    action = "scale";
  } else {
    action = "hold";
  }

  // ── Build recommendation text ──
  const recommendation = buildRecommendation(action, roas, freq, fatigueScore, wowPctChange);

  return {
    action,
    projectedSpend7d,
    projectedRoas,
    recommendation,
    shortLabel: ACTION_META[action].shortLabel,
  };
}

function buildRecommendation(
  action: PredictionAction,
  roas: number,
  freq: number,
  fatigueScore: number,
  wowPct: number
): string {
  switch (action) {
    case "scale":
      return `Scale now — momentum is strong, ROAS holding at ${roas.toFixed(1)}x, frequency low (${freq.toFixed(1)}x)`;
    case "hold":
      return "Hold — performance is stable but not accelerating";
    case "iterate":
      return `Prepare iteration — ${fatigueScore > 60 ? "fatigue score rising" : `ROAS declining ${Math.abs(Math.round(wowPct))}% WoW`}, recommend fresh variant in 7-10 days`;
    case "pause":
      return `Pause — ROAS declining to ${roas.toFixed(1)}x, ${freq > 3 ? `frequency high (${freq.toFixed(1)}x), ` : ""}diminishing returns`;
  }
}

/**
 * Batch-classify all creatives and return counts per action.
 */
export function computePredictionCounts(
  creatives: any[],
  wowTrends?: Map<string, WoWTrend>,
  fatigueMap?: Map<string, FatigueResult>,
  killThreshold = 1.0,
  minSpend = 10
): { scale: string[]; hold: string[]; iterate: string[]; pause: string[] } {
  const result = { scale: [] as string[], hold: [] as string[], iterate: [] as string[], pause: [] as string[] };

  for (const c of creatives) {
    if ((Number(c.spend) || 0) < minSpend) continue;
    const prediction = predictCreative(
      c,
      wowTrends?.get(c.ad_id),
      fatigueMap?.get(c.ad_id),
      killThreshold
    );
    result[prediction.action].push(c.ad_id);
  }

  return result;
}
