import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const PAGE_SIZE = 1000;

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

type CurrentMetricRow = {
  account_id: string;
  ad_id: string;
  spend: number | null;
  purchase_value: number | null;
  impressions: number | null;
  frequency: number | null;
};

type PriorMetricRow = {
  account_id: string;
  spend: number | null;
};

type CreativeMetaRow = {
  ad_id: string;
  account_id: string;
  ad_name: string | null;
  thumbnail_url: string | null;
};

async function fetchCurrentMetricRows(accountIds: string[], dateFrom: string, dateTo: string) {
  const rows: CurrentMetricRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("creative_daily_metrics")
      .select("account_id, ad_id, spend, purchase_value, impressions, frequency")
      .in("account_id", accountIds)
      .gte("date", dateFrom)
      .lte("date", dateTo)
      .order("account_id", { ascending: true })
      .order("ad_id", { ascending: true })
      .order("date", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

async function fetchPriorMetricRows(accountIds: string[], dateFrom: string, dateTo: string) {
  const rows: PriorMetricRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("creative_daily_metrics")
      .select("account_id, spend")
      .in("account_id", accountIds)
      .gte("date", dateFrom)
      .lte("date", dateTo)
      .order("account_id", { ascending: true })
      .order("date", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

async function fetchCreativeMetadata(accountIds: string[]) {
  const rows: CreativeMetaRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("creatives")
      .select("ad_id, account_id, ad_name, thumbnail_url")
      .in("account_id", accountIds)
      .order("ad_id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

export function useAgencyDashboardData(accounts: AccountLike[]) {
  const accountIds = accounts.map((account) => account.id).sort();

  return useQuery({
    queryKey: ["agency-dashboard-data", accountIds],
    enabled: accountIds.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const currentMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const priorMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const priorEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      const priorFrom = priorMonth.toISOString().slice(0, 10);
      const priorTo = priorEnd.toISOString().slice(0, 10);

      const [currentRows, priorRows, creativeMetaRows] = await Promise.all([
        fetchCurrentMetricRows(accountIds, currentMonthStart, today),
        fetchPriorMetricRows(accountIds, priorFrom, priorTo),
        fetchCreativeMetadata(accountIds),
      ]);

      const perAccountSpend = new Map<string, number>();
      const perAccountRevenue = new Map<string, number>();
      const priorMonthSpend = new Map<string, number>();
      const activeByAccountSets = new Map<string, Set<string>>();
      const adAggregates = new Map<string, {
        ad_id: string;
        account_id: string;
        spend: number;
        purchase_value: number;
        impressions: number;
        frequencyWeighted: number;
        frequencyImpressions: number;
      }>();
      const creativeMetaMap = new Map<string, CreativeMetaRow>();

      for (const row of creativeMetaRows) {
        creativeMetaMap.set(row.ad_id, row);
      }

      for (const row of currentRows) {
        const spend = Number(row.spend) || 0;
        const purchaseValue = Number(row.purchase_value) || 0;
        const impressions = Number(row.impressions) || 0;
        const frequency = Number(row.frequency) || 0;

        perAccountSpend.set(row.account_id, (perAccountSpend.get(row.account_id) || 0) + spend);
        perAccountRevenue.set(row.account_id, (perAccountRevenue.get(row.account_id) || 0) + purchaseValue);

        if (spend > 0) {
          if (!activeByAccountSets.has(row.account_id)) activeByAccountSets.set(row.account_id, new Set<string>());
          activeByAccountSets.get(row.account_id)!.add(row.ad_id);
        }

        const existing = adAggregates.get(row.ad_id) ?? {
          ad_id: row.ad_id,
          account_id: row.account_id,
          spend: 0,
          purchase_value: 0,
          impressions: 0,
          frequencyWeighted: 0,
          frequencyImpressions: 0,
        };

        existing.spend += spend;
        existing.purchase_value += purchaseValue;
        existing.impressions += impressions;
        if (frequency > 0 && impressions > 0) {
          existing.frequencyWeighted += frequency * impressions;
          existing.frequencyImpressions += impressions;
        }
        adAggregates.set(row.ad_id, existing);
      }

      for (const row of priorRows) {
        const spend = Number(row.spend) || 0;
        priorMonthSpend.set(row.account_id, (priorMonthSpend.get(row.account_id) || 0) + spend);
      }

      const activeByAccount = new Map<string, number>();
      for (const [accountId, adIds] of activeByAccountSets) {
        activeByAccount.set(accountId, adIds.size);
      }

      const creatives: CreativeRow[] = Array.from(adAggregates.values()).map((aggregate) => {
        const meta = creativeMetaMap.get(aggregate.ad_id);
        return {
          ad_id: aggregate.ad_id,
          account_id: aggregate.account_id,
          ad_name: meta?.ad_name ?? aggregate.ad_id,
          thumbnail_url: meta?.thumbnail_url ?? null,
          spend: aggregate.spend,
          purchase_value: aggregate.purchase_value,
          roas: aggregate.spend > 0 ? aggregate.purchase_value / aggregate.spend : 0,
          frequency: aggregate.frequencyImpressions > 0 ? aggregate.frequencyWeighted / aggregate.frequencyImpressions : 0,
        };
      });

      const mtdSpend = Array.from(perAccountSpend.values()).reduce((sum, value) => sum + value, 0);
      const mtdRevenue = Array.from(perAccountRevenue.values()).reduce((sum, value) => sum + value, 0);

      return {
        creatives,
        perAccountSpend,
        perAccountRevenue,
        priorMonthSpend,
        activeByAccount,
        portfolio: {
          mtdSpend,
          portfolioRoas: mtdSpend > 0 ? mtdRevenue / mtdSpend : 0,
          activeCreatives: creatives.length,
        },
      };
    },
  });
}
