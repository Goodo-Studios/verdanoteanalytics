import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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

export function useAgencyDashboardData(accounts: AccountLike[], dateFrom?: string, dateTo?: string) {
  const accountIds = accounts.map((account) => account.id).sort();

  return useQuery({
    queryKey: ["agency-dashboard-data", accountIds, dateFrom, dateTo],
    enabled: accountIds.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const now = new Date();
      const pFrom = dateFrom ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const pTo   = dateTo   ?? now.toISOString().slice(0, 10);

      // Prior month date range for MoM spend comparison
      const priorMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const priorEnd   = new Date(now.getFullYear(), now.getMonth(), 0);
      const priorFrom  = priorMonth.toISOString().slice(0, 10);
      const priorTo    = priorEnd.toISOString().slice(0, 10);

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

      const mtdSpend   = Array.from(perAccountSpend.values()).reduce((s, v) => s + v, 0);
      const mtdRevenue = Array.from(perAccountRevenue.values()).reduce((s, v) => s + v, 0);

      return {
        creatives,
        perAccountSpend,
        perAccountRevenue,
        priorMonthSpend,
        activeByAccount,
        portfolio: {
          mtdSpend,
          portfolioRoas:   mtdSpend > 0 ? mtdRevenue / mtdSpend : 0,
          activeCreatives: creatives.length,
        },
      };
    },
  });
}
