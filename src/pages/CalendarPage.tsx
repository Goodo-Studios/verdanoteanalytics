import { useState, useMemo, useCallback } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, X, GripVertical } from "lucide-react";
import { useCalendarCreatives } from "@/hooks/useCalendarCreatives";
import { useUpdateCreative } from "@/hooks/useCreatives";
import { useAccountContext } from "@/contexts/AccountContext";
import { CreativeDetailModal } from "@/components/CreativeDetailModal";
import { cn } from "@/lib/utils";
import {
  format, addMonths, subMonths, startOfMonth, endOfMonth,
  eachDayOfInterval, getDay, isSameMonth, isToday, startOfWeek, endOfWeek,
  addWeeks, subWeeks, eachDayOfInterval as eachDay,
} from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type ViewMode = "month" | "week";

interface Creative {
  ad_id: string;
  ad_name: string;
  account_id: string;
  thumbnail_url: string | null;
  scheduled_launch_date: string | null;
  spend: number | null;
  roas: number | null;
  ad_type: string | null;
  ad_status: string | null;
  created_at?: string;
  launchDate: string;
  isLaunched: boolean;
}

function getDotColor(creative: Creative): string {
  if (!creative.isLaunched) return "bg-muted-foreground/40 border border-muted-foreground/60";
  const roas = Number(creative.roas || 0);
  if (roas >= 2) return "bg-success";
  if (roas >= 1) return "bg-warning";
  if (roas > 0) return "bg-destructive";
  return "bg-muted-foreground/30";
}

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [detailAdId, setDetailAdId] = useState<string | null>(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [draggedCreative, setDraggedCreative] = useState<Creative | null>(null);

  const { selectedAccountId } = useAccountContext();
  const { data: creatives = [], isLoading } = useCalendarCreatives(currentDate);
  const updateCreative = useUpdateCreative();

  // Group creatives by date
  const creativesByDate = useMemo(() => {
    const map: Record<string, Creative[]> = {};
    for (const c of creatives) {
      const d = c.launchDate;
      if (!d) continue;
      if (!map[d]) map[d] = [];
      map[d].push(c);
    }
    return map;
  }, [creatives]);

  // Monthly summary
  const summary = useMemo(() => {
    const launched = creatives.filter(c => c.isLaunched);
    const scheduled = creatives.filter(c => !c.isLaunched);
    const avgRoas = launched.length > 0
      ? launched.reduce((s, c) => s + Number(c.roas || 0), 0) / launched.length
      : 0;
    return { launched: launched.length, scheduled: scheduled.length, avgRoas };
  }, [creatives]);

  // Calendar grid for month view
  const monthDays = useMemo(() => {
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    const weekStart = startOfWeek(start, { weekStartsOn: 0 });
    const weekEnd = endOfWeek(end, { weekStartsOn: 0 });
    return eachDayOfInterval({ start: weekStart, end: weekEnd });
  }, [currentDate]);

  // Week view days
  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate, { weekStartsOn: 0 });
    const end = endOfWeek(currentDate, { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [currentDate]);

  const navigate = (dir: number) => {
    if (viewMode === "month") {
      setCurrentDate(dir > 0 ? addMonths(currentDate, 1) : subMonths(currentDate, 1));
    } else {
      setCurrentDate(dir > 0 ? addWeeks(currentDate, 1) : subWeeks(currentDate, 1));
    }
  };

  const handleDayClick = (date: Date) => {
    setSelectedDay(format(date, "yyyy-MM-dd"));
  };

  const handleScheduleClick = (dateStr: string) => {
    setScheduleDate(dateStr);
    setShowScheduleModal(true);
    setSearchTerm("");
    setSearchResults([]);
  };

  const handleSearch = useCallback(async (term: string) => {
    setSearchTerm(term);
    if (term.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      let query = supabase
        .from("creatives")
        .select("ad_id, ad_name, thumbnail_url, account_id, scheduled_launch_date")
        .ilike("ad_name", `%${term}%`)
        .is("scheduled_launch_date", null)
        .limit(10);

      if (selectedAccountId && selectedAccountId !== "all") {
        query = query.eq("account_id", selectedAccountId);
      }

      const { data } = await query;
      setSearchResults(data || []);
    } finally {
      setSearching(false);
    }
  }, [selectedAccountId]);

  const handleAssignDate = async (adId: string) => {
    try {
      await updateCreative.mutateAsync({
        adId,
        updates: { scheduled_launch_date: scheduleDate },
      });
      toast.success("Creative scheduled");
      setShowScheduleModal(false);
    } catch {
      toast.error("Failed to schedule creative");
    }
  };

  const handleDrop = async (date: string) => {
    if (!draggedCreative) return;
    try {
      await updateCreative.mutateAsync({
        adId: draggedCreative.ad_id,
        updates: { scheduled_launch_date: date },
      });
      toast.success(`Rescheduled to ${date}`);
    } catch {
      toast.error("Failed to reschedule");
    }
    setDraggedCreative(null);
  };

  const dayCreatives = selectedDay ? (creativesByDate[selectedDay] || []) : [];
  const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <AppLayout>
      <PageHeader title="Calendar" description="Track creative launch schedules" />

      {/* Summary bar */}
      <div className="glass-panel px-5 py-3 mb-5 flex items-center gap-6 flex-wrap">
        <span className="font-heading text-[16px] text-forest">
          {format(currentDate, viewMode === "month" ? "MMMM yyyy" : "'Week of' MMM d, yyyy")}
        </span>
        <div className="flex items-center gap-4 ml-auto">
          <span className="font-data text-[13px] text-muted-foreground tabular-nums">
            <span className="font-semibold text-success">{summary.launched}</span> launched
          </span>
          <span className="font-data text-[13px] text-muted-foreground tabular-nums">
            <span className="font-semibold text-foreground">{summary.scheduled}</span> scheduled
          </span>
          {summary.launched > 0 && (
            <span className="font-data text-[13px] text-muted-foreground tabular-nums">
              Avg ROAS: <span className="font-semibold text-primary">{summary.avgRoas.toFixed(2)}x</span>
            </span>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 mb-4">
        <Button variant="outline" size="sm" onClick={() => navigate(-1)} className="h-8 w-8 p-0">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())} className="h-8 font-body text-[12px]">
          Today
        </Button>
        <Button variant="outline" size="sm" onClick={() => navigate(1)} className="h-8 w-8 p-0">
          <ChevronRight className="h-4 w-4" />
        </Button>

        <div className="ml-auto flex items-center gap-1 glass-inset p-0.5 rounded-md">
          <button
            onClick={() => setViewMode("month")}
            className={cn(
              "px-3 py-1 rounded font-body text-[12px] transition-colors",
              viewMode === "month" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Month
          </button>
          <button
            onClick={() => setViewMode("week")}
            className={cn(
              "px-3 py-1 rounded font-body text-[12px] transition-colors",
              viewMode === "week" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Week
          </button>
        </div>
      </div>

      <div className="flex gap-4">
        {/* Calendar grid */}
        <div className="flex-1">
          {viewMode === "month" ? (
            <div className="glass-panel overflow-hidden">
              {/* Weekday headers */}
              <div className="grid grid-cols-7 border-b border-border-light">
                {WEEKDAY_LABELS.map(d => (
                  <div key={d} className="px-2 py-2 text-center font-label text-[10px] uppercase tracking-wider text-muted-foreground">
                    {d}
                  </div>
                ))}
              </div>
              {/* Day cells */}
              <div className="grid grid-cols-7">
                {monthDays.map((day) => {
                  const dateStr = format(day, "yyyy-MM-dd");
                  const dayCreatives = creativesByDate[dateStr] || [];
                  const inMonth = isSameMonth(day, currentDate);
                  const today = isToday(day);

                  return (
                    <div
                      key={dateStr}
                      className={cn(
                        "min-h-[90px] border-b border-r border-border-light p-1.5 cursor-pointer transition-colors",
                        !inMonth && "bg-muted/20",
                        today && "bg-primary/5",
                        selectedDay === dateStr && "ring-2 ring-primary/30 ring-inset",
                        "hover:bg-accent/40"
                      )}
                      onClick={() => handleDayClick(day)}
                      onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("bg-primary/10"); }}
                      onDragLeave={(e) => e.currentTarget.classList.remove("bg-primary/10")}
                      onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove("bg-primary/10"); handleDrop(dateStr); }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={cn(
                          "font-data text-[12px] tabular-nums",
                          today ? "bg-primary text-primary-foreground h-5 w-5 rounded-full flex items-center justify-center font-semibold" : "",
                          !inMonth ? "text-muted-foreground/40" : "text-foreground"
                        )}>
                          {format(day, "d")}
                        </span>
                        {inMonth && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleScheduleClick(dateStr); }}
                            className="h-4 w-4 rounded flex items-center justify-center text-muted-foreground/40 hover:text-primary hover:bg-primary/10 transition-colors"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      {/* Creative dots */}
                      <div className="flex flex-wrap gap-1">
                        {dayCreatives.slice(0, 6).map(c => (
                          <div
                            key={c.ad_id}
                            className={cn("h-2.5 w-2.5 rounded-full cursor-grab", getDotColor(c))}
                            title={c.ad_name}
                            draggable
                            onDragStart={(e) => { e.stopPropagation(); setDraggedCreative(c); }}
                          />
                        ))}
                        {dayCreatives.length > 6 && (
                          <span className="font-data text-[9px] text-muted-foreground">+{dayCreatives.length - 6}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Week view */
            <div className="glass-panel overflow-hidden">
              <div className="grid grid-cols-7">
                {weekDays.map(day => {
                  const dateStr = format(day, "yyyy-MM-dd");
                  const dayCreatives = creativesByDate[dateStr] || [];
                  const today = isToday(day);

                  return (
                    <div
                      key={dateStr}
                      className={cn(
                        "min-h-[400px] border-r border-border-light p-2 last:border-r-0",
                        today && "bg-primary/5",
                        selectedDay === dateStr && "ring-2 ring-primary/30 ring-inset"
                      )}
                      onClick={() => handleDayClick(day)}
                      onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("bg-primary/10"); }}
                      onDragLeave={(e) => e.currentTarget.classList.remove("bg-primary/10")}
                      onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove("bg-primary/10"); handleDrop(dateStr); }}
                    >
                      <div className="text-center mb-3">
                        <div className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">
                          {format(day, "EEE")}
                        </div>
                        <div className={cn(
                          "font-data text-[16px] font-semibold tabular-nums mt-0.5",
                          today ? "bg-primary text-primary-foreground h-7 w-7 rounded-full flex items-center justify-center mx-auto" : "text-foreground"
                        )}>
                          {format(day, "d")}
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleScheduleClick(dateStr); }}
                        className="w-full mb-2 py-1 rounded border border-dashed border-border-light text-muted-foreground/40 hover:border-primary hover:text-primary transition-colors font-body text-[11px]"
                      >
                        <Plus className="h-3 w-3 mx-auto" />
                      </button>
                      <div className="space-y-1.5">
                        {dayCreatives.map(c => (
                          <div
                            key={c.ad_id}
                            className="flex items-center gap-1.5 p-1.5 rounded bg-muted/30 cursor-grab hover:bg-muted/50 transition-colors"
                            draggable
                            onDragStart={() => setDraggedCreative(c)}
                            onClick={(e) => { e.stopPropagation(); if (c.isLaunched) setDetailAdId(c.ad_id); }}
                          >
                            <div className={cn("h-2 w-2 rounded-full flex-shrink-0", getDotColor(c))} />
                            {c.thumbnail_url && (
                              <img src={c.thumbnail_url} alt="" className="h-6 w-6 rounded object-cover flex-shrink-0" />
                            )}
                            <span className="font-body text-[10px] text-charcoal truncate flex-1">{c.ad_name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Day side panel */}
        {selectedDay && (
          <div className="w-72 flex-shrink-0 glass-panel p-4 space-y-3 self-start sticky top-20">
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-[16px] text-forest">
                {format(new Date(selectedDay + "T12:00:00"), "EEEE, MMM d")}
              </h3>
              <button onClick={() => setSelectedDay(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {dayCreatives.length === 0 ? (
              <p className="font-body text-[13px] text-muted-foreground">No creatives for this day.</p>
            ) : (
              <div className="space-y-2">
                {(creativesByDate[selectedDay] || []).map(c => (
                  <div
                    key={c.ad_id}
                    className="flex items-center gap-2.5 p-2 rounded-md hover:bg-accent/40 cursor-pointer transition-colors"
                    onClick={() => { if (c.isLaunched) setDetailAdId(c.ad_id); }}
                  >
                    {c.thumbnail_url ? (
                      <img src={c.thumbnail_url} alt="" className="h-10 w-10 rounded object-cover border border-border-light flex-shrink-0" />
                    ) : (
                      <div className="h-10 w-10 rounded bg-muted flex items-center justify-center flex-shrink-0">
                        <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-body text-[12px] font-semibold text-charcoal truncate">{c.ad_name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <div className={cn("h-2 w-2 rounded-full flex-shrink-0", getDotColor(c))} />
                        <span className="font-data text-[11px] text-muted-foreground">
                          {c.isLaunched ? `${Number(c.roas || 0).toFixed(2)}x ROAS` : "Scheduled"}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              className="w-full mt-2"
              onClick={() => handleScheduleClick(selectedDay)}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Schedule Creative
            </Button>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-4 px-1">
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-success" />
          <span className="font-body text-[11px] text-muted-foreground">ROAS ≥ 2x</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-warning" />
          <span className="font-body text-[11px] text-muted-foreground">Monitoring</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-destructive" />
          <span className="font-body text-[11px] text-muted-foreground">Below kill</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40 border border-muted-foreground/60" />
          <span className="font-body text-[11px] text-muted-foreground">Scheduled</span>
        </div>
      </div>

      {/* Schedule Creative Modal */}
      <Dialog open={showScheduleModal} onOpenChange={setShowScheduleModal}>
        <DialogContent className="max-w-md bg-white rounded-[8px] shadow-modal p-6">
          <DialogHeader>
            <DialogTitle className="font-heading text-[18px] text-forest flex items-center gap-2">
              <CalendarIcon className="h-4 w-4 text-sage" />
              Schedule Creative
            </DialogTitle>
          </DialogHeader>
          <p className="font-body text-[13px] text-muted-foreground">
            Scheduling for <span className="font-semibold text-foreground">{scheduleDate && format(new Date(scheduleDate + "T12:00:00"), "MMM d, yyyy")}</span>
          </p>
          <div className="space-y-3">
            <div>
              <Label className="font-body text-[13px] text-charcoal">Search creatives by name</Label>
              <Input
                className="mt-1 bg-background"
                placeholder="Type to search..."
                value={searchTerm}
                onChange={(e) => handleSearch(e.target.value)}
              />
            </div>
            <div className="max-h-[250px] overflow-y-auto space-y-1">
              {searching && <p className="font-body text-[12px] text-muted-foreground py-2">Searching...</p>}
              {searchResults.map(c => (
                <button
                  key={c.ad_id}
                  className="w-full flex items-center gap-2.5 p-2 rounded-md hover:bg-accent/40 transition-colors text-left"
                  onClick={() => handleAssignDate(c.ad_id)}
                >
                  {c.thumbnail_url ? (
                    <img src={c.thumbnail_url} alt="" className="h-8 w-8 rounded object-cover border border-border-light" />
                  ) : (
                    <div className="h-8 w-8 rounded bg-muted" />
                  )}
                  <span className="font-body text-[12px] text-charcoal truncate flex-1">{c.ad_name}</span>
                </button>
              ))}
              {searchTerm.length >= 2 && !searching && searchResults.length === 0 && (
                <p className="font-body text-[12px] text-muted-foreground py-2">No unscheduled creatives found.</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Creative Detail Modal */}
      {detailAdId && (() => {
        const c = creatives.find(cr => cr.ad_id === detailAdId);
        return c ? (
          <CreativeDetailModal
            creative={c}
            open={!!detailAdId}
            onClose={() => setDetailAdId(null)}
          />
        ) : null;
      })()}
    </AppLayout>
  );
}
