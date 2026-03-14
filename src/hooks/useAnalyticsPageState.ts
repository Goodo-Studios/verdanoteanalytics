import { useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useAccountContext } from "@/contexts/AccountContext";
import { useAllCreatives } from "@/hooks/useAllCreatives";
import { useDailyTrends } from "@/hooks/useDailyTrends";
import { subDays, format } from "date-fns";

export function useAnalyticsPageState() {
  const { selectedAccountId, selectedAccount } = useAccountContext();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "trends");
  const [selectedCreative, setSelectedCreative] = useState<any>(null);
  const [dateFrom, setDateFrom] = useState<string | undefined>(() => format(subDays(new Date(), 14), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState<string | undefined>(() => format(subDays(new Date(), 1), "yyyy-MM-dd"));

  const dateFilters = useMemo(() => ({
    ...(selectedAccountId && selectedAccountId !== "all" ? { account_id: selectedAccountId } : {}),
    ...(dateFrom ? { date_from: dateFrom } : {}),
    ...(dateTo ? { date_to: dateTo } : {}),
  }), [selectedAccountId, dateFrom, dateTo]);

  const { data: creatives = [], isLoading } = useAllCreatives(dateFilters);
  const { data: trendData, isLoading: trendsLoading } = useDailyTrends(selectedAccountId || undefined);

  const roasThreshold = parseFloat(selectedAccount?.winner_roas_threshold || "2.0");
  const spendThreshold = parseFloat(selectedAccount?.iteration_spend_threshold || "50");

  const killScaleConfig = useMemo(() => ({
    winnerKpi: (selectedAccount as any)?.kill_scale_kpi || selectedAccount?.winner_kpi || "roas",
    winnerKpiDirection: (selectedAccount as any)?.kill_scale_kpi_direction || selectedAccount?.winner_kpi_direction || "gte",
    scaleAt: parseFloat(selectedAccount?.scale_threshold || "0") || (parseFloat(selectedAccount?.winner_kpi_threshold || "0") || roasThreshold),
    killAt: parseFloat(selectedAccount?.kill_threshold || "0") || (parseFloat(selectedAccount?.winner_kpi_threshold || "0") || roasThreshold) * 0.5,
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
    dateFrom, dateTo, setDateFrom, setDateTo,
    selectedAccountId, selectedAccount,
    creatives, isLoading,
    filteredTrendData, trendsLoading,
    roasThreshold, spendThreshold, killScaleConfig,
  };
}
