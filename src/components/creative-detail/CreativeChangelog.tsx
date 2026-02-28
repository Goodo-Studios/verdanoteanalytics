import { useChangelog, type ChangelogEntry } from "@/hooks/useChangelogApi";
import { Badge } from "@/components/ui/badge";
import { GitCommitHorizontal, TrendingUp, TrendingDown, AlertTriangle, Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, parseISO } from "date-fns";

const SEVERITY_ICON: Record<string, typeof Info> = {
  positive: TrendingUp,
  negative: TrendingDown,
  critical: AlertTriangle,
  info: Info,
};

const SEVERITY_COLOR: Record<string, string> = {
  positive: "text-verdant",
  negative: "text-destructive",
  critical: "text-destructive",
  info: "text-muted-foreground",
};

export function CreativeChangelog({ adId, accountId }: { adId: string; accountId: string }) {
  const { data: entries = [], isLoading } = useChangelog(accountId, adId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className="font-label text-[11px] font-semibold uppercase tracking-wider text-charcoal flex items-center gap-1.5">
          <GitCommitHorizontal className="h-3.5 w-3.5" /> Performance Changelog
        </h3>
        <p className="font-body text-[12px] text-muted-foreground">No performance changes logged for this creative yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="font-label text-[11px] font-semibold uppercase tracking-wider text-charcoal flex items-center gap-1.5">
        <GitCommitHorizontal className="h-3.5 w-3.5" /> Performance Changelog
      </h3>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {entries.slice(0, 10).map((entry) => {
          const Icon = SEVERITY_ICON[entry.severity] || Info;
          const color = SEVERITY_COLOR[entry.severity] || "text-muted-foreground";
          return (
            <div key={entry.id} className="flex items-start gap-2">
              <Icon className={cn("h-3.5 w-3.5 mt-0.5 flex-shrink-0", color)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-body text-[12px] font-medium text-charcoal">{entry.title}</span>
                  {entry.pct_change != null && (
                    <span className={cn("font-data text-[11px] font-medium tabular-nums", entry.pct_change >= 0 ? "text-verdant" : "text-destructive")}>
                      {entry.pct_change >= 0 ? "+" : ""}{entry.pct_change.toFixed(1)}%
                    </span>
                  )}
                </div>
                {entry.description && (
                  <p className="font-body text-[11px] text-muted-foreground truncate">{entry.description}</p>
                )}
                <span className="font-body text-[10px] text-sage">
                  {formatDistanceToNow(parseISO(entry.created_at), { addSuffix: true })}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
