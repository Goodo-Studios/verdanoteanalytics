// Database reads used by the sync function: one account's creatives, name mappings and
// daily metrics.
// deno-lint-ignore-file no-explicit-any

type Db = { from: (table: string) => any };

/** Creatives above the spend threshold, for the winner/concern Slack alert. */
export async function loadAlertCandidates(db: Db, accountId: string, spendThreshold: number): Promise<any[]> {
  const { data } = await db
    .from("creatives")
    .select("ad_id, ad_name, roas, prior_roas, spend")
    .eq("account_id", accountId)
    .gt("spend", spendThreshold);
  return data ?? [];
}

/** Ad ids whose tags were set by hand or by CSV, so Phase 1 keeps their tags. */
export async function loadProtectedTagAdIds(db: Db, accountId: string): Promise<Set<string>> {
  const { data } = await db.from("creatives").select("ad_id")
    .eq("account_id", accountId).in("tag_source", ["manual", "csv"]);
  return new Set((data || []).map((a: any) => a.ad_id as string));
}

/** The account's name mappings keyed by unique code. */
export async function loadMappingsByCode(db: Db, accountId: string): Promise<Map<string, Record<string, unknown>>> {
  const { data } = await db
    .from("name_mappings")
    .select("*")
    .eq("account_id", accountId);
  const byCode = new Map<string, Record<string, unknown>>();
  for (const m of (data || [])) {
    if (m.unique_code) byCode.set(m.unique_code, m);
  }
  return byCode;
}

export type AutoParseCandidate = { ad_id: string; ad_name: string; tag_source: string; parsed_ad_name: string | null };

/** Untagged and parsed creatives, the candidates for the auto-parse pass. */
export async function loadAutoParseCandidates(db: Db, accountId: string): Promise<AutoParseCandidate[]> {
  const candidates: AutoParseCandidate[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page, error: pageErr } = await db
      .from("creatives")
      .select("ad_id, ad_name, tag_source, parsed_ad_name")
      .eq("account_id", accountId)
      .in("tag_source", ["untagged", "parsed"])
      .order("ad_id")
      .range(from, from + 999);
    if (pageErr) throw pageErr;
    candidates.push(...(page || []));
    if (!page || page.length < 1000) break;
  }
  return candidates;
}

/** Creatives with spend and impressions, for the Creative Score snapshot. */
export async function loadScoreCreatives(db: Db, accountId: string): Promise<any[]> {
  const { data } = await db
    .from("creatives")
    .select("ad_id, roas, ctr, thumb_stop_rate, cpa, spend, ad_status")
    .eq("account_id", accountId)
    .gt("spend", 0)
    .gt("impressions", 0);
  return data ?? [];
}

/** Creatives with impressions, for the changelog and notifications. */
export async function loadChangelogCreatives(db: Db, accountId: string): Promise<any[]> {
  const { data } = await db
    .from("creatives")
    .select("ad_id, ad_name, roas, prior_roas, spend, ad_status")
    .eq("account_id", accountId)
    .gt("impressions", 0);
  return data ?? [];
}

/** Zero-spend creatives that had a prior ROAS (paused ads). */
export async function loadPausedCreatives(db: Db, accountId: string): Promise<any[]> {
  const { data } = await db
    .from("creatives")
    .select("ad_id, ad_name, prior_roas")
    .eq("account_id", accountId)
    .eq("spend", 0)
    .not("prior_roas", "is", null)
    .gt("prior_roas", 0);
  return data ?? [];
}

export type LocalAuditTotals = { spend: number; impressions: number; rows: number; complete: boolean };

/** Sum the account's daily spend and impressions over [start, end] for the post-sync audit. */
export async function sumLocalDailyMetrics(
  db: Db,
  accountId: string,
  start: string,
  end: string,
  isTimedOut: () => boolean,
): Promise<LocalAuditTotals> {
  const totals: LocalAuditTotals = { spend: 0, impressions: 0, rows: 0, complete: true };
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    if (isTimedOut()) {
      // Partial sums must not masquerade as a completed audit: they read
      // as massive under-reporting and would fire false drift alerts.
      console.warn("  Post-sync audit interrupted by budget, marking incomplete");
      totals.complete = false;
      break;
    }
    const { data: rows } = await db
      .from("creative_daily_metrics")
      .select("spend, impressions")
      .eq("account_id", accountId)
      .gte("date", start)
      .lte("date", end)
      .range(offset, offset + PAGE - 1);
    if (!rows || rows.length === 0) break;
    for (const r of rows) {
      totals.spend += r.spend || 0;
      totals.impressions += r.impressions || 0;
      totals.rows++;
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return totals;
}
