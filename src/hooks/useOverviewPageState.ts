import { useState, useMemo } from "react";
import { useAccountContext } from "@/contexts/AccountContext";
import { useAllCreatives } from "@/hooks/useAllCreatives";
import { useKillScaleLogic, KillScaleConfig } from "@/lib/killScaleLogic";
import { calculateBenchmarks, diagnoseCreatives } from "@/lib/iterationDiagnostics";
import { format, formatDistanceToNow, subDays } from "date-fns";

export function useOverviewPageState() {
  const { selectedAccountId, selectedAccount, accounts } = useAccountContext();
  const [dateFrom, setDateFrom] = useState<string | undefined>(() => format(subDays(new Date(), 13), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState<string | undefined>(() => format(new Date(), "yyyy-MM-dd"));

  const dateFilters = useMemo(() => ({
    ...(selectedAccountId && selectedAccountId !== "all" ? { account_id: selectedAccountId } : {}),
    ...(dateFrom ? { date_from: dateFrom } : {}),
    ...(dateTo ? { date_to: dateTo } : {}),
  }), [selectedAccountId, dateFrom, dateTo]);

  // Previous period filters for delta comparison
  const prevPeriodFilters = useMemo(() => {
    if (!dateFrom || !dateTo) return null;
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    const days = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const prevTo = new Date(from);
    prevTo.setDate(prevTo.getDate() - 1);
    const prevFrom = new Date(prevTo);
    prevFrom.setDate(prevFrom.getDate() - days + 1);
    return {
      ...(selectedAccountId && selectedAccountId !== "all" ? { account_id: selectedAccountId } : {}),
      date_from: prevFrom.toISOString().split("T")[0],
      date_to: prevTo.toISOString().split("T")[0],
    };
  }, [selectedAccountId, dateFrom, dateTo]);

  const { data: creatives = [], isLoading } = useAllCreatives(dateFilters);
  const shouldFetchPrev = !!prevPeriodFilters;
  const { data: prevCreatives = [] } = useAllCreatives(prevPeriodFilters || {});
  const hasPrevPeriod = shouldFetchPrev && prevCreatives.length > 0;

  // Account settings
  const roasThreshold = parseFloat(selectedAccount?.winner_roas_threshold || "2.0");
  const spendThreshold = parseFloat(selectedAccount?.iteration_spend_threshold || "50");

  const killScaleConfig: KillScaleConfig = useMemo(() => ({
    winnerKpi: (selectedAccount as any)?.kill_scale_kpi || selectedAccount?.winner_kpi || "roas",
    winnerKpiDirection: (selectedAccount as any)?.kill_scale_kpi_direction || selectedAccount?.winner_kpi_direction || "gte",
    scaleAt: parseFloat(selectedAccount?.scale_threshold || "0") || roasThreshold,
    killAt: parseFloat(selectedAccount?.kill_threshold || "0") || roasThreshold * 0.5,
    spendThreshold,
  }), [selectedAccount, roasThreshold, spendThreshold]);

  // Kill/Scale/Watch counts
  const { scale, watch, kill } = useKillScaleLogic(creatives, killScaleConfig);

  // Metrics calculations
  const metrics = useMemo(() => {
    const active = creatives.filter((c: any) => (Number(c.spend) || 0) > 0);
    const totalSpend = active.reduce((s: number, c: any) => s + (Number(c.spend) || 0), 0);
    const totalPurchaseValue = active.reduce((s: number, c: any) => s + (Number(c.purchase_value) || 0), 0);
    const totalPurchases = active.reduce((s: number, c: any) => s + (Number(c.purchases) || 0), 0);
    const totalClicks = active.reduce((s: number, c: any) => s + (Number(c.clicks) || 0), 0);
    const totalImpressions = active.reduce((s: number, c: any) => s + (Number(c.impressions) || 0), 0);

    const avgRoas = totalSpend > 0 ? totalPurchaseValue / totalSpend : 0;
    const avgCpa = totalPurchases > 0 ? totalSpend / totalPurchases : 0;
    const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

    const winnerKpi = killScaleConfig.winnerKpi;
    const isGte = killScaleConfig.winnerKpiDirection !== "lte";
    const threshold = killScaleConfig.scaleAt;
    const winners = active.filter((c: any) => {
      const val = Number(c[winnerKpi]) || 0;
      return isGte ? val >= threshold : (val > 0 && val <= threshold);
    });
    const winRate = active.length > 0 ? (winners.length / active.length) * 100 : 0;

    return { totalSpend, activeCount: active.length, avgCpa, avgRoas, avgCtr, winRate };
  }, [creatives, killScaleConfig]);

  // Previous period metrics for deltas
  const prevMetrics = useMemo(() => {
    if (!hasPrevPeriod || prevCreatives.length === 0) return null;
    const active = prevCreatives.filter((c: any) => (Number(c.spend) || 0) > 0);
    const totalSpend = active.reduce((s: number, c: any) => s + (Number(c.spend) || 0), 0);
    const totalPurchaseValue = active.reduce((s: number, c: any) => s + (Number(c.purchase_value) || 0), 0);
    const totalPurchases = active.reduce((s: number, c: any) => s + (Number(c.purchases) || 0), 0);
    const totalClicks = active.reduce((s: number, c: any) => s + (Number(c.clicks) || 0), 0);
    const totalImpressions = active.reduce((s: number, c: any) => s + (Number(c.impressions) || 0), 0);
    const avgRoas = totalSpend > 0 ? totalPurchaseValue / totalSpend : 0;
    const avgCpa = totalPurchases > 0 ? totalSpend / totalPurchases : 0;
    const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    return { totalSpend, activeCount: active.length, avgCpa, avgRoas, avgCtr };
  }, [prevCreatives, hasPrevPeriod]);

  // Top performer & biggest concern
  const topPerformer = useMemo(() => {
    const qualified = creatives.filter((c: any) => (Number(c.spend) || 0) >= spendThreshold);
    if (qualified.length === 0) return null;
    return qualified.reduce((best: any, c: any) => {
      const spend = Number(c.spend) || 0;
      const bestSpend = Number(best.spend) || 0;
      return spend > bestSpend ? c : best;
    }, qualified[0]);
  }, [creatives, spendThreshold]);

  const biggestConcern = useMemo(() => {
    const losers = creatives.filter((c: any) => {
      const roas = Number(c.roas) || 0;
      const spend = Number(c.spend) || 0;
      return roas > 0 && roas < 1.0 && spend >= spendThreshold;
    });
    if (losers.length === 0) return null;
    return losers.reduce((worst: any, c: any) => {
      return (Number(c.spend) || 0) > (Number(worst.spend) || 0) ? c : worst;
    }, losers[0]);
  }, [creatives, spendThreshold]);

  // Recent iteration diagnostics
  const recentDiagnostics = useMemo(() => {
    const benchmarks = calculateBenchmarks(creatives);
    return diagnoseCreatives(creatives, benchmarks, spendThreshold).slice(0, 5);
  }, [creatives, spendThreshold]);

  // Tagging progress
  const taggingProgress = useMemo(() => {
    const tagged = creatives.filter((c: any) => c.tag_source && c.tag_source !== "untagged").length;
    const untagged = creatives.length - tagged;
    const pct = creatives.length > 0 ? (tagged / creatives.length) * 100 : 0;
    return { tagged, untagged, pct };
  }, [creatives]);

  // Subtitle info
  const lastSyncedAgo = selectedAccount?.last_synced_at
    ? formatDistanceToNow(new Date(selectedAccount.last_synced_at), { addSuffix: true })
    : null;

  const accountName = selectedAccountId === "all" || !selectedAccount
    ? "All Accounts"
    : selectedAccount.name;

  return {
    accountName, lastSyncedAgo,
    dateFrom, dateTo, setDateFrom, setDateTo,
    selectedAccountId, selectedAccount,
    creatives, isLoading,
    metrics, prevMetrics, hasPrevPeriod,
    topPerformer, biggestConcern,
    scale, watch, kill, killScaleConfig,
    recentDiagnostics, taggingProgress,
    spendThreshold,
  };
}
