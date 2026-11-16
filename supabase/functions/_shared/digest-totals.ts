// Weekly spend and ROAS for the email digest (audit plan item 7.3).

// deno-lint-ignore no-explicit-any
type Db = any;

export type WeekTotals = { spend: number; roas: number };

/** Spend and ROAS for one account over [from, to). Dates are YYYY-MM-DD. */
export async function loadWeekTotals(db: Db, accountId: string, from: string, toExclusive: string): Promise<WeekTotals> {
  const { data: rows } = await db
    .from("creative_daily_metrics")
    .select("spend, roas")
    .eq("account_id", accountId)
    .gte("date", from)
    .lt("date", toExclusive);
  const list = (rows || []) as Array<{ spend: unknown; roas: unknown }>;
  const spend = list.reduce((s, r) => s + (Number(r.spend) || 0), 0);
  const roas = list.length > 0 ? list.reduce((s, r) => s + (Number(r.roas) || 0), 0) / list.length : 0;
  return { spend, roas };
}
