import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { priorPeriodRange } from "@/lib/dateRange";
import { monthToDateRange } from "@/lib/monthPacing";

type AccountLike = { id: string };

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

      const { data, error } = await supabase.rpc("get_agency_dashboard_summary", {
        p_from:       pFrom,
        p_to:         pTo,
        p_prior_from: priorFrom,
        p_prior_to:   priorTo,
      });

      if (error) throw error;

      // The RPC returns one row per (account, ad) combination.
      // Re-build the Maps and creative array the dashboard components expect.
      const perAccountSpend   = new Map<string, number>();
      const perAccountRevenue = new Map<string, number>();
      const priorMonthSpend   = new Map<string, number>();
      const activeByAccount   = new Map<string, number>();

      // Collect per-ad aggregates; account-level fields repeat per row so we
      // only need to set them once per account_id.
      const seenAccounts = new Set<string>();
      const adMap = new Map<string, {
        ad_id: string;
        account_id: string;
        ad_name: string | null;
        thumbnail_url: string | null;
        spend: number;
        purchase_value: number;
        impressions: number;
        frequencyWeighted: number;
        frequencyImpressions: number;
      }>();

      for (const row of data ?? []) {
        if (!seenAccounts.has(row.account_id)) {
          seenAccounts.add(row.account_id);
          perAccountSpend.set(row.account_id,   Number(row.period_spend)   || 0);
          perAccountRevenue.set(row.account_id, Number(row.period_revenue) || 0);
          priorMonthSpend.set(row.account_id,   Number(row.prior_spend)    || 0);
          activeByAccount.set(row.account_id,   Number(row.active_ad_count) || 0);
        }

        if (row.ad_id) {
          adMap.set(row.ad_id, {
            ad_id:                row.ad_id,
            account_id:           row.account_id,
            ad_name:              row.ad_name ?? null,
            thumbnail_url:        row.thumbnail_url ?? null,
            spend:                Number(row.ad_spend)              || 0,
            purchase_value:       Number(row.ad_purchase_value)     || 0,
            impressions:          Number(row.ad_impressions)        || 0,
            frequencyWeighted:    Number(row.ad_frequency_weighted)     || 0,
            frequencyImpressions: Number(row.ad_frequency_impressions)  || 0,
          });
        }
      }

      const creatives: CreativeRow[] = Array.from(adMap.values()).map((agg) => ({
        ad_id:         agg.ad_id,
        account_id:    agg.account_id,
        ad_name:       agg.ad_name ?? agg.ad_id,
        thumbnail_url: agg.thumbnail_url,
        spend:         agg.spend,
        purchase_value: agg.purchase_value,
        roas:          agg.spend > 0 ? agg.purchase_value / agg.spend : 0,
        frequency:     agg.frequencyImpressions > 0
                         ? agg.frequencyWeighted / agg.frequencyImpressions
                         : 0,
      }));

      // Real month to date for the MTD tile and pacing (audit 6.5): the picked range is often
      // not the calendar month, so read the month separately unless they are the same.
      const mtd = monthToDateRange();
      let mtdSpendByAccount = perAccountSpend;
      if (mtd.from !== pFrom || mtd.to !== pTo) {
        const mtdPrior = priorPeriodRange(mtd.from, mtd.to);
        const { data: mtdRows, error: mtdError } = await supabase.rpc("get_agency_dashboard_summary", {
          p_from:       mtd.from,
          p_to:         mtd.to,
          p_prior_from: mtdPrior.dateFrom,
          p_prior_to:   mtdPrior.dateTo,
        });
        if (mtdError) throw mtdError;
        mtdSpendByAccount = new Map<string, number>();
        for (const row of mtdRows ?? []) {
          if (!mtdSpendByAccount.has(row.account_id)) {
            mtdSpendByAccount.set(row.account_id, Number(row.period_spend) || 0);
          }
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
