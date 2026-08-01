import { useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useAccountContext } from "@/contexts/AccountContext";
import { useDateRangeContext } from "@/contexts/DateRangeContext";
import { useAllCreatives } from "@/hooks/useAllCreatives";
import { useDailyTrends } from "@/hooks/useDailyTrends";

export function useAnalyticsPageState() {
  const { selectedAccountId, selectedAccount } = useAccountContext();
  // App-wide, per-account, persisted date range (shared with every other page).
  const { dateFrom, dateTo, setDateRange } = useDateRangeContext();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "leaderboard");
  const [selectedCreative, setSelectedCreative] = useState<any>(null);

  const dateFilters = useMemo(() => ({
    ...(selectedAccountId && selectedAccountId !== "all" ? { account_id: selectedAccountId } : {}),
    ...(dateFrom ? { date_from: dateFrom } : {}),
    ...(dateTo ? { date_to: dateTo } : {}),
  }), [selectedAccountId, dateFrom, dateTo]);

  const { data: creatives = [], isLoading } = useAllCreatives(dateFilters);
  const { data: trendData, isLoading: trendsLoading } = useDailyTrends(selectedAccountId || undefined);

  // Thresholds are numeric columns; `||` (not `??`) so 0/unset falls back to the default.
  const roasThreshold = selectedAccount?.winner_roas_threshold || 2.0;
  const spendThreshold = selectedAccount?.iteration_spend_threshold || 50;

  const killScaleConfig = useMemo(() => ({
    winnerKpi: (selectedAccount as any)?.kill_scale_kpi || selectedAccount?.winner_kpi || "roas",
    winnerKpiDirection: (selectedAccount as any)?.kill_scale_kpi_direction || selectedAccount?.winner_kpi_direction || "gte",
    scaleAt: selectedAccount?.scale_threshold || selectedAccount?.winner_kpi_threshold || roasThreshold,
    killAt: selectedAccount?.kill_threshold || (selectedAccount?.winner_kpi_threshold || roasThreshold) * 0.5,
    spendThreshold,
  }), [selectedAccount, roasThreshold, spendThreshold]);

  const filteredTrendData = useMemo(() => {
    if (!trendData) return undefined;
    return trendData.filter((d: any) => {
      if (dateFrom && d.date < dateFrom) return false;
      if (dateTo && d.date > dateTo) return false;
      return true;
    });
  }, [trendData, dateFrom, dateTo]);

  return {
    activeTab, setActiveTab,
    selectedCreative, setSelectedCreative,
    dateFrom, dateTo, setDateRange,
    selectedAccountId, selectedAccount,
    creatives, isLoading,
    filteredTrendData, trendsLoading,
    roasThreshold, spendThreshold, killScaleConfig,
  };
}
