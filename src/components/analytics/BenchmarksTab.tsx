import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAccountContext } from "@/contexts/AccountContext";

import { useAllCreatives } from "@/hooks/useAllCreatives";
import { useWoWTrends } from "@/hooks/useWoWTrends";
import { useMtdSpend } from "@/hooks/useMtdSpend";

import { getPacingStatus } from "@/components/overview/SpendPacingWidget";
import { cn } from "@/lib/utils";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { TrendingUp, AlertTriangle, Trophy } from "lucide-react";

interface AccountBenchmark {
  id: string;
  name: string;
  avgRoas: number;
  avgCtr: number;
  winRate: number;
  avgCpa: number;
  activeCreatives: number;
  topTag: string;
  wowRoasChange: number;
}

function computeAccountBenchmarks(
  accounts: any[],
  allCreatives: any[],
  allWowTrends?: Map<string, any>,
): AccountBenchmark[] {
  const creativesByAccount = new Map<string, any[]>();
  for (const c of allCreatives) {
    const list = creativesByAccount.get(c.account_id) || [];
    list.push(c);
    creativesByAccount.set(c.account_id, list);
  }

  return accounts
    .filter((a: any) => a.is_active)
    .map((account: any) => {
      const creatives = creativesByAccount.get(account.id) || [];
      const active = creatives.filter((c: any) => (Number(c.spend) || 0) > 0);

      if (active.length === 0) {
        return {
          id: account.id,
          name: account.name,
          avgRoas: 0, avgCtr: 0, winRate: 0, avgCpa: 0,
          activeCreatives: 0, topTag: "—",
          wowRoasChange: 0,
        };
      }

      const avg = (field: string) => {
        const vals = active.map((c: any) => Number(c[field]) || 0);
        return vals.reduce((a, b) => a + b, 0) / vals.length;
      };

      const avgRoas = avg("roas");
      const avgCtr = avg("ctr");
      const avgCpa = avg("cpa");

      // Win rate: % of creatives with ROAS >= account scale threshold
      const scaleThreshold = parseFloat(account.scale_threshold || "2.0");
      const winners = active.filter((c: any) => (Number(c.roas) || 0) >= scaleThreshold);
      const winRate = (winners.length / active.length) * 100;




      // Top tag (most common ad_type among winners)
      const tagCounts = new Map<string, number>();
      for (const c of winners) {
        const tag = c.ad_type || c.style || c.hook;
        if (tag) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
      let topTag = "—";
      let maxCount = 0;
      for (const [tag, count] of tagCounts) {
        if (count > maxCount) { topTag = tag; maxCount = count; }
      }

      // WoW ROAS change (average across top spenders)
      let wowRoasChange = 0;
      if (allWowTrends) {
        const top10 = [...active].sort((a: any, b: any) => (Number(b.spend) || 0) - (Number(a.spend) || 0)).slice(0, 10);
        let totalPct = 0, count = 0;
        for (const c of top10) {
          const t = allWowTrends.get(c.ad_id);
          if (t && t.direction !== "insufficient") { totalPct += t.pctChange; count++; }
        }
        wowRoasChange = count > 0 ? totalPct / count : 0;
      }

      return {
        id: account.id,
        name: account.name,
        avgRoas, avgCtr, winRate, avgCpa,
        activeCreatives: active.length,
        topTag, wowRoasChange,
      };
    })
    .filter((b) => b.activeCreatives > 0);
}

function fmt$(v: number) {
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function BenchmarksTab() {
  const navigate = useNavigate();
  const { accounts, setSelectedAccountId } = useAccountContext();

  // Fetch ALL creatives across all accounts
  const { data: allCreatives = [], isLoading } = useAllCreatives({});
  const { data: wowTrends } = useWoWTrends(undefined);
  const { data: allMtdSpend = 0 } = useMtdSpend(undefined);

  const benchmarks = useMemo(
    () => computeAccountBenchmarks(accounts, allCreatives, wowTrends),
    [accounts, allCreatives, wowTrends]
  );

  // Compute per-account MTD spend from current month creatives
  const mtdSpendByAccount = useMemo(() => {
    const now = new Date();
    const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const map = new Map<string, number>();
    // We don't have daily metrics here, so approximate from creatives' spend
    // This is a rough approximation; for exact values we'd need daily metrics
    for (const c of allCreatives) {
      const spend = Number(c.spend) || 0;
      if (spend > 0) {
        map.set(c.account_id, (map.get(c.account_id) || 0) + spend);
      }
    }
    return map;
  }, [allCreatives]);

  // Portfolio averages
  const portfolio = useMemo(() => {
    if (benchmarks.length === 0) return null;
    const avg = (fn: (b: AccountBenchmark) => number) =>
      benchmarks.reduce((s, b) => s + fn(b), 0) / benchmarks.length;
    return {
      avgRoas: avg(b => b.avgRoas),
      avgCtr: avg(b => b.avgCtr),
      winRate: avg(b => b.winRate),
      avgCpa: avg(b => b.avgCpa),
      
    };
  }, [benchmarks]);

  // Best/worst per column
  const columnExtremes = useMemo(() => {
    if (benchmarks.length === 0) return null;
    const best = (fn: (b: AccountBenchmark) => number) => Math.max(...benchmarks.map(fn));
    const bestRoas = best(b => b.avgRoas);
    const bestCtr = best(b => b.avgCtr);
    const bestWin = best(b => b.winRate);
    
    // For CPA, lower is better
    const bestCpa = Math.min(...benchmarks.map(b => b.avgCpa).filter(v => v > 0));
    const bestActive = best(b => b.activeCreatives);
    return { bestRoas, bestCtr, bestWin, bestCpa, bestActive };
  }, [benchmarks]);

  // Insight cards
  const insights = useMemo(() => {
    if (benchmarks.length === 0) return null;
    const bestAccount = [...benchmarks].sort((a, b) => b.avgRoas - a.avgRoas)[0];
    const mostImproved = [...benchmarks].sort((a, b) => b.wowRoasChange - a.wowRoasChange)[0];
    const needsAttention = [...benchmarks].sort((a, b) => a.winRate - b.winRate)[0];
    return { bestAccount, mostImproved, needsAttention };
  }, [benchmarks]);

  function cellColor(value: number, bestValue: number, portfolioAvg: number | undefined, lowerIsBetter = false) {
    if (!portfolioAvg || !columnExtremes) return "";
    if (lowerIsBetter) {
      if (value === bestValue) return "text-success font-semibold";
      if (value > portfolioAvg * 1.5) return "text-destructive";
    } else {
      if (value === bestValue) return "text-success font-semibold";
      if (value < portfolioAvg * 0.5) return "text-destructive";
    }
    return "";
  }

  function handleRowClick(accountId: string) {
    setSelectedAccountId(accountId);
    navigate("/");
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (benchmarks.length === 0) {
    return (
      <div className="glass-panel flex flex-col items-center justify-center py-20 text-center">
        <h3 className="font-heading text-[20px] text-foreground mb-1">No account data</h3>
        <p className="font-body text-[14px] text-muted-foreground">Sync your accounts to see cross-account benchmarks.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Comparison table */}
      <div className="glass-panel overflow-x-auto -mx-4 sm:mx-0">
        <Table className="min-w-[800px]">
          <TableHeader>
            <TableRow className="bg-cream-dark">
              <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Account</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Avg ROAS</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Avg CTR</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Win Rate</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Avg CPA</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right hidden sm:table-cell">Active Creatives</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right hidden sm:table-cell">Pacing</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {benchmarks.map((b) => (
              <TableRow
                key={b.id}
                className="cursor-pointer hover:bg-accent/50 border-b border-border-light"
                onClick={() => handleRowClick(b.id)}
              >
                <TableCell className="font-body text-[13px] font-medium text-foreground">{b.name}</TableCell>
                <TableCell className={cn("text-right font-data text-[13px] tabular-nums", cellColor(b.avgRoas, columnExtremes!.bestRoas, portfolio?.avgRoas))}>
                  {b.avgRoas.toFixed(2)}x
                </TableCell>
                <TableCell className={cn("text-right font-data text-[13px] tabular-nums", cellColor(b.avgCtr, columnExtremes!.bestCtr, portfolio?.avgCtr))}>
                  {b.avgCtr.toFixed(2)}%
                </TableCell>
                <TableCell className={cn("text-right font-data text-[13px] tabular-nums", cellColor(b.winRate, columnExtremes!.bestWin, portfolio?.winRate))}>
                  {b.winRate.toFixed(0)}%
                </TableCell>
                <TableCell className={cn("text-right font-data text-[13px] tabular-nums", cellColor(b.avgCpa, columnExtremes!.bestCpa, portfolio?.avgCpa, true))}>
                  {fmt$(b.avgCpa)}
                </TableCell>
                <TableCell className={cn("text-right font-data text-[13px] tabular-nums hidden sm:table-cell", cellColor(b.activeCreatives, columnExtremes!.bestActive, undefined))}>
                  {b.activeCreatives}
                </TableCell>
                <TableCell className="text-right font-data text-[13px] tabular-nums hidden sm:table-cell">
                  {(() => {
                    const acct = accounts.find((a: any) => a.id === b.id);
                    const mtd = mtdSpendByAccount.get(b.id) || 0;
                    const pacing = acct ? getPacingStatus(acct, mtd) : null;
                    if (!pacing) return <span className="text-muted-foreground">—</span>;
                    const color = pacing.status === "green" ? "text-primary" : pacing.status === "amber" ? "text-warning" : "text-destructive";
                    return <span className={cn("font-semibold", color)}>{pacing.label}</span>;
                  })()}
                </TableCell>
              </TableRow>
            ))}
            {/* Portfolio average row */}
            {portfolio && (
              <TableRow className="bg-muted/50 border-t-2 border-border-light font-semibold">
                <TableCell className="font-label text-[12px] uppercase tracking-wider text-muted-foreground">Portfolio Avg</TableCell>
                <TableCell className="text-right font-data text-[13px] tabular-nums text-foreground">{portfolio.avgRoas.toFixed(2)}x</TableCell>
                <TableCell className="text-right font-data text-[13px] tabular-nums text-foreground">{portfolio.avgCtr.toFixed(2)}%</TableCell>
                <TableCell className="text-right font-data text-[13px] tabular-nums text-foreground">{portfolio.winRate.toFixed(0)}%</TableCell>
                <TableCell className="text-right font-data text-[13px] tabular-nums text-foreground">{fmt$(portfolio.avgCpa)}</TableCell>
                <TableCell className="text-right font-data text-[13px] tabular-nums text-muted-foreground hidden sm:table-cell">—</TableCell>
                <TableCell className="text-right font-data text-[13px] tabular-nums text-muted-foreground hidden sm:table-cell">—</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Portfolio Insights */}
      {insights && (
        <div>
          <h3 className="font-heading text-[16px] text-foreground mb-3">Portfolio Insights</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <InsightCard
              icon={<Trophy className="h-5 w-5 text-success" />}
              title="Best Performing Account"
              accountName={insights.bestAccount.name}
              detail={`${insights.bestAccount.avgRoas.toFixed(2)}x ROAS`}
              subDetail={insights.bestAccount.topTag !== "—" ? `Driven by "${insights.bestAccount.topTag}" creatives` : undefined}
            />
            <InsightCard
              icon={<TrendingUp className="h-5 w-5 text-primary" />}
              title="Most Improved This Week"
              accountName={insights.mostImproved.name}
              detail={`${insights.mostImproved.wowRoasChange > 0 ? "+" : ""}${insights.mostImproved.wowRoasChange.toFixed(0)}% ROAS WoW`}
            />
            <InsightCard
              icon={<AlertTriangle className="h-5 w-5 text-destructive" />}
              title="Needs Attention"
              accountName={insights.needsAttention.name}
              detail={`Win Rate: ${insights.needsAttention.winRate.toFixed(0)}%`}
              subDetail={insights.needsAttention.winRate < 20 ? "Below critical threshold" : "Lowest in portfolio"}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function InsightCard({ icon, title, accountName, detail, subDetail }: {
  icon: React.ReactNode;
  title: string;
  accountName: string;
  detail: string;
  subDetail?: string;
}) {
  return (
    <div className="rounded-card border border-border-light bg-card p-4 shadow-card space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-label text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{title}</span>
      </div>
      <p className="font-heading text-[16px] text-foreground">{accountName}</p>
      <p className="font-data text-[14px] font-semibold tabular-nums text-foreground">{detail}</p>
      {subDetail && (
        <p className="font-body text-[12px] text-muted-foreground">{subDetail}</p>
      )}
    </div>
  );
}
