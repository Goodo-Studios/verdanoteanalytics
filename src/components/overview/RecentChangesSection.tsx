import { useChangelog, type ChangelogEntry } from "@/hooks/useChangelogApi";
import { useAccountContext } from "@/contexts/AccountContext";
import {
  GitCommitHorizontal, TrendingUp, TrendingDown, AlertTriangle, Info,
  Zap, PauseCircle, TestTube, MessageSquare, Loader2, ArrowRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, parseISO } from "date-fns";
import { useNavigate } from "react-router-dom";

const EVENT_ICON: Record<string, typeof Info> = {
  roas_change: TrendingUp,
  spend_change: TrendingDown,
  status_change: AlertTriangle,
  new_creative: Zap,
  creative_paused: PauseCircle,
  threshold_crossed: TrendingUp,
  test_result: TestTube,
  note_added: MessageSquare,
};

const EVENT_COLOR: Record<string, string> = {
  roas_change: "text-verdant",
  spend_change: "text-amber-600",
  status_change: "text-destructive",
  new_creative: "text-primary",
  creative_paused: "text-muted-foreground",
  threshold_crossed: "text-verdant",
  test_result: "text-primary",
  note_added: "text-muted-foreground",
};

export function RecentChangesSection() {
  const { selectedAccountId } = useAccountContext();
  const navigate = useNavigate();
  const { data: entries = [], isLoading } = useChangelog(
    selectedAccountId && selectedAccountId !== "all" ? selectedAccountId : undefined
  );

  if (isLoading) {
    return (
      <div className="bg-white border border-border-light rounded-[8px] p-5">
        <h2 className="font-heading text-[18px] text-forest mb-4 flex items-center gap-2">
          <GitCommitHorizontal className="h-4 w-4 text-verdant" /> Recent Changes
        </h2>
        <div className="flex justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  const recent = entries.slice(0, 10);

  return (
    <div className="bg-white border border-border-light rounded-[8px] p-5">
      <h2 className="font-heading text-[18px] text-forest mb-4 flex items-center gap-2">
        <GitCommitHorizontal className="h-4 w-4 text-verdant" /> Recent Changes
      </h2>
      {recent.length === 0 ? (
        <p className="font-body text-[13px] text-sage">No performance changes recorded yet.</p>
      ) : (
        <div className="space-y-3">
          {recent.map((entry) => {
            const Icon = EVENT_ICON[entry.event_type] || Info;
            const color = EVENT_COLOR[entry.event_type] || "text-muted-foreground";
            return (
              <div key={entry.id} className="flex items-start gap-3">
                <Icon className={cn("h-4 w-4 mt-0.5 flex-shrink-0", color)} />
                <div className="min-w-0 flex-1">
                  <p className="font-body text-[13px] font-medium text-charcoal truncate">{entry.description}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {entry.old_value != null && entry.new_value != null && (
                      <span className="font-data text-[11px] tabular-nums text-muted-foreground">
                        {entry.old_value.toFixed(2)} → {entry.new_value.toFixed(2)}
                      </span>
                    )}
                    {entry.created_by === null && (
                      <Badge variant="secondary" className="font-label text-[8px] uppercase tracking-wider h-4 px-1">Auto</Badge>
                    )}
                    <span className="font-body text-[10px] text-sage">
                      {formatDistanceToNow(parseISO(entry.created_at), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          <button onClick={() => navigate("/changelog")} className="font-body text-[13px] font-medium text-verdant hover:underline flex items-center gap-1 mt-1">
            View all <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
