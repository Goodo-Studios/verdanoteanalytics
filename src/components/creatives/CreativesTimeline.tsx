import { useMemo, useState } from "react";
import { format, startOfWeek, subWeeks, isAfter, isBefore, addWeeks } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { GRADE_STYLES, type Grade, type GradeInfo } from "@/lib/creativeGrading";
import { cn } from "@/lib/utils";

type ZoomLevel = 4 | 8 | 12;

interface CreativesTimelineProps {
  creatives: any[];
  gradeMap: Map<string, GradeInfo>;
  onSelect: (creative: any) => void;
}

/** Map grade → Tailwind bg class for the pill */
const PILL_COLORS: Record<Grade, string> = {
  A: "bg-emerald-600",
  B: "bg-emerald-400",
  C: "bg-amber-400",
  D: "bg-orange-500",
  F: "bg-red-500",
};
const PILL_TEXT: Record<Grade, string> = {
  A: "text-white",
  B: "text-white",
  C: "text-amber-950",
  D: "text-white",
  F: "text-white",
};

export function CreativesTimeline({ creatives, gradeMap, onSelect }: CreativesTimelineProps) {
  const [zoom, setZoom] = useState<ZoomLevel>(12);

  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });

  // Generate week columns
  const weeks = useMemo(() => {
    const result: { start: Date; label: string }[] = [];
    for (let i = zoom - 1; i >= 0; i--) {
      const start = subWeeks(weekStart, i);
      result.push({ start, label: format(start, "MMM d") });
    }
    return result;
  }, [zoom, weekStart]);

  const rangeStart = weeks[0].start;
  const rangeEnd = addWeeks(weekStart, 1);

  // Group creatives by campaign, assign to weeks
  const { campaigns, maxSpend } = useMemo(() => {
    // Filter to creatives with a created_at within range
    const inRange = creatives.filter((c: any) => {
      const d = new Date(c.created_at);
      return isAfter(d, rangeStart) && isBefore(d, rangeEnd);
    });

    // Group by campaign
    const campMap: Record<string, { name: string; totalSpend: number; items: any[] }> = {};
    for (const c of inRange) {
      const key = c.campaign_name || "(No Campaign)";
      if (!campMap[key]) campMap[key] = { name: key, totalSpend: 0, items: [] };
      campMap[key].items.push(c);
      campMap[key].totalSpend += Number(c.spend) || 0;
    }

    // Sort by spend, take top 8 + "Other"
    const sorted = Object.values(campMap).sort((a, b) => b.totalSpend - a.totalSpend);
    let campaigns: { name: string; items: any[] }[];
    if (sorted.length > 9) {
      const top8 = sorted.slice(0, 8);
      const rest = sorted.slice(8);
      const otherItems = rest.flatMap((g) => g.items);
      campaigns = [...top8, { name: "Other", items: otherItems }];
    } else {
      campaigns = sorted;
    }

    // Find max spend for sizing
    let maxSpend = 0;
    for (const c of inRange) {
      const s = Number(c.spend) || 0;
      if (s > maxSpend) maxSpend = s;
    }

    return { campaigns, maxSpend: maxSpend || 1 };
  }, [creatives, rangeStart, rangeEnd]);

  // Get week index for a date
  const getWeekIdx = (dateStr: string) => {
    const d = new Date(dateStr);
    for (let i = weeks.length - 1; i >= 0; i--) {
      if (isAfter(d, weeks[i].start) || d.getTime() === weeks[i].start.getTime()) return i;
    }
    return 0;
  };

  if (campaigns.length === 0) {
    return (
      <div className="glass-panel flex flex-col items-center justify-center py-16 text-center">
        <h3 className="font-heading text-[18px] text-forest mb-1">No creatives in this time range</h3>
        <p className="font-body text-[13px] text-slate">Try expanding the zoom range or selecting a different account.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Zoom controls */}
      <div className="flex items-center gap-2">
        <span className="font-label text-[11px] font-medium text-sage uppercase tracking-wider">Zoom</span>
        {([4, 8, 12] as ZoomLevel[]).map((z) => (
          <Button
            key={z}
            size="sm"
            variant={zoom === z ? "secondary" : "ghost"}
            className="h-7 px-2.5 font-data text-[12px]"
            onClick={() => setZoom(z)}
          >
            {z}w
          </Button>
        ))}
      </div>

      {/* Timeline grid */}
      <div className="overflow-x-auto border border-border-light rounded-lg bg-card">
        <div className="min-w-[700px]">
          {/* Week headers */}
          <div className="flex border-b border-border-light">
            <div className="w-[180px] flex-shrink-0 px-3 py-2 font-label text-[10px] font-semibold text-sage uppercase tracking-wider">
              Campaign
            </div>
            {weeks.map((w, i) => (
              <div
                key={i}
                className="flex-1 px-1.5 py-2 text-center font-label text-[10px] font-medium text-slate border-l border-border-light"
              >
                {w.label}
              </div>
            ))}
          </div>

          {/* Campaign rows */}
          {campaigns.map((campaign) => {
            // Bucket items into weeks
            const buckets: any[][] = weeks.map(() => []);
            for (const item of campaign.items) {
              const idx = getWeekIdx(item.created_at);
              buckets[idx].push(item);
            }

            return (
              <div key={campaign.name} className="flex border-b border-border-light last:border-b-0 group/row hover:bg-muted/30">
                <div className="w-[180px] flex-shrink-0 px-3 py-2.5 font-body text-[12px] font-medium text-charcoal truncate" title={campaign.name}>
                  {campaign.name}
                </div>
                {buckets.map((items, weekIdx) => (
                  <div
                    key={weekIdx}
                    className="flex-1 px-1 py-1.5 border-l border-border-light flex flex-wrap gap-1 items-start content-start min-h-[36px]"
                  >
                    {items.map((c: any) => {
                      const grade = gradeMap.get(c.ad_id)?.grade ?? "F";
                      const spend = Number(c.spend) || 0;
                      const roas = Number(c.roas) || 0;
                      // Width proportional to spend, min 28px max 120px
                      const widthPx = Math.max(28, Math.min(120, (spend / maxSpend) * 100 + 28));

                      return (
                        <Tooltip key={c.ad_id}>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => onSelect(c)}
                              className={cn(
                                "h-[22px] rounded-[4px] font-data text-[9px] font-bold px-1.5 truncate cursor-pointer transition-all hover:scale-105 hover:shadow-sm",
                                PILL_COLORS[grade],
                                PILL_TEXT[grade]
                              )}
                              style={{ width: `${widthPx}px`, maxWidth: "100%" }}
                            >
                              {grade}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[260px]">
                            <p className="font-body text-[12px] font-semibold text-foreground truncate">{c.ad_name}</p>
                            <div className="flex items-center gap-3 mt-1 font-data text-[11px] text-muted-foreground">
                              <span>ROAS: {roas.toFixed(2)}x</span>
                              <span>Spend: ${spend.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
                            </div>
                            <p className="font-body text-[10px] text-muted-foreground mt-0.5">
                              Launched {format(new Date(c.created_at), "MMM d, yyyy")}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 pt-1">
        <span className="font-label text-[10px] text-sage uppercase tracking-wider">Grade</span>
        {(["A", "B", "C", "D", "F"] as Grade[]).map((g) => (
          <div key={g} className="flex items-center gap-1">
            <span className={cn("w-3 h-3 rounded-[2px]", PILL_COLORS[g])} />
            <span className="font-data text-[10px] text-slate">{g}</span>
          </div>
        ))}
        <span className="font-label text-[10px] text-sage ml-2">Pill width = spend</span>
      </div>
    </div>
  );
}
