/**
 * Creative scores and scale thresholds for the data exports (audit plan item 6.5, part 6).
 *
 * An "All accounts" export holds several accounts, each with its own scale threshold and its
 * own average CPA. Scores are worked out per account, so a creative gets the same score it
 * would get in a single-account export.
 */
import { computeScoreMap } from "@/lib/creativeScore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
type AccountLike = { id: string; scale_threshold?: number | string | null };
type ScoreMap = ReturnType<typeof computeScoreMap>;

/** An account's scale threshold (ROAS a creative must reach to count as scaling); 2.0 if unset. */
export function scaleThresholdFor(accounts: AccountLike[], accountId: string | null | undefined): number {
  const account = accounts.find((a) => a.id === accountId);
  return parseFloat(String(account?.scale_threshold || "2.0"));
}

export function exportScoreMap(rows: Row[], accounts: AccountLike[]): ScoreMap {
  const byAccount = new Map<string, Row[]>();
  for (const r of rows) {
    const key = String(r?.account_id ?? "");
    const list = byAccount.get(key) ?? [];
    list.push(r);
    byAccount.set(key, list);
  }
  const out: ScoreMap = new Map();
  for (const [accountId, list] of byAccount) {
    for (const [adId, score] of computeScoreMap(list, scaleThresholdFor(accounts, accountId))) {
      out.set(adId, score);
    }
  }
  return out;
}
