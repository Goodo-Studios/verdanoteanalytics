/**
 * Single source of truth for "who is a winner" on the frontend.
 *
 * SPEND FIRST, not ROAS. A top-spend, non-fatiguing creative is a Winner
 * regardless of efficiency — Meta backs its winners with budget, so relative
 * spend is the primary signal. ROAS and thumbstop are context, never the gate.
 *
 * This previously gated on a ROAS threshold (`roas >= 2.0`), which disagreed
 * with the Creative Library classifier
 * (`supabase/functions/_shared/creative-classification.ts`) — the two surfaces
 * could label different ads as winners for the same account on the same day.
 * The gate below mirrors `classifyAll`'s spend-percentile cohort logic exactly;
 * `src/test/winnerSelection.test.ts` pins the two implementations to the same
 * answers, since the classifier is Deno-flavoured and cannot be imported here.
 *
 * KNOWN DIVERGENCE FROM THE CLASSIFIER: fatigue takes precedence there (a
 * deteriorating high-spend ad is a risk, not a winner), but that needs
 * recent-vs-prior window metrics which neither frontend caller loads. A
 * high-spend ad that is visibly decaying will therefore still count as a winner
 * on the Overview while the Library shows it as Fatiguing. Thread a fatigue set
 * through `excludeAdIds` where the caller has one.
 */

/** Mirrors DEFAULT_CLASSIFICATION_CONFIG — keep these in lockstep. */
export const DEFAULT_MIN_SPEND = 100;
export const DEFAULT_HIGH_SPEND_PERCENTILE = 0.6;

export interface WinnerThresholdConfig {
  /** Minimum spend for an ad to be classifiable at all. */
  minSpend?: number;
  /** Spend percentile (0-1) an ad must clear to count as high spend. */
  highSpendPercentile?: number;
  /** Ad ids known to be fatiguing — excluded even at high spend. */
  excludeAdIds?: ReadonlySet<string>;
}

/**
 * Spend percentile within the spending cohort, mirroring `classifyAll`.
 *
 * The cohort is deliberately limited to ads at or above `minSpend`: a long tail
 * of $0 / near-$0 ads would otherwise drag every real ad into the high-spend
 * bucket and make almost everything a winner.
 */
export function spendPercentiles(
  spends: number[],
  minSpend: number = DEFAULT_MIN_SPEND,
): (spend: number) => number {
  const cohort = spends.filter((s) => (s || 0) >= minSpend).sort((a, b) => a - b);
  return (spend: number): number => {
    if (cohort.length === 0) return 0;
    if (cohort[0] === cohort[cohort.length - 1]) return 0.5;
    let count = 0;
    for (const v of cohort) {
      if (v < spend) count++;
      else break;
    }
    return count / cohort.length;
  };
}

/**
 * Select the winning creatives, ranked by spend (biggest bets first).
 *
 * `creatives` must be the full candidate cohort for the account, not a
 * pre-filtered slice — the percentile is computed relative to whatever is
 * passed in, so handing this a truncated top-N page yields a stricter gate
 * than the Library applies over the whole account.
 */
export function selectWinners<T extends Record<string, any>>(
  creatives: T[],
  config: WinnerThresholdConfig = {},
): T[] {
  const minSpend = config.minSpend ?? DEFAULT_MIN_SPEND;
  const highSpendPercentile = config.highSpendPercentile ?? DEFAULT_HIGH_SPEND_PERCENTILE;
  const exclude = config.excludeAdIds;

  const percentileOf = spendPercentiles(
    creatives.map((c) => Number(c.spend) || 0),
    minSpend,
  );

  return creatives
    .filter((c) => {
      const spend = Number(c.spend) || 0;
      if (spend < minSpend) return false;
      if (exclude?.has(String(c.ad_id))) return false;
      return percentileOf(spend) >= highSpendPercentile;
    })
    .sort((a, b) => (Number(b.spend) || 0) - (Number(a.spend) || 0));
}
