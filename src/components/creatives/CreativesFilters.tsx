import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Layers, Filter, ChevronDown, ChevronUp } from "lucide-react";
import { GROUP_BY_OPTIONS } from "./constants";

interface CreativesFiltersProps {
  dateFrom?: string;
  dateTo?: string;
  onDateChange: (from?: string, to?: string) => void;
  filters: Record<string, string>;
  updateFilter: (key: string, val: string) => void;
  filterOptions: any;
  groupBy: string;
  setGroupBy: (v: string) => void;
  viewMode: "table" | "card" | "timeline";
  momentumFilter?: string;
  onMomentumChange?: (v: string) => void;
  fatigueFilter?: string;
  onFatigueChange?: (v: string) => void;
  platformFilter?: string;
  onPlatformChange?: (v: string) => void;
}

export function CreativesFilters({
  dateFrom, dateTo, onDateChange,
  filters, updateFilter, filterOptions, groupBy, setGroupBy, viewMode,
  momentumFilter, onMomentumChange,
  fatigueFilter, onFatigueChange,
  platformFilter, onPlatformChange,
}: CreativesFiltersProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeCount = Object.entries(filters).filter(([k, v]) => v && v !== "__all__" && k !== "tag_source").length;

  const filterControls = (
    <>
      {filterOptions && (
        <>
          {(["ad_type", "person", "style", "hook"] as const).map((field) => (
            <Select key={field} value={filters[field] || "__all__"} onValueChange={(v) => updateFilter(field, v)}>
              <SelectTrigger className={`w-full sm:w-32 h-8 font-body text-[12px] font-medium bg-background rounded-[6px] border ${filters[field] && filters[field] !== "__all__" ? "border-verdant text-forest bg-sage-light" : "border-border-light text-slate"}`}>
                <SelectValue placeholder={field.replace("ad_", "").replace("_", " ")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All {field.replace("ad_", "").replace("_", " ")}</SelectItem>
                {(filterOptions[field] || []).map((opt: string) => (
                  <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ))}
          <Select value={filters.tag_source || "__all__"} onValueChange={(v) => updateFilter("tag_source", v)}>
            <SelectTrigger className={`w-full sm:w-32 h-8 font-body text-[12px] font-medium bg-background rounded-[6px] border ${filters.tag_source && filters.tag_source !== "__all__" ? "border-verdant text-forest bg-sage-light" : "border-border-light text-slate"}`}><SelectValue placeholder="Tag source" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All sources</SelectItem>
              <SelectItem value="parsed">Parsed</SelectItem>
              <SelectItem value="csv_match">CSV Match</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="untagged">Untagged</SelectItem>
            </SelectContent>
          </Select>
          {onMomentumChange && (
            <Select value={momentumFilter || "__all__"} onValueChange={onMomentumChange}>
              <SelectTrigger className={`w-full sm:w-40 h-8 font-body text-[12px] font-medium bg-background rounded-[6px] border ${momentumFilter && momentumFilter !== "__all__" ? "border-verdant text-forest bg-sage-light" : "border-border-light text-slate"}`}>
                <SelectValue placeholder="Momentum" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All momentum</SelectItem>
                <SelectItem value="gaining">Gaining momentum</SelectItem>
                <SelectItem value="steady">Holding steady</SelectItem>
                <SelectItem value="losing">Losing momentum</SelectItem>
                <SelectItem value="fading">Fading fast</SelectItem>
              </SelectContent>
            </Select>
          )}
          {onFatigueChange && (
            <Select value={fatigueFilter || "__all__"} onValueChange={onFatigueChange}>
              <SelectTrigger className={`w-full sm:w-36 h-8 font-body text-[12px] font-medium bg-background rounded-[6px] border ${fatigueFilter && fatigueFilter !== "__all__" ? "border-verdant text-forest bg-sage-light" : "border-border-light text-slate"}`}>
                <SelectValue placeholder="Fatigue" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All fatigue</SelectItem>
                <SelectItem value="high">🔥 High Fatigue</SelectItem>
                <SelectItem value="warning">⚠️ Fatiguing</SelectItem>
                <SelectItem value="forecast">📈 Fatigue soon (7d)</SelectItem>
                <SelectItem value="ok">Healthy</SelectItem>
              </SelectContent>
            </Select>
          )}
        </>
      )}
      {viewMode === "table" && (
        <Select value={groupBy} onValueChange={setGroupBy}>
          <SelectTrigger className="w-full sm:w-36 h-8 font-body text-[12px] font-medium text-slate bg-background rounded-[6px] border border-border-light">
            <div className="flex items-center gap-1.5">
              <Layers className="h-3 w-3" />
              <SelectValue placeholder="Group by" />
            </div>
          </SelectTrigger>
          <SelectContent>
            {GROUP_BY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </>
  );

  return (
    <>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-muted-foreground mr-1">Date:</span>
        <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onChange={onDateChange} />
      </div>

      {/* Desktop filters */}
      <div className="hidden sm:flex items-center gap-2 mb-4 flex-wrap">
        {filterControls}
      </div>

      {/* Mobile collapsible filters */}
      <div className="sm:hidden mb-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMobileOpen(!mobileOpen)}
          className="w-full justify-between text-[12px] font-body"
        >
          <span className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5" />
            Filters {activeCount > 0 && `(${activeCount})`}
          </span>
          {mobileOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </Button>
        {mobileOpen && (
          <div className="mt-2 space-y-2 p-3 border border-border rounded-lg bg-card">
            {filterControls}
          </div>
        )}
      </div>
    </>
  );
}
