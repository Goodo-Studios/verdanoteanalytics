import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Wand2, Loader2 } from "lucide-react";

interface TaggingProgressBarProps {
  creatives: any[];
  total: number;
  onAutoTagAll: () => void;
  isAutoTagging: boolean;
}

export function TaggingProgressBar({ creatives, total, onAutoTagAll, isAutoTagging }: TaggingProgressBarProps) {
  const stats = useMemo(() => {
    let manual = 0, auto = 0, untagged = 0;
    for (const c of creatives) {
      const src = c.tag_source || "untagged";
      if (src === "manual") manual++;
      else if (src === "untagged") untagged++;
      else auto++;
    }
    const tagged = manual + auto;
    const pct = total > 0 ? tagged / total : 0;
    return { manual, auto, untagged, tagged, pct };
  }, [creatives, total]);

  return (
    <div className="border border-border rounded-lg p-4 bg-card space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-data text-[17px] font-semibold tabular-nums text-foreground">
            {stats.tagged} / {total}
          </span>
          <span className="font-body text-[13px] text-muted-foreground">creatives tagged</span>
          <span className="font-data text-[17px] font-medium tabular-nums text-primary">
            ({(stats.pct * 100).toFixed(0)}%)
          </span>
        </div>
        {stats.untagged > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 font-body text-[12px]"
            onClick={onAutoTagAll}
            disabled={isAutoTagging}
          >
            {isAutoTagging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            Tag {stats.untagged} remaining with AI
          </Button>
        )}
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden flex">
        {stats.manual > 0 && (
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${(stats.manual / total) * 100}%` }}
          />
        )}
        {stats.auto > 0 && (
          <div
            className="h-full bg-primary/40 transition-all"
            style={{ width: `${(stats.auto / total) * 100}%` }}
          />
        )}
      </div>
      <div className="flex items-center gap-4 font-body text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary" /> Manual ({stats.manual})</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary/40" /> Auto ({stats.auto})</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-muted" /> Untagged ({stats.untagged})</span>
      </div>
    </div>
  );
}
