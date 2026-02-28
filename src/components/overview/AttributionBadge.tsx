import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { INDUSTRY_CATEGORIES } from "@/components/settings/AttributionSection";
import { Info } from "lucide-react";

interface AttributionBadgeProps {
  account: any;
  currentRoas?: number;
}

export function AttributionBadge({ account, currentRoas }: AttributionBadgeProps) {
  if (!account) return null;

  const clickWindow = account.click_window ?? 7;
  const viewWindow = account.view_window ?? 1;
  const attrModel = account.attribution_model ?? "last_touch";
  const category = account.industry_category;

  const clickLabel = clickWindow === 1 ? "1d click" : clickWindow === 7 ? "7d click" : "28d click";
  const viewLabel = viewWindow === 0 ? "no view" : "1d view";

  const modelLabel = attrModel === "last_touch" ? "Last Touch" : attrModel === "linear" ? "Linear" : "Data-Driven";

  const industryInfo = category
    ? INDUSTRY_CATEGORIES.find((c) => c.value === category)
    : null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 font-data text-[11px] font-medium bg-muted text-muted-foreground px-2 py-0.5 rounded-md cursor-help">
            {clickLabel} · {viewLabel}
            <Info className="h-3 w-3" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[280px] space-y-2 p-3">
          <div>
            <p className="font-label text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Attribution Window</p>
            <p className="font-body text-[12px] text-foreground">
              ROAS is calculated using <strong>{clickWindow}-day click</strong>
              {viewWindow > 0 ? ` + ${viewWindow}-day view` : ""} attribution ({modelLabel}).
            </p>
          </div>
          {account.attribution_notes && (
            <div>
              <p className="font-label text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Notes</p>
              <p className="font-body text-[11px] text-muted-foreground italic">{account.attribution_notes}</p>
            </div>
          )}
          {industryInfo && currentRoas != null && (
            <div>
              <p className="font-label text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Industry Benchmark</p>
              <p className="font-body text-[12px] text-foreground">
                {industryInfo.label} average: <strong>{industryInfo.avgRoas}</strong> ({clickLabel}).{" "}
                You're at <strong>{currentRoas.toFixed(1)}x</strong>.
              </p>
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
