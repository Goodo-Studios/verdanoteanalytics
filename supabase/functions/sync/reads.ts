// Database reads used by the sync function: one account's creatives, name mappings and
// daily metrics.
//
// Audit 7.3: PostgREST returns at most max_rows (1,000) rows per response and drops the rest
// without an error. Every read here pages through the shared fetchAllRows, which orders by a
// unique key, stops only on an empty page, and throws on a page error so a partial list is
// never acted on as if it were complete.
// deno-lint-ignore-file no-explicit-any
import { fetchAllRows, PAGE_SIZE } from "../_shared/paging.ts";

type Db = { from: (table: string) => any };

/** Creatives above the spend threshold, for the winner/concern Slack alert. */
export function loadAlertCandidates(db: Db, accountId: string, spendThreshold: number): Promise<any[]> {
  return fetchAllRows<any>((from, to) =>
    db
      .from("creatives")
      .select("ad_id, ad_name, roas, prior_roas, spend")
      .eq("account_id", accountId)
      .gt("spend", spendThreshold)
      .order("ad_id")
      .range(from, to)
  );
}

/** Ad ids whose tags were set by hand or by CSV, so Phase 1 keeps their tags. */
export async function loadProtectedTagAdIds(db: Db, accountId: string): Promise<Set<string>> {
  const rows = await fetchAllRows<{ ad_id: string }>((from, to) =>
    db.from("creatives").select("ad_id")
      .eq("account_id", accountId).in("tag_source", ["manual", "csv"])
      .order("ad_id")
      .range(from, to)
  );
  return new Set(rows.map((a) => a.ad_id));
}

/** The account's name mappings keyed by unique code (unique per account: the upsert key). */
export async function loadMappingsByCode(db: Db, accountId: string): Promise<Map<string, Record<string, unknown>>> {
  const rows = await fetchAllRows<Record<string, any>>((from, to) =>
    db
      .from("name_mappings")
      .select("*")
      .eq("account_id", accountId)
      .order("unique_code")
      .range(from, to)
  );
  const byCode = new Map<string, Record<string, unknown>>();
  for (const m of rows) {
    if (m.unique_code) byCode.set(m.unique_code, m);
  }
  return byCode;
}

export type AutoParseCandidate = { ad_id: string; ad_name: string; tag_source: string; parsed_ad_name: string | null };

/** Untagged and parsed creatives, the candidates for the auto-parse pass. */
export function loadAutoParseCandidates(db: Db, accountId: string): Promise<AutoParseCandidate[]> {
  return fetchAllRows<AutoParseCandidate>((from, to) =>
    db
      .from("creatives")
      .select("ad_id, ad_name, tag_source, parsed_ad_name")
      .eq("account_id", accountId)
      .in("tag_source", ["untagged", "parsed"])
      .order("ad_id")
      .range(from, to)
  );
}

/** Creatives with spend and impressions, for the Creative Score snapshot. */
export function loadScoreCreatives(db: Db, accountId: string): Promise<any[]> {
  return fetchAllRows<any>((from, to) =>
    db
      .from("creatives")
      .select("ad_id, roas, ctr, thumb_stop_rate, cpa, spend, ad_status")
      .eq("account_id", accountId)
      .gt("spend", 0)
      .gt("impressions", 0)
      .order("ad_id")
      .range(from, to)
  );
}

/** Creatives with impressions, for the changelog and notifications. */
export function loadChangelogCreatives(db: Db, accountId: string): Promise<any[]> {
  return fetchAllRows<any>((from, to) =>
    db
      .from("creatives")
      .select("ad_id, ad_name, roas, prior_roas, spend, ad_status")
      .eq("account_id", accountId)
      .gt("impressions", 0)
      .order("ad_id")
      .range(from, to)
  );
}

/** Zero-spend creatives that had a prior ROAS (paused ads). */
export function loadPausedCreatives(db: Db, accountId: string): Promise<any[]> {
  return fetchAllRows<any>((from, to) =>
    db
      .from("creatives")
      .select("ad_id, ad_name, prior_roas")
      .eq("account_id", accountId)
      .eq("spend", 0)
      .not("prior_roas", "is", null)
      .gt("prior_roas", 0)
      .order("ad_id")
      .range(from, to)
  );
}

export type LocalAuditTotals = { spend: number; impressions: number; rows: number; complete: boolean };

/**
 * Sum the account's daily spend and impressions over [start, end] for the post-sync audit.
 * Pages in (ad_id, date) order (the table's unique key) until an empty page. A timeout or a
 * failed page marks the audit incomplete: partial sums must not masquerade as a completed
 * audit, since they read as under-reporting and would fire false drift alerts.
 */
export async function sumLocalDailyMetrics(
  db: Db,
  accountId: string,
  start: string,
  end: string,
  isTimedOut: () => boolean,
): Promise<LocalAuditTotals> {
  const totals: LocalAuditTotals = { spend: 0, impressions: 0, rows: 0, complete: true };
  let offset = 0;
  while (true) {
    if (isTimedOut()) {
      console.warn("  Post-sync audit interrupted by budget, marking incomplete");
      totals.complete = false;
      break;
    }
    const { data: rows, error } = await db
      .from("creative_daily_metrics")
      .select("spend, impressions")
      .eq("account_id", accountId)
      .gte("date", start)
      .lte("date", end)
      .order("ad_id")
      .order("date")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      console.warn("  Post-sync audit read failed, marking incomplete:", error.message);
      totals.complete = false;
      break;
    }
    if (!rows || rows.length === 0) break;
    for (const r of rows) {
      totals.spend += r.spend || 0;
      totals.impressions += r.impressions || 0;
      totals.rows++;
    }
    offset += rows.length;
  }
  return totals;
}
