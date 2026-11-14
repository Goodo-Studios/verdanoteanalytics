import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { parsePickerDate, formatPickerDate, ROLLING_PRESETS, utcToday, type RollingPreset } from "@/lib/dateRange";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface DateRangeFilterProps {
  dateFrom?: string;
  dateTo?: string;
  /** presetId is set only when the range came from a rolling preset (see ROLLING_PRESETS). */
  onChange: (dateFrom?: string, dateTo?: string, presetId?: string) => void;
}

export function DateRangeFilter({ dateFrom, dateTo, onChange }: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);

  const fromDate = dateFrom ? parsePickerDate(dateFrom) : undefined;
  const toDate = dateTo ? parsePickerDate(dateTo) : undefined;

  const handlePreset = (preset: RollingPreset) => {
    // "Today" is the UTC date, the calendar the server windows use.
    const today = utcToday();
    onChange(format(preset.from(today), "yyyy-MM-dd"), format(preset.to(today), "yyyy-MM-dd"), preset.id);
    setOpen(false);
  };

  // Range mode: the calendar builds {from, to} natively (1st click = from,
  // 2nd = to) and highlights the whole span. Format with local `format()` —
  // the Date is already a local-midnight calendar date.
  const handleRangeSelect = (range?: DateRange) => {
    onChange(
      range?.from ? format(range.from, "yyyy-MM-dd") : undefined,
      range?.to ? format(range.to, "yyyy-MM-dd") : undefined,
    );
  };

  const activePreset = ROLLING_PRESETS.find(p => {
    if (!dateFrom || !dateTo) return false;
    const today = utcToday();
    return format(p.from(today), "yyyy-MM-dd") === dateFrom && format(p.to(today), "yyyy-MM-dd") === dateTo;
  });

  const hasRange = dateFrom || dateTo;

  const displayLabel = activePreset
    ? activePreset.label
    : hasRange
      ? `${dateFrom ? formatPickerDate(dateFrom, "MMM d") : "…"} – ${dateTo ? formatPickerDate(dateTo, "MMM d") : "…"}`
      : "Date Range";

  return (
    <div className="flex items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn("h-8 text-xs justify-start", !hasRange && "text-muted-foreground")}
          >
            <CalendarIcon className="h-3.5 w-3.5 mr-1.5" />
            {displayLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 z-50 bg-white border border-border-light rounded-[8px] shadow-modal" align="start" sideOffset={4}>
          <div className="flex p-4 gap-3">
            {/* Presets sidebar */}
            <div className="border-r border-border-light pr-3 w-[160px] space-y-0.5">
              <p className="font-label text-[9px] font-semibold uppercase tracking-[0.1em] text-sage px-3.5 pb-1">Presets</p>
              {ROLLING_PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => handlePreset(p)}
                  className={cn(
                    "w-full text-left font-body text-[13px] px-3.5 py-1.5 rounded transition-colors",
                    activePreset?.label === p.label
                      ? "font-medium text-forest bg-sage-light"
                      : "font-normal text-charcoal hover:bg-sage-light hover:text-forest"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Calendar */}
            <div>
              <div className="flex items-center gap-1.5 pb-2 border-b border-border-light mb-1.5">
                <span
                  className={cn(
                    "font-label text-[10px] font-medium tracking-wide px-2 py-0.5 rounded-[4px]",
                    dateFrom ? "bg-verdant text-white" : "text-slate"
                  )}
                >
                  {dateFrom ? formatPickerDate(dateFrom, "MMM d, yyyy") : "Start date"}
                </span>
                <span className="text-[10px] text-sage">–</span>
                <span
                  className={cn(
                    "font-label text-[10px] font-medium tracking-wide px-2 py-0.5 rounded-[4px]",
                    dateTo ? "bg-verdant text-white" : "text-slate"
                  )}
                >
                  {dateTo ? formatPickerDate(dateTo, "MMM d, yyyy") : "End date"}
                </span>
              </div>
              <Calendar
                mode="range"
                selected={fromDate ? { from: fromDate, to: toDate } : undefined}
                onSelect={handleRangeSelect}
                disabled={(date) => date > new Date()}
                initialFocus
                className="p-0 pointer-events-auto"
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {hasRange && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => onChange(undefined, undefined)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
