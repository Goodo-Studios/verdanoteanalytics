import { useMemo, useState, useEffect } from "react";
import { useRoleNavigate } from "@/hooks/useRolePath";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import {
  Building2, Zap, FileEdit, RefreshCw, TrendingUp, TrendingDown,
  AlertTriangle, Trophy, ExternalLink,
} from "lucide-react";
import { useAccountContext } from "@/contexts/AccountContext";
import { useAllCreatives } from "@/hooks/useAllCreatives";
import { useWoWTrends } from "@/hooks/useWoWTrends";
import { useMtdSpend } from "@/hooks/useMtdSpend";
import { useSync } from "@/hooks/useSyncApi";
import { computeFatigue } from "@/lib/fatigueScore";

import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

function fmt$(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function fmtPct(n: number) {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(0)}%`;
}

export default function AgencyDashboardPage() {
  const navigate = useRoleNavigate();
  const { accounts, setSelectedAccountId } = useAccountContext();
  const { data: allCreatives = [] } = useAllCreatives({});
  const { data: wowTrends } = useWoWTrends();
  const { data: portfolioMtdSpend = 0 } = useMtdSpend();
  const sync = useSync();

  // Bulk fetch onboarding checklists for all accounts
  const { data: allChecklists = {} } = useQuery({
    queryKey: ["agency-onboarding-checklists"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("account_context")
        .select("account_id, onboarding_checklist");
      if (error) throw error;
      const map: Record<string, any[]> = {};
      for (const row of data || []) {
        map[row.account_id] = (row.onboarding_checklist as any) || [];
      }
      return map;
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: perAccountSpend = new Map<string, number>() } = useQuery({
    queryKey: ["agency-per-account-spend"],
    queryFn: async () => {
      const now = new Date();
      const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const { data, error } = await supabase
        .from("creative_daily_metrics")
        .select("account_id, spend")
        .gte("date", firstOfMonth);
      if (error) throw error;
      const map = new Map<string, number>();
      for (const row of data || []) {
        map.set(row.account_id, (map.get(row.account_id) || 0) + (Number(row.spend) || 0));
      }
      return map;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Prior month spend for delta
  const { data: priorMonthSpend = new Map<string, number>() } = useQuery({
    queryKey: ["agency-prior-month-spend"],
    queryFn: async () => {
      const now = new Date();
      const priorMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const priorEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      const from = priorMonth.toISOString().slice(0, 10);
      const to = priorEnd.toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("creative_daily_metrics")
        .select("account_id, spend")
        .gte("date", from)
        .lte("date", to);
      if (error) throw error;
      const map = new Map<string, number>();
      for (const row of data || []) {
        map.set(row.account_id, (map.get(row.account_id) || 0) + (Number(row.spend) || 0));
      }
      return map;
    },
    staleTime: 10 * 60 * 1000,
  });

  const creativesArr = Array.isArray(allCreatives) ? allCreatives : [];


  // Portfolio metrics
  const portfolioMetrics = useMemo(() => {
    const activeCreatives = creativesArr.filter((c: any) => (Number(c.spend) || 0) > 0);
    const totalSpend = activeCreatives.reduce((s, c: any) => s + (Number(c.spend) || 0), 0);
    const totalRevenue = activeCreatives.reduce((s, c: any) => s + (Number(c.purchase_value) || 0), 0);
    const portfolioRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    const aboveScale = activeCreatives.filter((c: any) => (Number(c.roas) || 0) >= 2.0).length;
    const winRate = activeCreatives.length > 0 ? aboveScale / activeCreatives.length : 0;

    return {
      mtdSpend: portfolioMtdSpend,
      portfolioRoas,
      activeCreatives: activeCreatives.length,
      winRate,
    };
  }, [creativesArr, portfolioMtdSpend]);

  // Sort accounts: needs attention first, then by MTD spend descending
  const sortedAccounts = useMemo(() => {
    return [...accounts].sort((a, b) => {
      return (perAccountSpend.get(b.id) || 0) - (perAccountSpend.get(a.id) || 0);
    });
  }, [accounts, perAccountSpend]);

  // Top 5 creatives across all accounts by ROAS
  const topWinners = useMemo(() => {
    return [...creativesArr]
      .filter((c: any) => (Number(c.spend) || 0) >= 50 && (Number(c.roas) || 0) > 0)
      .sort((a: any, b: any) => (Number(b.roas) || 0) - (Number(a.roas) || 0))
      .slice(0, 5);
  }, [creativesArr]);

  const alerts = useMemo(() => {
    const items: { id: string; label: string; detail: string; type: string }[] = [];

    // High fatigue
    for (const c of creativesArr.filter((c: any) => (Number(c.spend) || 0) > 100).slice(0, 50)) {
      const f = computeFatigue(c);
      if (f.level === "high") {
        items.push({ id: `fatigue-${c.ad_id}`, label: c.ad_name?.slice(0, 40), detail: `Fatigue: ${f.score}/100`, type: "fatigue" });
      }
    }

    return items.slice(0, 5);
  }, [creativesArr]);

  const getAccountName = (accountId: string) => accounts.find((a: any) => a.id === accountId)?.name || accountId;

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Building2 className="h-6 w-6 text-primary" />
          <h1 className="font-heading text-[28px] text-foreground">Agency Dashboard</h1>
        </div>

        {/* ROW 1 — Agency Health Bar */}
        <div className="grid grid-cols-4 gap-px bg-border-light rounded-card overflow-hidden shadow-card">
          <HealthMetric label="Portfolio Spend (MTD)" value={fmt$(portfolioMetrics.mtdSpend)} />
          <HealthMetric label="Portfolio ROAS" value={portfolioMetrics.portfolioRoas.toFixed(2) + "x"} />
          <HealthMetric label="Active Creatives" value={String(portfolioMetrics.activeCreatives)} />
          <HealthMetric label="Win Rate" value={(portfolioMetrics.winRate * 100).toFixed(0) + "%"} />
        </div>

        {/* ROW 2 — Account Cards */}
        <div>
          <h2 className="font-label text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-3">Accounts</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedAccounts.map((acc: any) => {
              const mtd = perAccountSpend.get(acc.id) || 0;
              const prior = priorMonthSpend.get(acc.id) || 0;
              const spendDelta = prior > 0 ? (mtd - prior) / prior : 0;
              const accCreatives = creativesArr.filter((c: any) => c.account_id === acc.id);
              const active = accCreatives.filter((c: any) => (Number(c.spend) || 0) > 0);
              const avgRoas = active.length > 0
                ? active.reduce((s, c: any) => s + (Number(c.roas) || 0), 0) / active.length
                : 0;
              const topCreative = [...active].sort((a: any, b: any) => (Number(b.roas) || 0) - (Number(a.roas) || 0))[0];
              const wowTrend = topCreative ? wowTrends?.get(topCreative.ad_id) : undefined;
              const target = Number(acc.target_monthly_spend) || 0;
              const pacing = target > 0 ? mtd / target : null;
              const setupProgress = computeSetupProgress(allChecklists[acc.id], acc);

              return (
                <Card key={acc.id} className="p-4 space-y-3 hover:shadow-card-hover transition-shadow">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <h3 className="font-body text-[14px] font-semibold text-foreground truncate">{acc.name}</h3>
                      {setupProgress.pct < 100 && (
                        <span className="font-data text-[10px] tabular-nums text-warning bg-warning/10 px-1.5 py-0.5 rounded-sm shrink-0">
                          Setup {setupProgress.pct}%
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Metrics row */}
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <p className="font-label text-[9px] uppercase tracking-wider text-muted-foreground">Spend MTD</p>
                      <p className="font-data text-[14px] font-medium tabular-nums text-foreground">{fmt$(mtd)}</p>
                      {prior > 0 && (
                        <span className={cn("font-data text-[10px] tabular-nums", spendDelta >= 0 ? "text-primary" : "text-destructive")}>
                          {spendDelta >= 0 ? <TrendingUp className="h-3 w-3 inline mr-0.5" /> : <TrendingDown className="h-3 w-3 inline mr-0.5" />}
                          {fmtPct(spendDelta)}
                        </span>
                      )}
                    </div>
                    <div>
                      <p className="font-label text-[9px] uppercase tracking-wider text-muted-foreground">ROAS</p>
                      <p className="font-data text-[14px] font-medium tabular-nums text-foreground">{avgRoas.toFixed(2)}x</p>
                      {wowTrend && wowTrend.direction !== "insufficient" && (
                        <span className={cn("font-data text-[10px]", wowTrend.direction === "up" ? "text-primary" : wowTrend.direction === "down" ? "text-destructive" : "text-muted-foreground")}>
                          {wowTrend.label}
                        </span>
                      )}
                    </div>
                    <div>
                      <p className="font-label text-[9px] uppercase tracking-wider text-muted-foreground">Active</p>
                      <p className="font-data text-[14px] font-medium tabular-nums text-foreground">{active.length}</p>
                    </div>
                  </div>

                  {/* Top creative thumbnail */}
                  {topCreative?.thumbnail_url && (
                    <div className="flex items-center gap-2">
                      <img src={topCreative.thumbnail_url} alt="" className="h-10 w-10 rounded object-cover border border-input" />
                      <div className="min-w-0">
                        <p className="font-body text-[11px] text-muted-foreground truncate">{topCreative.ad_name}</p>
                        <p className="font-data text-[10px] text-primary tabular-nums">{Number(topCreative.roas || 0).toFixed(2)}x ROAS</p>
                      </div>
                    </div>
                  )}

                  {/* Pacing bar */}
                  {pacing !== null && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-label text-[9px] uppercase tracking-wider text-muted-foreground">Pacing</span>
                        <span className="font-data text-[10px] tabular-nums text-muted-foreground">{(pacing * 100).toFixed(0)}%</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all", pacing >= 0.9 ? "bg-primary" : pacing >= 0.6 ? "bg-warning" : "bg-destructive")}
                          style={{ width: `${Math.min(pacing * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Quick actions */}
                  <div className="flex items-center gap-1.5 pt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 font-body text-[11px] text-muted-foreground"
                      onClick={() => { setSelectedAccountId(acc.id); navigate("/creatives"); }}
                    >
                      <Zap className="h-3 w-3 mr-1" />Creatives
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 font-body text-[11px] text-muted-foreground"
                      onClick={() => sync.mutate({ account_id: acc.id })}
                      disabled={sync.isPending}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />Sync
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 font-body text-[11px] text-muted-foreground"
                      onClick={() => { setSelectedAccountId(acc.id); navigate("/briefs"); }}
                    >
                      <FileEdit className="h-3 w-3 mr-1" />Brief
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>

        {/* ROW 3 — Winners + Alerts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Winners */}
          <Card className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-primary" />
              <h3 className="font-label text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">This Week's Winners</h3>
            </div>
            {topWinners.length === 0 ? (
              <p className="font-body text-[13px] text-muted-foreground py-4 text-center">No data yet</p>
            ) : (
              <div className="space-y-2">
                {topWinners.map((c: any, i) => (
                  <div key={c.ad_id} className="flex items-center gap-3 py-1.5">
                    <span className="font-data text-[11px] text-muted-foreground w-4 text-right">{i + 1}.</span>
                    {c.thumbnail_url ? (
                      <img src={c.thumbnail_url} alt="" className="h-9 w-9 rounded object-cover border border-input flex-shrink-0" />
                    ) : (
                      <div className="h-9 w-9 rounded bg-muted flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-body text-[12px] text-foreground truncate">{c.ad_name}</p>
                      <p className="font-body text-[10px] text-muted-foreground">{getAccountName(c.account_id)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-data text-[13px] font-medium text-primary tabular-nums">{Number(c.roas).toFixed(2)}x</p>
                      <p className="font-data text-[10px] text-muted-foreground tabular-nums">{fmt$(Number(c.spend))}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Alerts */}
          <Card className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <h3 className="font-label text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Alerts</h3>
            </div>
            {alerts.length === 0 ? (
              <p className="font-body text-[13px] text-muted-foreground py-4 text-center">No alerts</p>
            ) : (
              <div className="space-y-2">
                {alerts.map(alert => (
                  <div key={alert.id} className="flex items-start gap-3 py-1.5">
                    <span className={cn(
                      "h-2 w-2 rounded-full mt-1.5 flex-shrink-0",
                      alert.type === "anomaly" ? "bg-destructive" : "bg-warning"
                    )} />
                    <div className="min-w-0">
                      <p className="font-body text-[12px] text-foreground truncate">{alert.label}</p>
                      <p className="font-body text-[10px] text-muted-foreground">{alert.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* ROW 4 — Pipeline Snapshot (static placeholder) */}
        <Card className="p-5">
          <h3 className="font-label text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-4">Pipeline Snapshot</h3>
          <div className="grid grid-cols-3 gap-4">
            <PipelineColumn label="Proposals" count={0} value={0} />
            <PipelineColumn label="Active" count={accounts.length} value={portfolioMetrics.mtdSpend} />
            <PipelineColumn label="At Risk" count={0} value={0} />
          </div>
          <p className="font-body text-[10px] text-muted-foreground mt-3">Connect Attio for live pipeline data.</p>
        </Card>
      </div>
    </AppLayout>
  );
}

/* ── Sub-components ── */

function HealthMetric({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className={cn("bg-card px-5 py-4 text-center", alert && "bg-destructive/5")}>
      <p className="font-label text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className={cn("font-data text-[22px] font-semibold tabular-nums mt-1", alert ? "text-destructive" : "text-foreground")}>
        {value}
      </p>
    </div>
  );
}

function PipelineColumn({ label, count, value }: { label: string; count: number; value: number }) {
  return (
    <div className="text-center space-y-1 py-3 rounded-lg bg-muted/30">
      <p className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-data text-[20px] font-semibold tabular-nums text-foreground">{count}</p>
      {value > 0 && <p className="font-data text-[11px] text-muted-foreground tabular-nums">{fmt$(value)}</p>}
    </div>
  );
}
