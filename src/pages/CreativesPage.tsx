import { PageHeader } from "@/components/PageHeader";
import { MetricCard } from "@/components/MetricCard";
import { CreativeDetailModal } from "@/components/CreativeDetailModal";

import { CreativesTable } from "@/components/creatives/CreativesTable";
import { CreativesCardGrid } from "@/components/creatives/CreativesCardGrid";
import { CreativesTimeline } from "@/components/creatives/CreativesTimeline";
import { CreativesGroupTable } from "@/components/creatives/CreativesGroupTable";

import { CreativesFilters } from "@/components/creatives/CreativesFilters";
import { CreativesPagination } from "@/components/creatives/CreativesPagination";
import { AdvancedFiltersPanel, applyAdvancedFilters, countActiveConditions } from "@/components/creatives/AdvancedFiltersPanel";

import { BulkActionBar } from "@/components/creatives/BulkActionBar";
import { BulkTagModal } from "@/components/creatives/BulkTagModal";
import { AddToReportModal } from "@/components/creatives/AddToReportModal";
import { TABLE_COLUMNS, compareCreativesBy } from "@/components/creatives/constants";
import { ColumnPicker } from "@/components/ColumnPicker";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, LayoutGrid, Loader2, Download, Search, X, CalendarDays, SlidersHorizontal } from "lucide-react";
import { useMemo, useState, useCallback } from "react";
import { useRoleNavigate } from "@/hooks/useRolePath";
import { MetricCardSkeletonRow } from "@/components/skeletons/MetricCardSkeleton";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import { useCreatives, CREATIVES_PAGE_SIZE, useCreativeFilters } from "@/hooks/useCreatives";
import { useSync } from "@/hooks/useSyncApi";
import { useIsSyncing } from "@/hooks/useIsSyncing";
import { downloadCSV, exportCreativesCSV } from "@/lib/csv";
import { useCreativesPageState } from "@/hooks/useCreativesPageState";
import { useAuth } from "@/contexts/AuthContext";
import { useClientPreview } from "@/hooks/useClientPreviewMode";
import { useAccountContext } from "@/contexts/AccountContext";
import { SyncStatusBanner } from "@/components/SyncStatusBanner";
import { MediaRefreshBanner } from "@/components/MediaRefreshBanner";
import { useWoWTrends } from "@/hooks/useWoWTrends";
import { gradeCreatives, gradeOrder } from "@/lib/creativeGrading";
import { computeFatigueMap } from "@/lib/fatigueScore";
import { isForecastedToFatigue } from "@/lib/fatigueForecast";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useCardPresence } from "@/hooks/useCardPresence";
import { toast } from "sonner";
import { saveCreativesToVault, formatBulkSaveSummary } from "@/lib/vaultSave";

import type { GradeInfo } from "@/lib/creativeGrading";

const CreativesPage = () => {
  const { isClient, isBuilder, isEmployee } = useAuth();
  const { isClientPreview } = useClientPreview();
  // Real clients AND builders previewing as a client must not see internal
  // sync/media-refresh controls or their progress banners.
  const effectiveClient = isClient || isClientPreview;
  const { setSelectedAccountId, selectedAccount } = useAccountContext();
  const optimizationGoal = selectedAccount?.optimization_goal ?? 'PURCHASE';
  const navigate = useRoleNavigate();
  const state = useCreativesPageState();
  const {
    viewMode, setViewMode, visibleCols, toggleCol, columnOrder, handleReorder,
    filters, updateFilter, dateFrom, dateTo, setDateFrom, setDateTo,
    selectedCreativeId, setSelectedCreativeId, groupBy, setGroupBy,
    sort, handleSort, page, setPage, searchInput, setSearchInput, search,
    selectedAccountId, allFilters,
    advancedConditions, setAdvancedConditions,
  } = state;

  const [advFiltersOpen, setAdvFiltersOpen] = useState(false);

  // Momentum filter
  const [momentumFilter, setMomentumFilter] = useState("__all__");

  // Fatigue filter
  const [fatigueFilter, setFatigueFilter] = useState("__all__");

  // Platform filter
  const [platformFilter, setPlatformFilter] = useState("__all__");

  // Bulk selection
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const [addToReportOpen, setAddToReportOpen] = useState(false);
  const [bulkSavingToVault, setBulkSavingToVault] = useState(false);
  const canBulkAction = isBuilder || isEmployee;

  const { data: creativesResult, isLoading } = useCreatives(allFilters, page);
  const creatives = creativesResult?.data || [];
  // True when the picked date range has zero synced daily-metrics rows (vs. the
  // account simply having no creatives). Lets the empty state explain "no data
  // for this range" instead of the misleading "add an account" message.
  const noDailyData = Boolean((creativesResult as any)?.no_daily_data);
  const totalCreatives = creativesResult?.total || 0;
  const totalPages = Math.ceil(totalCreatives / CREATIVES_PAGE_SIZE);
  const { data: filterOptions } = useCreativeFilters();
  const { data: wowTrends } = useWoWTrends(selectedAccountId);
  const syncMut = useSync();
  const isSyncing = useIsSyncing();

  // Compute grades from current page data (pure spend percentile)
  const gradeMap = useMemo(() => gradeCreatives(creatives), [creatives]);

  // Compute fatigue scores
  const fatigueMap = useMemo(() => computeFatigueMap(creatives, wowTrends), [creatives, wowTrends]);

  const { hoveredCards, setHoveredCard } = useCardPresence(selectedAccountId);

  // Fetch daily metrics for fatigue forecast filter (only when filter active)
  const { data: dailyMetricsMap } = useQuery({
    queryKey: ["daily-metrics-forecast", selectedAccountId, fatigueFilter],
    queryFn: async () => {
      const today = new Date();
      const from = new Date(today);
      from.setDate(from.getDate() - 14);
      const fromStr = from.toISOString().split("T")[0];

      const query = supabase
        .from("creative_daily_metrics")
        .select("ad_id, date, spend, frequency, ctr, roas")
        .gte("date", fromStr);

      if (selectedAccountId && selectedAccountId !== "all") {
        query.eq("account_id", selectedAccountId);
      }

      const { data, error } = await query;
      if (error) throw error;
      if (!data) return new Map<string, any[]>();

      const map = new Map<string, any[]>();
      for (const row of data) {
        if (!map.has(row.ad_id)) map.set(row.ad_id, []);
        map.get(row.ad_id)!.push(row);
      }
      return map;
    },
    enabled: fatigueFilter === "forecast",
    staleTime: 5 * 60 * 1000,
  });

  const avgMetrics = useMemo(() => {
    // Prefer server-side aggregates (covers ALL creatives, not just current page)
    const agg = (creativesResult as any)?.aggregates;
    if (agg) {
      return {
        totalSpend: `$${Number(agg.total_spend).toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
        cpa: agg.avg_cpa > 0 ? `$${Number(agg.avg_cpa).toFixed(2)}` : "—",
        roas: agg.avg_roas > 0 ? `${Number(agg.avg_roas).toFixed(2)}x` : "—",
      };
    }
    // Fallback: compute from current page
    if (creatives.length === 0) return { roas: "—", cpa: "—", totalSpend: "—" };
    const withSpend = creatives.filter((c: any) => c.spend > 0);
    if (withSpend.length === 0) return { roas: "—", cpa: "—", totalSpend: "—" };
    const avg = (field: string) => {
      const vals = withSpend.map((c: any) => Number(c[field]) || 0);
      return (vals.reduce((a: number, b: number) => a + b, 0) / vals.length).toFixed(2);
    };
    const total = withSpend.reduce((s: number, c: any) => s + (Number(c.spend) || 0), 0);
    return { roas: `${avg("roas")}x`, cpa: `$${avg("cpa")}`, totalSpend: `$${total.toLocaleString("en-US", { maximumFractionDigits: 0 })}` };
  }, [creatives, creativesResult]);

  const sortedCreatives = useMemo(() => {
    let list = [...creatives].map((c: any) => ({ ...c, _cpmr: (Number(c.cpm) || 0) * (Number(c.frequency) || 0) }));

    // Apply platform filter
    if (platformFilter !== "__all__") {
      list = list.filter((c: any) => (c.platform || "meta") === platformFilter);
    }

    // Apply momentum filter
    if (momentumFilter !== "__all__" && wowTrends) {
      list = list.filter((c: any) => {
        const trend = wowTrends.get(c.ad_id);
        if (!trend || trend.direction === "insufficient") return false;
        if (momentumFilter === "gaining") return trend.direction === "up";
        if (momentumFilter === "steady") return trend.direction === "flat";
        if (momentumFilter === "losing") return trend.direction === "down" && trend.pctChange >= -30;
        if (momentumFilter === "fading") return trend.direction === "down" && trend.pctChange < -30;
        return true;
      });
    }

    // Apply fatigue filter
    if (fatigueFilter !== "__all__") {
      if (fatigueFilter === "forecast") {
        // Show creatives forecasted to hit warning within 7 days
        if (dailyMetricsMap) {
          list = list.filter((c: any) => {
            const rows = dailyMetricsMap.get(c.ad_id);
            return rows ? isForecastedToFatigue(rows, 7) : false;
          });
        }
      } else {
        list = list.filter((c: any) => {
          const f = fatigueMap.get(c.ad_id);
          if (fatigueFilter === "high") return f?.level === "high";
          if (fatigueFilter === "warning") return f?.level === "warning";
          if (fatigueFilter === "ok") return !f || f.level === "ok";
          return true;
        });
      }
    }

    // Apply advanced filters
    list = applyAdvancedFilters(list, advancedConditions, gradeMap, fatigueMap, wowTrends);

    if (!sort.key || !sort.direction) return list;
    const dir = sort.direction === "asc" ? 1 : -1;

    // Special handling for grade sort
    if (sort.key === "grade") {
      return list.sort((a: any, b: any) => {
        const ga = gradeMap.get(a.ad_id);
        const gb = gradeMap.get(b.ad_id);
        return (gradeOrder(ga?.grade ?? "F") - gradeOrder(gb?.grade ?? "F")) * dir;
      });
    }

    // Shared comparator (numeric/string, nulls-last) — resolves field via SORT_FIELD_MAP.
    return list.sort((a: any, b: any) => compareCreativesBy(a, b, sort.key!, sort.direction!));
  }, [creatives, sort, momentumFilter, wowTrends, gradeMap, fatigueFilter, fatigueMap, advancedConditions, platformFilter, dailyMetricsMap]);

  const toggleBulkId = useCallback((adId: string) => {
    setBulkSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(adId)) next.delete(adId); else next.add(adId);
      return next;
    });
  }, []);

  const toggleBulkAll = useCallback(() => {
    setBulkSelectedIds(prev => {
      const allIds = sortedCreatives.map((c: any) => c.ad_id);
      const allSelected = allIds.every(id => prev.has(id));
      return allSelected ? new Set<string>() : new Set(allIds);
    });
  }, [sortedCreatives]);

  const exportBulkCSV = useCallback(() => {
    const selected = sortedCreatives.filter((c: any) => bulkSelectedIds.has(c.ad_id));
    const headers = [
      "Ad Name", "Account", "ROAS", "Spend", "CPA", "Purchases", "CTR",
      "Hook Rate", "Campaign", "Ad Set", "Status", "Grade", "Tags",
    ];
    const rows = selected.map((c: any) => {
      const gi = gradeMap.get(c.ad_id);
      return [
        c.ad_name || "", c.account_id || "",
        String(c.roas || 0), String(c.spend || 0), String(c.cpa || 0),
        String(c.purchases || 0), String(c.ctr || 0),
        String(c.thumb_stop_rate || 0),
        c.campaign_name || "", c.adset_name || "",
        c.ad_status || "", gi?.grade || "—",
        [c.ad_type, c.person, c.style, c.hook].filter(Boolean).join(", ") || "—",
      ];
    });
    downloadCSV("creatives-bulk-export.csv", headers, rows);
  }, [sortedCreatives, bulkSelectedIds, gradeMap]);

  // Bulk save selected creatives into the global Creative Vault (US-004).
  // Each save runs independently (Promise.allSettled inside the helper) so a
  // single failure or dedupe skip never aborts the batch; a single summary toast
  // reports the counts and selection clears once complete.
  const saveSelectedToVault = useCallback(async () => {
    const selected = sortedCreatives.filter((c: any) => bulkSelectedIds.has(c.ad_id));
    if (selected.length === 0) return;
    setBulkSavingToVault(true);
    try {
      const summary = await saveCreativesToVault(selected);
      if (summary.saved === 0 && summary.alreadySaved === 0 && summary.failed > 0) {
        toast.error(formatBulkSaveSummary(summary));
      } else {
        toast.success(formatBulkSaveSummary(summary));
      }
      setBulkSelectedIds(new Set());
    } finally {
      setBulkSavingToVault(false);
    }
  }, [sortedCreatives, bulkSelectedIds]);


  const groupedData = useMemo(() => {
    if (groupBy === "__none__" || !sortedCreatives?.length) return null;
    const groups: Record<string, any[]> = {};
    sortedCreatives.forEach((c: any) => { const key = c[groupBy] || "(none)"; if (!groups[key]) groups[key] = []; groups[key].push(c); });
    return Object.entries(groups).map(([name, items]) => {
      const withSpend = items.filter(c => (Number(c.spend) || 0) > 0);
      const totalSpend = items.reduce((s, c) => s + (Number(c.spend) || 0), 0);
      const avgField = (field: string) => withSpend.length > 0 ? withSpend.reduce((s, c) => s + (Number(c[field]) || 0), 0) / withSpend.length : 0;
      return { name, count: items.length, totalSpend, avgRoas: avgField("roas"), avgCpa: avgField("cpa"), avgSpend: withSpend.length > 0 ? totalSpend / withSpend.length : 0 };
    }).sort((a, b) => b.totalSpend - a.totalSpend);
  }, [sortedCreatives, groupBy]);

  return (
    <>

      <SyncStatusBanner />
      <MediaRefreshBanner />
      <PageHeader
        title="Creatives"
        description="View and manage your ad creatives with performance data and tags."
        actions={
          <div className="flex items-center gap-2">
            
            <ColumnPicker columns={TABLE_COLUMNS} visibleColumns={visibleCols} onToggle={toggleCol} columnOrder={columnOrder} onReorder={handleReorder} />
            {!effectiveClient && (
              <Button size="sm" onClick={() => syncMut.mutate({ account_id: "all" })} disabled={syncMut.isPending || isSyncing}>
                {(syncMut.isPending || isSyncing) ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}Sync
              </Button>
            )}
            {creatives.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => exportCreativesCSV(creatives)}><Download className="h-3.5 w-3.5 mr-1.5" />Export</Button>
            )}
          </div>
        }
      />


      {isLoading ? (
        <MetricCardSkeletonRow />
      ) : (
        <div className="flex items-stretch divide-x divide-border-light mb-4">
          <MetricCard label="Ad Spend" value={avgMetrics.totalSpend} />
          <MetricCard label="Total Creatives" value={totalCreatives} />
          <MetricCard label="Avg CPA" value={avgMetrics.cpa} />
          <MetricCard label="Avg ROAS" value={avgMetrics.roas} />
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <div className="relative max-w-sm flex-1 group">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input id="creatives-search" placeholder="Search by ad name, code, or campaign…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="h-8 font-body text-[13px] pl-8 pr-14 placeholder:text-sage" />
          {searchInput ? (
            <button onClick={() => setSearchInput("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center px-1.5 py-0.5 rounded border border-border-light bg-muted text-[10px] font-mono text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">/</kbd>
          )}
        </div>
      </div>

      <CreativesFilters
        dateFrom={dateFrom} dateTo={dateTo} onDateChange={(from, to) => { setDateFrom(from); setDateTo(to); }}
        filters={filters} updateFilter={updateFilter} filterOptions={filterOptions}
        groupBy={groupBy} setGroupBy={setGroupBy} viewMode={viewMode}
      />

      {isLoading ? (
        <TableSkeleton rows={10} cols={8} />
      ) : creatives.length === 0 && noDailyData ? (
        <div className="glass-panel flex flex-col items-center justify-center py-20 text-center">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4"><CalendarDays className="h-6 w-6 text-sage" /></div>
          <h3 className="font-heading text-[20px] text-forest mb-1">No data for this date range</h3>
          <p className="font-body text-[14px] text-slate max-w-md">No spend was synced for the selected dates. Try widening the range or picking earlier dates — today's metrics usually aren't available until the next sync.</p>
        </div>
      ) : creatives.length === 0 ? (
        <div className="glass-panel flex flex-col items-center justify-center py-20 text-center">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4"><LayoutGrid className="h-6 w-6 text-sage" /></div>
          <h3 className="font-heading text-[20px] text-forest mb-1">No creatives yet</h3>
          <p className="font-body text-[14px] text-slate max-w-md">Add a Meta ad account in the Accounts tab and sync to pull in your creatives.</p>
        </div>
      ) : groupBy !== "__none__" && groupedData ? (
        <CreativesGroupTable groupBy={groupBy} data={groupedData} />
      ) : viewMode === "timeline" && selectedAccountId && selectedAccountId !== "all" ? (
        <CreativesTimeline
          creatives={sortedCreatives}
          gradeMap={gradeMap}
          onSelect={(c: any) => setSelectedCreativeId(c.ad_id)}
        />
      ) : viewMode === "table" ? (
        <CreativesTable
          creatives={sortedCreatives} visibleCols={visibleCols} columnOrder={columnOrder}
          sort={sort} onSort={handleSort} onReorder={handleReorder}
          onSelect={(c: any) => setSelectedCreativeId(c.ad_id)}
          wowTrends={wowTrends}
          gradeMap={gradeMap}
          bulkSelectedIds={canBulkAction ? bulkSelectedIds : undefined}
          onBulkToggle={canBulkAction ? toggleBulkId : undefined}
          onBulkToggleAll={canBulkAction ? toggleBulkAll : undefined}
          optimizationGoal={optimizationGoal}
        />
      ) : (
        <CreativesCardGrid
          creatives={sortedCreatives}
          onSelect={(c: any) => setSelectedCreativeId(c.ad_id)}
          wowTrends={wowTrends}
          gradeMap={gradeMap}
          fatigueMap={fatigueMap}
          bulkSelectedIds={canBulkAction ? bulkSelectedIds : undefined}
          onBulkToggle={canBulkAction ? toggleBulkId : undefined}
          hoveredCards={hoveredCards}
          onCardHover={setHoveredCard}
          optimizationGoal={optimizationGoal}
        />
      )}

      <CreativesPagination page={page} totalPages={totalPages} totalItems={totalCreatives} pageSize={CREATIVES_PAGE_SIZE} onPageChange={setPage} />
      <CreativeDetailModal creative={creatives.find((c: any) => c.ad_id === selectedCreativeId) || null} open={!!selectedCreativeId} onClose={() => setSelectedCreativeId(null)} gradeMap={gradeMap} />
      {canBulkAction && (
        <>
          <BulkActionBar
            count={bulkSelectedIds.size}
            onTag={() => setBulkTagOpen(true)}
            onExport={exportBulkCSV}
            onAddToReport={() => setAddToReportOpen(true)}
            onSaveToVault={saveSelectedToVault}
            savingToVault={bulkSavingToVault}
            onClear={() => setBulkSelectedIds(new Set())}
          />
          <BulkTagModal
            open={bulkTagOpen}
            onClose={() => { setBulkTagOpen(false); setBulkSelectedIds(new Set()); }}
            adIds={[...bulkSelectedIds]}
          />
          <AddToReportModal
            open={addToReportOpen}
            onClose={() => { setAddToReportOpen(false); setBulkSelectedIds(new Set()); }}
            adIds={[...bulkSelectedIds]}
            creatives={sortedCreatives}
          />
        </>
      )}
      <AdvancedFiltersPanel
        open={advFiltersOpen}
        onClose={() => setAdvFiltersOpen(false)}
        conditions={advancedConditions}
        onChange={setAdvancedConditions}
        accountId={selectedAccountId}
      />
    </>
  );
};

export default CreativesPage;
