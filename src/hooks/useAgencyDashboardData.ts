import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { priorPeriodRange } from "@/lib/dateRange";
import { monthToDateRange } from "@/lib/monthPacing";

type AccountLike = { id: string };

type AgencyAccountEntry = {
  account_id: string;
  period_spend: number | string | null;
  period_revenue: number | string | null;
  active_ad_count: number | string | null;
  prior_spend: number | string | null;
};

type AgencyAdEntry = {
  ad_id: string;
  account_id: string;
  ad_name: string | null;
  thumbnail_url: string | null;
  spend: number | string | null;
  purchase_value: number | string | null;
  impressions: number | string | null;
  frequency_weighted: number | string | null;
  frequency_impressions: number | string | null;
};

type CreativeRow = {
  ad_id: string;
  account_id: string;
  ad_name?: string | null;
  thumbnail_url?: string | null;
  roas?: number | null;
  spend?: number | null;
  purchase_value?: number | null;
  frequency?: number | null;
};

/**
 * Current and prior ranges for the agency summary RPC. All dates are local calendar dates
 * formatted with date-fns (toISOString on local midnight shifts a day in UTC+ zones). The
 * prior range is derived from the selected range (same length, immediately before it); with
 * no selection it is the current month to date versus the previous full month.
 */
export function resolveAgencyRanges(
  dateFrom?: string,
  dateTo?: string,
  now: Date = new Date(),
): { pFrom: string; pTo: string; priorFrom: string; priorTo: string } {
  if (dateFrom && dateTo) {
    const prior = priorPeriodRange(dateFrom, dateTo);
    return { pFrom: dateFrom, pTo: dateTo, priorFrom: prior.dateFrom, priorTo: prior.dateTo };
  }
  const pFrom = dateFrom ?? format(startOfMonth(now), "yyyy-MM-dd");
  const pTo = dateTo ?? format(now, "yyyy-MM-dd");
  const prior = priorPeriodRange(pFrom, pTo);
  return { pFrom, pTo, priorFrom: prior.dateFrom, priorTo: prior.dateTo };
}

export function useAgencyDashboardData(accounts: AccountLike[], dateFrom?: string, dateTo?: string) {
  const accountIds = accounts.map((account) => account.id).sort();

  return useQuery({
    queryKey: ["agency-dashboard-data", accountIds, dateFrom, dateTo],
    enabled: accountIds.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    // Intentionally no keepPreviousData — on account switch, stale cross-account data must not render.
    queryFn: async () => {
      const { pFrom, pTo, priorFrom, priorTo } = resolveAgencyRanges(dateFrom, dateTo);

      // Audit 7.3: one jsonb value with every account and every spending ad. The old
      // get_agency_dashboard_summary returned one row per (account, ad), about 6,000 a month,
      // and PostgREST's 1,000-row cap dropped whole accounts.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)("get_agency_dashboard_data", {
        p_from:       pFrom,
        p_to:         pTo,
        p_prior_from: priorFrom,
        p_prior_to:   priorTo,
      });

      if (error) throw error;

      const payload = (data ?? {}) as { accounts?: AgencyAccountEntry[]; ads?: AgencyAdEntry[] };
      const perAccountSpend   = new Map<string, number>();
      const perAccountRevenue = new Map<string, number>();
      const priorMonthSpend   = new Map<string, number>();
      const activeByAccount   = new Map<string, number>();
      for (const a of payload.accounts ?? []) {
        perAccountSpend.set(a.account_id,   Number(a.period_spend)    || 0);
        perAccountRevenue.set(a.account_id, Number(a.period_revenue)  || 0);
        priorMonthSpend.set(a.account_id,   Number(a.prior_spend)     || 0);
        activeByAccount.set(a.account_id,   Number(a.active_ad_count) || 0);
      }

      const creatives: CreativeRow[] = (payload.ads ?? []).map((ad) => {
        const spend = Number(ad.spend) || 0;
        const purchaseValue = Number(ad.purchase_value) || 0;
        const freqImpressions = Number(ad.frequency_impressions) || 0;
        return {
          ad_id:          ad.ad_id,
          account_id:     ad.account_id,
          ad_name:        ad.ad_name ?? ad.ad_id,
          thumbnail_url:  ad.thumbnail_url ?? null,
          spend,
          purchase_value: purchaseValue,
          roas:           spend > 0 ? purchaseValue / spend : 0,
          frequency:      freqImpressions > 0 ? (Number(ad.frequency_weighted) || 0) / freqImpressions : 0,
        };
      });

      // Real month to date for the MTD tile and pacing (audit 6.5): the picked range is often
      // not the calendar month, so read the month separately unless they are the same.
      const mtd = monthToDateRange();
      let mtdSpendByAccount = perAccountSpend;
      if (mtd.from !== pFrom || mtd.to !== pTo) {
        const mtdPrior = priorPeriodRange(mtd.from, mtd.to);
        // Same uncapped RPC as above (audit 7.3), so no account drops out of month to date.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: mtdData, error: mtdError } = await (supabase.rpc as any)("get_agency_dashboard_data", {
          p_from:       mtd.from,
          p_to:         mtd.to,
          p_prior_from: mtdPrior.dateFrom,
          p_prior_to:   mtdPrior.dateTo,
        });
        if (mtdError) throw mtdError;
        mtdSpendByAccount = new Map<string, number>();
        for (const a of ((mtdData ?? {}) as { accounts?: AgencyAccountEntry[] }).accounts ?? []) {
          mtdSpendByAccount.set(a.account_id, Number(a.period_spend) || 0);
        }
      }
      const monthToDateSpend = Array.from(mtdSpendByAccount.values()).reduce((s, v) => s + v, 0);

      // Spend and revenue for the picked range.
      const mtdSpend   = Array.from(perAccountSpend.values()).reduce((s, v) => s + v, 0);
      const mtdRevenue = Array.from(perAccountRevenue.values()).reduce((s, v) => s + v, 0);

      return {
        creatives,
        perAccountSpend,
        perAccountRevenue,
        priorMonthSpend,
        activeByAccount,
        mtdSpendByAccount,
        portfolio: {
          mtdSpend,
          monthToDateSpend,
          portfolioRoas:   mtdSpend > 0 ? mtdRevenue / mtdSpend : 0,
          activeCreatives: creatives.length,
        },
      };
    },
  });
}
