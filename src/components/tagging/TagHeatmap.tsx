import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface TagHeatmapProps {
  creatives: any[];
}

const HOOK_TYPES = ["Problem Callout", "Confession", "Question", "Statement Bold", "Authority Intro", "Before & After", "Pattern Interrupt"];
const FORMAT_TYPES = ["Video", "Static", "GIF", "Carousel"];

function getCellColor(roas: number | null) {
  if (roas === null) return "bg-muted";
  if (roas >= 2) return "bg-primary/70";
  if (roas >= 1) return "bg-warning/50";
  return "bg-destructive/40";
}

export function TagHeatmap({ creatives }: TagHeatmapProps) {
  const heatmapData = useMemo(() => {
    const data: Record<string, Record<string, { totalRoas: number; totalSpend: number; count: number }>> = {};

    for (const c of creatives) {
      const hook = c.hook;
      const format = c.ad_type;
      if (!hook || !format) continue;
      if (!HOOK_TYPES.includes(hook) || !FORMAT_TYPES.includes(format)) continue;

      if (!data[hook]) data[hook] = {};
      if (!data[hook][format]) data[hook][format] = { totalRoas: 0, totalSpend: 0, count: 0 };

      const spend = Number(c.spend) || 0;
      const roas = Number(c.roas) || 0;
      data[hook][format].totalRoas += roas * spend;
      data[hook][format].totalSpend += spend;
      data[hook][format].count += 1;
    }

    return data;
  }, [creatives]);

  const getAvgRoas = (hook: string, format: string): number | null => {
    const cell = heatmapData[hook]?.[format];
    if (!cell || cell.totalSpend === 0) return null;
    return cell.totalRoas / cell.totalSpend;
  };

  const getCount = (hook: string, format: string): number => {
    return heatmapData[hook]?.[format]?.count || 0;
  };

  // Check if there's any data at all
  const hasData = Object.keys(heatmapData).length > 0;
  if (!hasData) return null;

  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <h3 className="font-label text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">
        Tag Performance Heatmap
      </h3>
      <div className="overflow-x-auto">
        <TooltipProvider>
          <table className="w-auto">
            <thead>
              <tr>
                <th className="pr-3 pb-2 text-left font-label text-[9px] uppercase tracking-wider text-muted-foreground w-32" />
                {FORMAT_TYPES.map((f) => (
                  <th key={f} className="px-1 pb-2 text-center font-label text-[9px] uppercase tracking-wider text-muted-foreground min-w-[60px]">
                    {f}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {HOOK_TYPES.map((hook) => (
                <tr key={hook}>
                  <td className="pr-3 py-0.5 font-body text-[11px] text-foreground truncate max-w-[120px]">{hook}</td>
                  {FORMAT_TYPES.map((format) => {
                    const roas = getAvgRoas(hook, format);
                    const count = getCount(hook, format);
                    return (
                      <td key={format} className="px-1 py-0.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className={cn(
                              "h-7 w-full rounded-sm flex items-center justify-center cursor-default transition-colors",
                              getCellColor(roas)
                            )}>
                              {roas !== null && (
                                <span className="font-data text-[10px] tabular-nums text-foreground font-medium">
                                  {roas.toFixed(1)}x
                                </span>
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            {roas !== null ? (
                              <span>{hook} × {format}: {roas.toFixed(2)}x ROAS ({count} ads)</span>
                            ) : (
                              <span>No data</span>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </TooltipProvider>
      </div>
      <div className="flex items-center gap-3 mt-2 font-body text-[9px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary/70" /> ≥2x</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-warning/50" /> 1-2x</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-destructive/40" /> &lt;1x</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-muted" /> No data</span>
      </div>
    </div>
  );
}
