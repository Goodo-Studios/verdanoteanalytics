import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { format, subDays } from "date-fns";
import { useSearchParams } from "react-router-dom";
import { TABLE_COLUMNS, SORT_FIELD_MAP } from "@/components/creatives/constants";
import { type SortConfig } from "@/components/SortableTableHead";
import { useAccountContext } from "@/contexts/AccountContext";
import { type AdvancedConditions, deserializeConditions, serializeConditions } from "@/components/creatives/AdvancedFiltersPanel";

export function useCreativesPageState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectedAccountId } = useAccountContext();

  const [viewMode, setViewMode] = useState<"table" | "card" | "timeline">("table");

  const [visibleCols, setVisibleCols] = useState<Set<string>>(() => {
    const saved = localStorage.getItem("creatives_visible_columns");
    if (saved) { try { return new Set(JSON.parse(saved) as string[]); } catch { /* fall through */ } }
    return new Set(TABLE_COLUMNS.filter(c => c.defaultVisible !== false).map(c => c.key));
  });

  const toggleCol = useCallback((key: string) => {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem("creatives_visible_columns", JSON.stringify([...next]));
      return next;
    });
  }, []);

  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem("creatives_column_order");
    if (saved) { try { return JSON.parse(saved) as string[]; } catch { /* fall through */ } }
    return TABLE_COLUMNS.map(c => c.key);
  });

  const handleReorder = useCallback((newOrder: string[]) => {
    setColumnOrder(newOrder);
    localStorage.setItem("creatives_column_order", JSON.stringify(newOrder));
  }, []);

  const [filters, setFilters] = useState<Record<string, string>>(() => {
    const raw = searchParams.get("filters");
    if (raw) { try { return JSON.parse(raw); } catch { /* fall through */ } }
    return {};
  });

  const [dateFrom, setDateFrom] = useState<string | undefined>(() => searchParams.get("from") || format(subDays(new Date(), 13), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState<string | undefined>(() => searchParams.get("to") || format(new Date(), "yyyy-MM-dd"));
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
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    if (groupBy !== "__none__") params.set("group", groupBy);
    if (Object.keys(filters).length > 0) params.set("filters", JSON.stringify(filters));
    const advSerialized = serializeConditions(advancedConditions);
    if (advSerialized) params.set("adv", advSerialized);
    setSearchParams(params, { replace: true });
  }, [search, dateFrom, dateTo, groupBy, filters, advancedConditions, setSearchParams]);

  const updateFilter = useCallback((key: string, val: string) => {
    setPage(0);
    setFilters(prev => { const next = { ...prev }; if (val === "__all__") delete next[key]; else next[key] = val; return next; });
  }, []);

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
    dateFrom, dateTo, setDateFrom, setDateTo,
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
