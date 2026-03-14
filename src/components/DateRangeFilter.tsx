import { useState } from "react";
import { format, subDays, startOfMonth, startOfWeek, subMonths } from "date-fns";
import { CalendarIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const yesterday = () => subDays(new Date(), 1);

const PRESETS = [
  { label: "Today", from: () => new Date(), to: () => new Date() },
  { label: "Yesterday", from: () => subDays(new Date(), 1), to: () => subDays(new Date(), 1) },
  { label: "Last 7 days", from: () => subDays(new Date(), 7), to: () => yesterday() },
  { label: "Last 14 days", from: () => subDays(new Date(), 14), to: () => yesterday() },
  { label: "Last 30 days", from: () => subDays(new Date(), 30), to: () => yesterday() },
  { label: "This Week", from: () => startOfWeek(new Date(), { weekStartsOn: 1 }), to: () => yesterday() },
  { label: "This Month", from: () => startOfMonth(new Date()), to: () => yesterday() },
  { label: "Last Month", from: () => startOfMonth(subMonths(new Date(), 1)), to: () => subDays(startOfMonth(new Date()), 1) },
];

interface DateRangeFilterProps {
  dateFrom?: string;
  dateTo?: string;
  onChange: (dateFrom?: string, dateTo?: string) => void;
}

export function DateRangeFilter({ dateFrom, dateTo, onChange }: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const [pickingFrom, setPickingFrom] = useState(true);

  const fromDate = dateFrom ? new Date(dateFrom) : undefined;
  const toDate = dateTo ? new Date(dateTo) : undefined;

  const handlePreset = (preset: typeof PRESETS[number]) => {
    onChange(format(preset.from(), "yyyy-MM-dd"), format(preset.to(), "yyyy-MM-dd"));
    setOpen(false);
  };

  const handleCalendarSelect = (date?: Date) => {
    if (!date) return;
    const formatted = format(date, "yyyy-MM-dd");
    if (pickingFrom) {
      onChange(formatted, dateTo && formatted > dateTo ? formatted : dateTo);
      setPickingFrom(false);
    } else {
      onChange(dateFrom && formatted < dateFrom ? formatted : dateFrom, formatted);
      setPickingFrom(true);
    }
  };

  const activePreset = PRESETS.find(p => {
    if (!dateFrom || !dateTo) return false;
    return format(p.from(), "yyyy-MM-dd") === dateFrom && format(p.to(), "yyyy-MM-dd") === dateTo;
  });

  const hasRange = dateFrom || dateTo;

  const displayLabel = activePreset
    ? activePreset.label
    : hasRange
      ? `${dateFrom ? format(new Date(dateFrom), "MMM d") : "…"} – ${dateTo ? format(new Date(dateTo), "MMM d") : "…"}`
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
              {PRESETS.map((p) => (
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
                <button
                  onClick={() => setPickingFrom(true)}
                  className={cn(
                    "font-label text-[10px] font-medium tracking-wide px-2 py-0.5 rounded-[4px] transition-colors",
                    pickingFrom ? "bg-verdant text-white" : "text-slate bg-transparent hover:text-forest"
                  )}
                >
                  {dateFrom ? format(new Date(dateFrom), "MMM d, yyyy") : "Start date"}
                </button>
                <span className="text-[10px] text-sage">–</span>
                <button
                  onClick={() => setPickingFrom(false)}
                  className={cn(
                    "font-label text-[10px] font-medium tracking-wide px-2 py-0.5 rounded-[4px] transition-colors",
                    !pickingFrom ? "bg-verdant text-white" : "text-slate bg-transparent hover:text-forest"
                  )}
                >
                  {dateTo ? format(new Date(dateTo), "MMM d, yyyy") : "End date"}
                </button>
              </div>
              <Calendar
                mode="single"
                selected={pickingFrom ? fromDate : toDate}
                onSelect={handleCalendarSelect}
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
          onClick={() => { onChange(undefined, undefined); setPickingFrom(true); }}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
