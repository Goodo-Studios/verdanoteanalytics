import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { TABLE_COLUMNS, COLUMN_ORDER_KEY, COLUMN_VISIBLE_KEY, loadColumnPrefs } from "@/components/creatives/constants";
import { type SortConfig } from "@/components/SortableTableHead";
import { useAccountContext } from "@/contexts/AccountContext";
import { useDateRangeContext } from "@/contexts/DateRangeContext";
import { type AdvancedConditions, deserializeConditions, serializeConditions } from "@/components/creatives/AdvancedFiltersPanel";

export function useCreativesPageState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectedAccountId } = useAccountContext();
  // App-wide, per-account, persisted date range (shared with every other page).
  // The date range no longer lives in the URL — it is the shared cross-page
  // selection, so it is not re-derived from ?from/?to here.
  const { dateFrom, dateTo, setDateRange } = useDateRangeContext();

  const [viewMode, setViewMode] = useState<"table" | "card" | "timeline">("table");

  // Saved prefs are migrated once (e.g. v2 shows the naming-convention tag
  // columns) without discarding the rest of the user's choices.
  const [initialPrefs] = useState(loadColumnPrefs);

  const [visibleCols, setVisibleCols] = useState<Set<string>>(() => {
    if (initialPrefs.visible) return new Set(initialPrefs.visible);
    return new Set(TABLE_COLUMNS.filter(c => c.defaultVisible !== false).map(c => c.key));
  });

  const toggleCol = useCallback((key: string) => {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem(COLUMN_VISIBLE_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    if (initialPrefs.order) return initialPrefs.order;
    return TABLE_COLUMNS.map(c => c.key);
  });

  const handleReorder = useCallback((newOrder: string[]) => {
    setColumnOrder(newOrder);
    localStorage.setItem(COLUMN_ORDER_KEY, JSON.stringify(newOrder));
  }, []);

  const [filters, setFilters] = useState<Record<string, string>>(() => {
    const raw = searchParams.get("filters");
    if (raw) { try { return JSON.parse(raw); } catch { /* fall through */ } }
    return {};
  });

  const [selectedCreativeId, setSelectedCreativeId] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState(() => searchParams.get("group") || "__none__");
  const [sort, setSort] = useState<SortConfig>({ key: "", direction: null });
  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState(() => searchParams.get("q") || "");
  const [search, setSearch] = useState(() => searchParams.get("q") || "");
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  // Advanced filters
  const [advancedConditions, setAdvancedConditions] = useState<AdvancedConditions>(() =>
    deserializeConditions(searchParams.get("adv") || "")
  );

  // Debounced search
  useEffect(() => {
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => { setSearch(searchInput); setPage(0); }, 400);
    return () => clearTimeout(searchTimeout.current);
  }, [searchInput]);

  // Sync URL params
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (groupBy !== "__none__") params.set("group", groupBy);
    if (Object.keys(filters).length > 0) params.set("filters", JSON.stringify(filters));
    const advSerialized = serializeConditions(advancedConditions);
    if (advSerialized) params.set("adv", advSerialized);
    setSearchParams(params, { replace: true });
  }, [search, groupBy, filters, advancedConditions, setSearchParams]);

  const updateFilter = useCallback((key: string, val: string) => {
    setPage(0);
    setFilters(prev => { const next = { ...prev }; if (val === "__all__") delete next[key]; else next[key] = val; return next; });
  }, []);

  useEffect(() => {
    setPage(0);
  }, [selectedAccountId]);

  const handleSort = useCallback((key: string) => {
    setSort(prev => ({
      key,
      direction: prev.key === key ? (prev.direction === "asc" ? "desc" : prev.direction === "desc" ? null : "asc") : "asc",
    }));
  }, []);

  // Build API filters
  const allFilters = useMemo(() => ({
    ...(selectedAccountId && selectedAccountId !== "all" ? { account_id: selectedAccountId } : {}),
    ...filters,
    ...(dateFrom ? { date_from: dateFrom } : {}),
    ...(dateTo ? { date_to: dateTo } : {}),
    ...(search ? { search } : {}),
  }), [selectedAccountId, filters, dateFrom, dateTo, search]);

  return {
    viewMode, setViewMode,
    visibleCols, toggleCol,
    columnOrder, handleReorder,
    filters, updateFilter,
    dateFrom, dateTo, setDateRange,
    selectedCreativeId, setSelectedCreativeId,
    groupBy, setGroupBy,
    sort, handleSort,
    page, setPage,
    searchInput, setSearchInput, search,
    selectedAccountId,
    allFilters,
    advancedConditions, setAdvancedConditions,
  };
}
