// Weekly spend and ROAS for the email digest (audit plan item 7.3).
//
// Totals come from the account_week_totals RPC, which sums every daily row. The digest used to
// sum a plain select (capped at 1,000 rows by PostgREST) and average each row's ROAS; ROAS is
// now purchase value over spend, the same as everywhere else (audit 6.1).

// deno-lint-ignore no-explicit-any
type Db = any;

export type WeekTotals = { spend: number; roas: number };

/** Spend and ROAS for one account over [from, toExclusive). Dates are YYYY-MM-DD. */
export async function loadWeekTotals(db: Db, accountId: string, from: string, toExclusive: string): Promise<WeekTotals> {
  const { data, error } = await db.rpc("account_week_totals", {
    p_account_id: accountId,
    p_from: from,
    p_to_exclusive: toExclusive,
  });
  if (error) throw new Error(error.message ?? "account_week_totals failed");
  const row = Array.isArray(data) ? data[0] : data;
  const spend = Number(row?.spend) || 0;
  const value = Number(row?.purchase_value) || 0;
  return { spend, roas: spend > 0 ? value / spend : 0 };
}

/** The two full UTC weeks ending yesterday (audit 6.5), as [from, toExclusive) date strings. */
export function digestWeeks(now: Date): { thisWeek: [string, string]; lastWeek: [string, string] } {
  const day = (n: number) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  return { thisWeek: [day(7), day(0)], lastWeek: [day(14), day(7)] };
}
