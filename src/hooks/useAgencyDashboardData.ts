import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

const PAGE_SIZE = 500;

type AccountLike = { id: string };
type CreativeRow = {
  ad_id: string;
  account_id: string;
  ad_name?: string | null;
  thumbnail_url?: string | null;
  roas?: number | null;
  spend?: number | null;
  purchase_value?: number | null;
};

type AccountSummary = {
  creatives: CreativeRow[];
  spend: number;
  revenue: number;
  activeCount: number;
};

async function fetchAccountCreatives(accountId: string, dateFrom: string, dateTo: string) {
  const creatives: CreativeRow[] = [];
  let offset = 0;
  let total = 0;

  while (true) {
    const qs = new URLSearchParams({
      account_id: accountId,
      date_from: dateFrom,
      date_to: dateTo,
      delivery: "had_delivery",
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });

    const result = await apiFetch("creatives", `?${qs.toString()}`);
    const page = Array.isArray(result) ? result : (result?.data || []);
    total = Array.isArray(result) ? page.length : (result?.total || 0);
    creatives.push(...page);

    if (page.length < PAGE_SIZE || creatives.length >= total) break;
    offset += PAGE_SIZE;
  }

  const spend = creatives.reduce((sum, creative) => sum + (Number(creative.spend) || 0), 0);
  const revenue = creatives.reduce((sum, creative) => sum + (Number(creative.purchase_value) || 0), 0);

  return {
    creatives,
    spend,
    revenue,
    activeCount: creatives.length,
  } satisfies AccountSummary;
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

      const perAccountSpend = new Map<string, number>();
      const perAccountRevenue = new Map<string, number>();
      const priorMonthSpend = new Map<string, number>();
      const activeByAccount = new Map<string, number>();
      const creatives: CreativeRow[] = [];

      const summaries = await Promise.all(
        accounts.map(async (account) => {
          const [current, prior] = await Promise.all([
            fetchAccountCreatives(account.id, currentMonthStart, today),
            fetchAccountCreatives(account.id, priorFrom, priorTo),
          ]);
          return { accountId: account.id, current, prior };
        })
      );

      for (const summary of summaries) {
        perAccountSpend.set(summary.accountId, summary.current.spend);
        perAccountRevenue.set(summary.accountId, summary.current.revenue);
        priorMonthSpend.set(summary.accountId, summary.prior.spend);
        activeByAccount.set(summary.accountId, summary.current.activeCount);
        creatives.push(...summary.current.creatives);
      }

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
