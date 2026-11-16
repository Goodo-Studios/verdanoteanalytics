/**
 * Creative scores and scale thresholds for the data exports (audit plan item 6.5, part 6).
 */
import { computeScoreMap } from "@/lib/creativeScore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
type AccountLike = { id: string; scale_threshold?: number | string | null };

/** An account's scale threshold (ROAS a creative must reach to count as scaling); 2.0 if unset. */
export function scaleThresholdFor(accounts: AccountLike[], accountId: string | null | undefined): number {
  const account = accounts.find((a) => a.id === accountId);
  return parseFloat(String(account?.scale_threshold || "2.0"));
}

export function exportScoreMap(rows: Row[], accounts: AccountLike[]): ReturnType<typeof computeScoreMap> {
  return computeScoreMap(rows, scaleThresholdFor(accounts, rows[0]?.account_id));
}
