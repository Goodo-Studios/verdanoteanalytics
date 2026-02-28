import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Clock, AlertTriangle, TrendingUp, Archive, Zap, RefreshCw } from "lucide-react";
import { useAccountContext } from "@/contexts/AccountContext";
import { useAddChangelogEntry } from "@/hooks/useChangelogApi";
import { computeFatigue } from "@/lib/fatigueScore";
import { toast } from "sonner";

interface Props {
  creatives: any[];
  scaleThreshold: number;
  killThreshold: number;
  spendThreshold: number;
  onCreativeClick?: (c: any) => void;
}

interface AgeBucket {
  key: string;
  label: string;
  min: number;
  max: number;
  color: string;
  bgClass: string;
}

const AGE_BUCKETS: AgeBucket[] = [
  { key: "fresh", label: "Fresh", min: 0, max: 14, color: "hsl(var(--success))", bgClass: "bg-success/20 text-success" },
  { key: "active", label: "Active", min: 15, max: 30, color: "hsl(var(--chart-1))", bgClass: "bg-primary/20 text-primary" },
  { key: "mature", label: "Mature", min: 31, max: 60, color: "hsl(var(--warning))", bgClass: "bg-warning/20 text-warning" },
  { key: "aging", label: "Aging", min: 61, max: 90, color: "hsl(var(--chart-4))", bgClass: "bg-destructive/10 text-destructive" },
  { key: "stale", label: "Stale", min: 91, max: Infinity, color: "hsl(var(--destructive))", bgClass: "bg-destructive/20 text-destructive" },
];

function getAgeDays(creative: any): number {
  const created = creative.created_at ? new Date(creative.created_at) : null;
  if (!created || isNaN(created.getTime())) return 0;
  return Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
}

function getBucket(days: number): AgeBucket {
  return AGE_BUCKETS.find((b) => days >= b.min && days <= b.max) || AGE_BUCKETS[AGE_BUCKETS.length - 1];
}

function getRecommendation(
  creative: any,
  ageDays: number,
  fatigueScore: number,
  scaleThreshold: number,
  killThreshold: number
): { text: string; variant: "scale" | "watch" | "kill" | "neutral" } {
  const roas = Number(creative.roas) || 0;
  const hookRate = Number(creative.thumb_stop_rate) || 0;

  if (ageDays >= 91 && roas >= scaleThreshold)
    return { text: "Keep — still performing", variant: "scale" };
  if (ageDays >= 91 && roas < killThreshold)
    return { text: "Retire now", variant: "kill" };
  if (ageDays >= 31 && fatigueScore >= 60)
    return { text: "Prepare replacement", variant: "watch" };
  if (ageDays <= 14 && hookRate >= 25)
    return { text: "Scale — strong early signal", variant: "scale" };
  if (ageDays <= 14)
    return { text: "Monitor early signal", variant: "neutral" };
  return { text: "—", variant: "neutral" };
}

export function AgingTab({ creatives, scaleThreshold, killThreshold, spendThreshold, onCreativeClick }: Props) {
  const { selectedAccountId } = useAccountContext();
  const addChangelog = useAddChangelogEntry();
  const [retiredIds, setRetiredIds] = useState<Set<string>>(new Set());

  const { bucketed, agingList, retirementList, refreshVelocity } = useMemo(() => {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    const withAge = creatives.map((c) => {
      const ageDays = getAgeDays(c);
      const bucket = getBucket(ageDays);
      const fatigue = computeFatigue(c);
      return { ...c, ageDays, bucket, fatigueScore: fatigue.score };
    });

    // Bucket counts
    const bucketCounts = AGE_BUCKETS.map((b) => ({
      ...b,
      count: withAge.filter((c) => c.bucket.key === b.key).length,
    }));
    const total = withAge.length;

    // Aging table sorted by age desc
    const agingList = [...withAge].sort((a, b) => b.ageDays - a.ageDays);

    // Retirement candidates
    const retirementList = withAge.filter((c) => {
      const roas = Number(c.roas) || 0;
      return c.ageDays >= 91 && roas < killThreshold && c.ad_status !== "PAUSED";
    });

    // Refresh velocity
    const newIn30 = creatives.filter((c) => {
      const created = c.created_at ? new Date(c.created_at).getTime() : 0;
      return created >= thirtyDaysAgo;
    }).length;
    const refreshPct = total > 0 ? (newIn30 / total) * 100 : 0;

    return {
      bucketed: bucketCounts,
      agingList,
      retirementList,
      refreshVelocity: { newIn30, refreshPct, total },
    };
  }, [creatives, killThreshold]);

  const handleRetire = (creative: any) => {
    if (!selectedAccountId || selectedAccountId === "all") {
      toast.error("Select a specific account to log retirements");
      return;
    }
    addChangelog.mutate({
      account_id: selectedAccountId,
      ad_id: creative.ad_id,
      event_type: "creative_retired",
      description: `Recommended for retirement: ${creative.ad_name} (${creative.ageDays} days old, ROAS ${(Number(creative.roas) || 0).toFixed(2)}x)`,
      metadata: { age_days: creative.ageDays, roas: creative.roas },
    });
    setRetiredIds((prev) => new Set([...prev, creative.ad_id]));
  };

  if (creatives.length === 0) {
    return (
      <div className="glass-panel p-8 text-center max-w-xl mx-auto">
        <Clock className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-lg font-heading mb-2">No Creatives Found</h3>
        <p className="text-sm text-muted-foreground">Sync your account to see aging data.</p>
      </div>
    );
  }

  const barTotal = creatives.length;

  return (
    <div className="space-y-6">
      {/* Stacked bar chart */}
      <div className="glass-panel p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <h2 className="section-title">Creative Library Age</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {barTotal} creatives bucketed by days since first spend
            </p>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3 mb-4">
          {AGE_BUCKETS.map((b) => (
            <div key={b.key} className="flex items-center gap-1.5 text-xs">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: b.color }} />
              <span className="text-muted-foreground">
                {b.label} ({b.min}–{b.max === Infinity ? "∞" : b.max}d)
              </span>
            </div>
          ))}
        </div>

        {/* Stacked horizontal bar */}
        <div className="h-10 rounded-md overflow-hidden flex" role="img" aria-label="Age distribution bar">
          {bucketed.map((b) =>
            b.count > 0 ? (
              <div
                key={b.key}
                className="h-full flex items-center justify-center text-[11px] font-medium text-white transition-all"
                style={{
                  width: `${(b.count / barTotal) * 100}%`,
                  backgroundColor: b.color,
                  minWidth: b.count > 0 ? "28px" : "0",
                }}
                title={`${b.label}: ${b.count} creatives (${Math.round((b.count / barTotal) * 100)}%)`}
              >
                {b.count}
              </div>
            ) : null
          )}
        </div>

        {/* Summary badges */}
        <div className="flex flex-wrap gap-2 mt-4">
          {bucketed.map((b) => (
            <Badge key={b.key} variant="outline" className={`${b.bgClass} text-xs border-0`}>
              {b.label}: {b.count} ({Math.round((b.count / barTotal) * 100)}%)
            </Badge>
          ))}
        </div>
      </div>

      {/* Aging table */}
      <div className="glass-panel">
        <div className="p-4 border-b border-border">
          <h3 className="card-title">Creative Aging Detail</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Sorted by age (oldest first)</p>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Creative</TableHead>
                <TableHead className="text-right">Age</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead className="text-right">ROAS</TableHead>
                <TableHead className="text-right">Fatigue</TableHead>
                <TableHead>Bucket</TableHead>
                <TableHead>Recommendation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agingList.slice(0, 50).map((c) => {
                const rec = getRecommendation(c, c.ageDays, c.fatigueScore, scaleThreshold, killThreshold);
                const recColors: Record<string, string> = {
                  scale: "text-[hsl(var(--scale))]",
                  watch: "text-[hsl(var(--watch))]",
                  kill: "text-[hsl(var(--kill))]",
                  neutral: "text-muted-foreground",
                };
                return (
                  <TableRow
                    key={c.ad_id}
                    className="cursor-pointer"
                    onClick={() => onCreativeClick?.(c)}
                  >
                    <TableCell className="max-w-[240px] truncate font-medium">{c.ad_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.ageDays}d</TableCell>
                    <TableCell className="text-right tabular-nums">${(Number(c.spend) || 0).toFixed(0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{(Number(c.roas) || 0).toFixed(2)}x</TableCell>
                    <TableCell className="text-right">
                      <span
                        className={`text-xs font-medium ${
                          c.fatigueScore >= 60
                            ? "text-[hsl(var(--kill))]"
                            : c.fatigueScore >= 40
                            ? "text-[hsl(var(--watch))]"
                            : "text-muted-foreground"
                        }`}
                      >
                        {c.fatigueScore}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`${c.bucket.bgClass} text-xs border-0`}>
                        {c.bucket.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs font-medium ${recColors[rec.variant]}`}>{rec.text}</span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {agingList.length > 50 && (
          <div className="p-3 text-center text-xs text-muted-foreground border-t border-border">
            Showing top 50 of {agingList.length} creatives
          </div>
        )}
      </div>

      {/* Refresh Velocity */}
      <div className="glass-panel p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center text-primary">
            <RefreshCw className="h-4 w-4" />
          </div>
          <h3 className="card-title">Refresh Velocity</h3>
        </div>
        <p className="text-sm text-foreground">
          In the last 30 days, <span className="font-semibold">{refreshVelocity.newIn30}</span> new creatives were
          launched. At this pace,{" "}
          <span className="font-semibold">{refreshVelocity.refreshPct.toFixed(1)}%</span> of the library refreshes
          monthly.
        </p>
        <div className="mt-3 flex items-start gap-2 p-3 rounded-md bg-muted/50 border border-border">
          <TrendingUp className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Industry benchmark:</span> High-performance accounts
            refresh 15–20% of their creative library monthly.
          </p>
        </div>
      </div>

      {/* Retirement List */}
      {retirementList.length > 0 && (
        <div className="glass-panel p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-8 w-8 rounded-md bg-destructive/10 flex items-center justify-center text-destructive">
              <Archive className="h-4 w-4" />
            </div>
            <div>
              <h3 className="card-title">Recommended Retirements</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {retirementList.length} stale creative{retirementList.length !== 1 ? "s" : ""} below kill threshold
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {retirementList.map((c) => (
              <div
                key={c.ad_id}
                className="flex items-center justify-between gap-3 p-3 rounded-md bg-muted/30 border border-border"
              >
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-medium truncate cursor-pointer hover:underline"
                    onClick={() => onCreativeClick?.(c)}
                  >
                    {c.ad_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c.ageDays}d old · ${(Number(c.spend) || 0).toFixed(0)} spend · {(Number(c.roas) || 0).toFixed(2)}x ROAS
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 text-destructive border-destructive/30 hover:bg-destructive/10"
                  disabled={retiredIds.has(c.ad_id) || addChangelog.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRetire(c);
                  }}
                >
                  {retiredIds.has(c.ad_id) ? "Logged" : "Retire"}
                </Button>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground mt-3 italic">
            Retiring logs a note in the changelog. Pausing ads is done directly in your ad platform.
          </p>
        </div>
      )}
    </div>
  );
}
