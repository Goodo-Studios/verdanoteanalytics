// F6 — Performance-classification service (Winner / Rising Star / Fatiguing).
//
// Roadmap foundation F6: a SINGLE, shared definition of how a creative is
// classified over the daily grain (public.creative_daily_metrics). The SQL RPC
// get_creative_classification (migration 20260716000001) computes the same
// window/recent/prior aggregates in Postgres and returns them per ad; this
// module is the pure, dependency-free rule layer that turns those aggregates
// into a label. Keeping the RULES here (not in SQL) means:
//   • the edge function and the frontend classify identically (one source of
//     truth for the thresholds), and
//   • the rules are unit-testable under `deno test` with no DB/network.
//
// It is intentionally dependency-free (no Deno, no esm.sh, no Supabase client)
// so it imports cleanly into a Deno edge function AND a Vitest/Node frontend.
//
// Percentages are TRUE percentages already (ctr, thumb_stop_rate, hold_rate are
// stored *100 on creative_daily_metrics — see the retention schema). We never
// re-multiply them here.

/** The four mutually-exclusive labels F6 assigns. */
export type CreativeClass = "winner" | "rising" | "fatiguing" | "neutral";

/**
 * Per-ad aggregates the classifier consumes. These are exactly the columns the
 * get_creative_classification RPC returns: a full-window roll-up plus a
 * recent-vs-prior split for trend detection. All ratios are DERIVED from summed
 * base metrics in SQL (never averaged), so they reconcile with spend.
 */
export interface ClassificationInput {
  ad_id: string;
  // ── Full-window totals / derived ratios ──────────────────────────────────
  spend: number;
  roas: number;
  cpa: number;
  ctr: number; // true percentage
  thumb_stop_rate: number; // true percentage
  purchases: number;
  frequency: number;
  // ── Recent vs prior split (equal halves of the window) for trend ──────────
  recent_spend: number;
  prior_spend: number;
  recent_roas: number;
  prior_roas: number;
  recent_ctr: number; // true percentage
  prior_ctr: number; // true percentage
  recent_cpa: number;
  prior_cpa: number;
}

/**
 * Tunable thresholds. Defaults are the builder-account v1 values; an account's
 * configured winner threshold can be threaded through `roasWinner` so the
 * Library agrees with the Overview win-rate (see src/lib/winnerSelection.ts).
 */
export interface ClassificationConfig {
  /** Minimum full-window spend for an ad to be classifiable at all. */
  minSpend: number;
  /** ROAS at/above which a well-spent ad is a Winner. */
  roasWinner: number;
  /** Thumbstop (%) that also qualifies a high-spend ad as a Winner. */
  thumbstopWinner: number;
  /** Spend percentile (0-1) an ad must clear to be considered "high spend". */
  highSpendPercentile: number;
  /** Relative ROAS improvement (recent vs prior) to count as Rising. */
  risingRoasDelta: number;
  /** Relative CTR improvement (recent vs prior) to count as Rising. */
  risingCtrDelta: number;
  /** Relative CTR decline (recent vs prior) that flags Fatiguing. */
  fatigueCtrDrop: number;
  /** Relative CPA rise (recent vs prior) that flags Fatiguing. */
  fatigueCpaRise: number;
  /** Frequency at/above which an ad is treated as saturated (fatigue signal). */
  fatigueFrequency: number;
}

export const DEFAULT_CLASSIFICATION_CONFIG: ClassificationConfig = {
  minSpend: 100,
  roasWinner: 2.0,
  thumbstopWinner: 30,
  highSpendPercentile: 0.6,
  risingRoasDelta: 0.15,
  risingCtrDelta: 0.15,
  fatigueCtrDrop: 0.15,
  fatigueCpaRise: 0.2,
  fatigueFrequency: 4,
};

/** Safe relative change (recent-prior)/prior; 0 when prior is non-positive. */
export function relChange(recent: number, prior: number): number {
  if (!(prior > 0)) return 0;
  return (recent - prior) / prior;
}

export interface ClassificationResult {
  ad_id: string;
  klass: CreativeClass;
  /** Human-readable reason(s) the label was assigned. */
  reasons: string[];
  /** Recent-vs-prior ROAS relative change (for sort/badges). */
  roasTrend: number;
  /** Recent-vs-prior CTR relative change. */
  ctrTrend: number;
  /** Recent-vs-prior CPA relative change (positive = getting worse). */
  cpaTrend: number;
}

/**
 * Classify one ad. `spendPercentile` is the ad's spend rank within the account
 * (0-1, computed by classifyAll) so "high spend" is relative, matching the
 * gradeCreatives thesis that Meta backs its winners with budget.
 *
 * Precedence is deliberate and mutually exclusive:
 *   1. Fatiguing — a spending ad whose recent trend is clearly deteriorating
 *      (CTR falling OR CPA rising) OR is frequency-saturated. Caught FIRST so a
 *      still-high-ROAS ad that is visibly decaying is surfaced as a risk, not
 *      hidden inside "winner".
 *   2. Winner — high relative spend and NOT fatiguing. Decided by SPEND FIRST,
 *      not ROAS (Meta backs its winners with budget); ROAS/thumbstop are context.
 *   3. Rising — improving recent-vs-prior trend (ROAS or CTR up) on a
 *      meaningfully-spending ad that hasn't yet earned Winner scale.
 *   4. Neutral — everything else (incl. sub-minSpend ads).
 */
export function classifyOne(
  input: ClassificationInput,
  spendPercentile: number,
  cfg: ClassificationConfig = DEFAULT_CLASSIFICATION_CONFIG,
): ClassificationResult {
  const roasTrend = relChange(input.recent_roas, input.prior_roas);
  const ctrTrend = relChange(input.recent_ctr, input.prior_ctr);
  const cpaTrend = relChange(input.recent_cpa, input.prior_cpa);
  const reasons: string[] = [];

  const base = (): ClassificationResult => ({
    ad_id: input.ad_id,
    klass: "neutral",
    reasons,
    roasTrend,
    ctrTrend,
    cpaTrend,
  });

  // Sub-scale ads are not classified (no signal).
  if ((input.spend || 0) < cfg.minSpend) {
    reasons.push(`Below minimum spend ($${cfg.minSpend})`);
    return base();
  }

  const highSpend = spendPercentile >= cfg.highSpendPercentile;
  const hasPriorSpend = input.prior_spend > 0 && input.recent_spend > 0;

  // ── 1. Fatiguing (checked first) ──────────────────────────────────────────
  const ctrDropping = hasPriorSpend && ctrTrend <= -cfg.fatigueCtrDrop;
  const cpaRising = hasPriorSpend && cpaTrend >= cfg.fatigueCpaRise;
  const saturated = (input.frequency || 0) >= cfg.fatigueFrequency;
  if (ctrDropping || cpaRising || saturated) {
    if (ctrDropping) reasons.push(`CTR down ${Math.round(Math.abs(ctrTrend) * 100)}% recent vs prior`);
    if (cpaRising) reasons.push(`CPA up ${Math.round(cpaTrend * 100)}% recent vs prior`);
    if (saturated) reasons.push(`Frequency ${input.frequency.toFixed(1)}x (saturated)`);
    return { ...base(), klass: "fatiguing" };
  }

  // ── 2. Winner — decided by SPEND FIRST, not ROAS ─────────────────────────
  // A top-spend, non-fatiguing ad is a Winner regardless of ROAS/efficiency:
  // Meta backs its winners with budget, so relative spend is the primary signal.
  // ROAS and thumbstop are surfaced as context only — never the gate.
  if (highSpend) {
    reasons.push(`Top-spend (${Math.round(spendPercentile * 100)}th pct) at scale`);
    if ((input.roas || 0) >= cfg.roasWinner) reasons.push(`ROAS ${input.roas.toFixed(2)}x`);
    if ((input.thumb_stop_rate || 0) >= cfg.thumbstopWinner) {
      reasons.push(`Thumbstop ${input.thumb_stop_rate.toFixed(0)}%`);
    }
    return { ...base(), klass: "winner" };
  }

  // ── 3. Rising ─────────────────────────────────────────────────────────────
  const roasImproving = hasPriorSpend && roasTrend >= cfg.risingRoasDelta;
  const ctrImproving = hasPriorSpend && ctrTrend >= cfg.risingCtrDelta;
  if (roasImproving || ctrImproving) {
    if (roasImproving) reasons.push(`ROAS up ${Math.round(roasTrend * 100)}% recent vs prior`);
    if (ctrImproving) reasons.push(`CTR up ${Math.round(ctrTrend * 100)}% recent vs prior`);
    return { ...base(), klass: "rising" };
  }

  return base();
}

/**
 * Classify a whole account's per-ad rows. Computes each ad's spend percentile
 * within the (>= minSpend) cohort, then labels each ad. Returns a Map keyed by
 * ad_id for O(1) lookup from a card grid.
 */
export function classifyAll(
  rows: ClassificationInput[],
  cfg: ClassificationConfig = DEFAULT_CLASSIFICATION_CONFIG,
): Map<string, ClassificationResult> {
  const out = new Map<string, ClassificationResult>();

  // Spend percentile is computed over the spending cohort so a long tail of
  // $0/near-$0 ads doesn't drag every real ad into the "high spend" bucket.
  const spendCohort = rows
    .filter((r) => (r.spend || 0) >= cfg.minSpend)
    .map((r) => r.spend || 0)
    .sort((a, b) => a - b);

  const percentileOf = (spend: number): number => {
    if (spendCohort.length === 0) return 0;
    if (spendCohort[0] === spendCohort[spendCohort.length - 1]) return 0.5;
    let count = 0;
    for (const v of spendCohort) {
      if (v < spend) count++;
      else break;
    }
    return count / spendCohort.length;
  };

  for (const r of rows) {
    out.set(r.ad_id, classifyOne(r, percentileOf(r.spend || 0), cfg));
  }
  return out;
}

/** Aggregate class counts, for the Library filter chips / summary header. */
export function classCounts(
  results: Iterable<ClassificationResult>,
): Record<CreativeClass, number> {
  const counts: Record<CreativeClass, number> = {
    winner: 0,
    rising: 0,
    fatiguing: 0,
    neutral: 0,
  };
  for (const r of results) counts[r.klass]++;
  return counts;
}
