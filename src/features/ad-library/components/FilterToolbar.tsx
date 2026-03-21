import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  LayoutGrid,
  List,
  X,
  Search,
  SlidersHorizontal,
  Check,
  CalendarDays,
  Captions,
  Video,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface AdLibraryFilters {
  search: string;
  platform: string | null;
  format: string | null;
  tag_ids: string[];
  sort: string;
  view: "grid" | "list";
  dateFrom: string | null;
  dateTo: string | null;
  hasTranscript: boolean;
  videoMissingFile: boolean;
  timeFilter: string;
}

export const DEFAULT_FILTERS: AdLibraryFilters = {
  search: "",
  platform: null,
  format: null,
  tag_ids: [],
  sort: "recent",
  view: "grid",
  dateFrom: null,
  dateTo: null,
  hasTranscript: false,
  videoMissingFile: false,
  timeFilter: "all",
};

interface FilterToolbarProps {
  filters: AdLibraryFilters;
  onFilterChange: (filters: AdLibraryFilters) => void;
  availableTags?: { id: string; name: string; color: string }[];
  totalCount?: number;
}

const PLATFORMS = ["facebook", "instagram", "tiktok", "youtube", "other"];
const FORMATS = ["image", "video", "carousel"];
const SORT_OPTIONS = [
  { value: "recent", label: "Recently Saved" },
  { value: "oldest", label: "Oldest First" },
  { value: "name-asc", label: "Advertiser A–Z" },
  { value: "name-desc", label: "Advertiser Z–A" },
  { value: "start-date-new", label: "Start Date (Newest)" },
  { value: "start-date-old", label: "Start Date (Oldest)" },
];
const TIME_FILTER_OPTIONS = [
  { value: "all", label: "All Time" },
  { value: "session", label: "This Session" },
  { value: "hour", label: "Last Hour" },
  { value: "today", label: "Today" },
  { value: "week", label: "Last 7 Days" },
  { value: "month", label: "Last 30 Days" },
];

export function getTimeCutoff(timeFilter: string): string | null {
  if (timeFilter === "all") return null;
  const now = new Date();
  let cutoff: Date;
  switch (timeFilter) {
    case "session":
      cutoff = new Date(now.getTime() - 15 * 60 * 1000);
      break;
    case "hour":
      cutoff = new Date(now.getTime() - 60 * 60 * 1000);
      break;
    case "today":
      cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case "week":
      cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "month":
      cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    default:
      return null;
  }
  return cutoff.toISOString();
}

export function FilterToolbar({
  filters,
  onFilterChange,
  availableTags = [],
  totalCount,
}: FilterToolbarProps) {
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [recentCount, setRecentCount] = useState(0);
  const { user } = useAuth();

  // Check for recent saves (last 15 minutes)
  useEffect(() => {
    if (!user) return;
    async function checkRecent() {
      const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("ad_library_saved_ads" as any)
        .select("*", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .gte("created_at", cutoff);
      setRecentCount(count || 0);
    }
    checkRecent();
    const interval = setInterval(checkRecent, 30000);
    return () => clearInterval(interval);
  }, [user]);

  const set = <K extends keyof AdLibraryFilters>(key: K, val: AdLibraryFilters[K]) =>
    onFilterChange({ ...filters, [key]: val });

  const activeFilterCount =
    (filters.platform ? 1 : 0) +
    (filters.format ? 1 : 0) +
    filters.tag_ids.length +
    (filters.dateFrom ? 1 : 0) +
    (filters.hasTranscript ? 1 : 0) +
    (filters.videoMissingFile ? 1 : 0) +
    (filters.timeFilter !== "all" ? 1 : 0);

  const clearFilter = (key: keyof AdLibraryFilters) => {
    if (key === "tag_ids") {
      set("tag_ids", []);
    } else if (key === "dateFrom") {
      onFilterChange({ ...filters, dateFrom: null, dateTo: null });
    } else if (key === "timeFilter") {
      set("timeFilter", "all");
    } else {
      set(key, null as any);
    }
  };

  const toggleTagFilter = (tagId: string) => {
    const current = filters.tag_ids;
    const next = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    set("tag_ids", next);
  };

  const selectedTagNames = availableTags
    .filter((t) => filters.tag_ids.includes(t.id))
    .map((t) => t.name);

  return (
    <div className="space-y-3">
      {/* Main toolbar row */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={filters.search}
            onChange={(e) => set("search", e.target.value)}
            placeholder="Search ads..."
            className="pl-9 h-9 text-sm"
          />
        </div>

        {/* Recently saved badge */}
        {recentCount > 0 && (
          <button
            onClick={() => {
              onFilterChange({ ...filters, timeFilter: "session", sort: "recent" });
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
          >
            <span className="w-2 h-2 bg-primary rounded-full animate-pulse" />
            {recentCount} just saved
          </button>
        )}

        {/* Time filter */}
        <Select
          value={filters.timeFilter}
          onValueChange={(v) => set("timeFilter", v)}
        >
          <SelectTrigger className="w-[140px] h-9 text-sm">
            <Clock className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIME_FILTER_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Platform */}
        <Select
          value={filters.platform || "all"}
          onValueChange={(v) => set("platform", v === "all" ? null : v)}
        >
          <SelectTrigger className="w-[130px] h-9 text-sm">
            <SelectValue placeholder="Platform" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Platforms</SelectItem>
            {PLATFORMS.map((p) => (
              <SelectItem key={p} value={p} className="capitalize">
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Format */}
        <Select
          value={filters.format || "all"}
          onValueChange={(v) => set("format", v === "all" ? null : v)}
        >
          <SelectTrigger className="w-[120px] h-9 text-sm">
            <SelectValue placeholder="Format" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Formats</SelectItem>
            {FORMATS.map((f) => (
              <SelectItem key={f} value={f} className="capitalize">
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Tags multi-select */}
        <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-9 gap-1.5 text-sm font-body",
                filters.tag_ids.length > 0 && "border-primary/40 text-primary"
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Tags
              {filters.tag_ids.length > 0 && (
                <Badge variant="default" className="h-4 min-w-4 px-1 text-[10px] rounded-full">
                  {filters.tag_ids.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2" align="start">
            <p className="font-label text-[11px] text-muted-foreground uppercase tracking-wider px-2 pb-2">
              Filter by Tags
            </p>
            {availableTags.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2 py-3">No tags created</p>
            ) : (
              availableTags.map((tag) => {
                const active = filters.tag_ids.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => toggleTagFilter(tag.id)}
                    className={cn(
                      "w-full text-left text-sm font-body px-2 py-1.5 rounded-md transition-colors flex items-center gap-2",
                      active ? "bg-primary/10 text-primary" : "hover:bg-accent"
                    )}
                  >
                    <div
                      className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="truncate">{tag.name}</span>
                    {active && <Check className="h-3.5 w-3.5 ml-auto" />}
                  </button>
                );
              })
            )}
          </PopoverContent>
        </Popover>

        {/* Date range */}
        <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-9 gap-1.5 text-sm font-body",
                filters.dateFrom && "border-primary/40 text-primary"
              )}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              Date Range
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" align="start">
            <p className="font-label text-[11px] text-muted-foreground uppercase tracking-wider pb-2">
              Date Range
            </p>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-muted-foreground">From</label>
                <Input
                  type="date"
                  value={filters.dateFrom || ""}
                  onChange={(e) => set("dateFrom", e.target.value || null)}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">To</label>
                <Input
                  type="date"
                  value={filters.dateTo || ""}
                  onChange={(e) => set("dateTo", e.target.value || null)}
                  className="h-8 text-sm"
                />
              </div>
              {filters.dateFrom && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => {
                    onFilterChange({ ...filters, dateFrom: null, dateTo: null });
                    setDatePopoverOpen(false);
                  }}
                >
                  Clear Dates
                </Button>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* Has Transcript toggle */}
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-9 gap-1.5 text-sm font-body",
            filters.hasTranscript && "border-primary/40 text-primary bg-primary/5"
          )}
          onClick={() => set("hasTranscript", !filters.hasTranscript)}
        >
          <Captions className="h-3.5 w-3.5" />
          CC
        </Button>

        {/* Video missing file filter */}
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-9 gap-1.5 text-sm font-body",
            filters.videoMissingFile && "border-amber-500/40 text-amber-600 bg-amber-500/5"
          )}
          onClick={() => set("videoMissingFile", !filters.videoMissingFile)}
        >
          <Video className="h-3.5 w-3.5" />
          Missing Video
        </Button>

        {/* Sort */}
        <Select value={filters.sort} onValueChange={(v) => set("sort", v)}>
          <SelectTrigger className="w-[170px] h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* View toggle */}
        <div className="flex items-center border border-border rounded-md overflow-hidden ml-auto">
          <button
            onClick={() => set("view", "grid")}
            className={cn(
              "h-9 w-9 flex items-center justify-center transition-colors",
              filters.view === "grid"
                ? "bg-primary text-primary-foreground"
                : "bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => set("view", "list")}
            className={cn(
              "h-9 w-9 flex items-center justify-center transition-colors",
              filters.view === "list"
                ? "bg-primary text-primary-foreground"
                : "bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            <List className="h-4 w-4" />
          </button>
        </div>

        {/* Count */}
        {totalCount !== undefined && (
          <span className="text-xs text-muted-foreground font-label tabular-nums">
            {totalCount} ad{totalCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Active filter pills */}
      {activeFilterCount > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-muted-foreground font-label uppercase tracking-wider mr-1">
            Active:
          </span>
          {filters.timeFilter !== "all" && (
            <Badge
              variant="secondary"
              className="text-xs gap-1 pl-2 pr-1 py-0.5 cursor-pointer hover:bg-secondary/60"
              onClick={() => clearFilter("timeFilter")}
            >
              {TIME_FILTER_OPTIONS.find((o) => o.value === filters.timeFilter)?.label}
              <X className="h-3 w-3" />
            </Badge>
          )}
          {filters.platform && (
            <Badge
              variant="secondary"
              className="text-xs gap-1 pl-2 pr-1 py-0.5 capitalize cursor-pointer hover:bg-secondary/60"
              onClick={() => clearFilter("platform")}
            >
              {filters.platform}
              <X className="h-3 w-3" />
            </Badge>
          )}
          {filters.format && (
            <Badge
              variant="secondary"
              className="text-xs gap-1 pl-2 pr-1 py-0.5 capitalize cursor-pointer hover:bg-secondary/60"
              onClick={() => clearFilter("format")}
            >
              {filters.format}
              <X className="h-3 w-3" />
            </Badge>
          )}
          {selectedTagNames.map((name, i) => (
            <Badge
              key={filters.tag_ids[i]}
              variant="secondary"
              className="text-xs gap-1 pl-2 pr-1 py-0.5 cursor-pointer hover:bg-secondary/60"
              onClick={() => toggleTagFilter(filters.tag_ids[i])}
            >
              {name}
              <X className="h-3 w-3" />
            </Badge>
          ))}
          {filters.dateFrom && (
            <Badge
              variant="secondary"
              className="text-xs gap-1 pl-2 pr-1 py-0.5 cursor-pointer hover:bg-secondary/60"
              onClick={() => clearFilter("dateFrom")}
            >
              {filters.dateFrom}
              {filters.dateTo ? ` → ${filters.dateTo}` : "+"}
              <X className="h-3 w-3" />
            </Badge>
          )}
          {filters.hasTranscript && (
            <Badge
              variant="secondary"
              className="text-xs gap-1 pl-2 pr-1 py-0.5 cursor-pointer hover:bg-secondary/60"
              onClick={() => set("hasTranscript", false)}
            >
              Has Transcript
              <X className="h-3 w-3" />
            </Badge>
          )}
          {filters.videoMissingFile && (
            <Badge
              variant="secondary"
              className="text-xs gap-1 pl-2 pr-1 py-0.5 cursor-pointer hover:bg-secondary/60"
              onClick={() => set("videoMissingFile", false)}
            >
              Missing Video File
              <X className="h-3 w-3" />
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px] text-muted-foreground px-2"
            onClick={() => onFilterChange({ ...DEFAULT_FILTERS, view: filters.view })}
          >
            Clear all
          </Button>
        </div>
      )}
    </div>
  );
}
