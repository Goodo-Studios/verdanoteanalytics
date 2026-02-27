import { AppLayout } from "@/components/AppLayout";
import { GoalsBar } from "@/components/GoalsBar";
import { useOverviewPageState } from "@/hooks/useOverviewPageState";
import { usePerformanceStory } from "@/hooks/usePerformanceStory";
import { useDailyTrends } from "@/hooks/useDailyTrends";
import { useAuth } from "@/contexts/AuthContext";
import { useClientPreview } from "@/hooks/useClientPreviewMode";
import { MetricCard } from "@/components/MetricCard";
import { MultiLineTrendChart } from "@/components/MultiLineTrendChart";
import { MetricCardSkeletonRow } from "@/components/skeletons/MetricCardSkeleton";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";
import { useState, useCallback, useMemo } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";

function fmt$(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}
function fmtN(n: number) { return n.toLocaleString(); }

function delta(cur: number, prev: number | undefined): { value: number; positive: boolean } | undefined {
  if (prev == null || prev === 0) return undefined;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  return { value: Math.round(Math.abs(pct)), positive: pct >= 0 };
}
function deltaInverse(cur: number, prev: number | undefined) {
  const d = delta(cur, prev);
  if (!d) return undefined;
  return { ...d, positive: !d.positive };
}

function roasColor(roas: number) {
  if (roas >= 2) return "text-verdant";
  if (roas < 1) return "text-red-700";
  return "text-charcoal";
}

function trafficLight(roas: number, scaleAt: number, killAt: number) {
  if (roas >= scaleAt) return { color: "bg-verdant", label: "Scaling", labelClass: "bg-sage-light text-verdant" };
  if (roas < killAt) return { color: "bg-red-500", label: "Paused", labelClass: "bg-red-50 text-red-700" };
  return { color: "bg-gold", label: "Monitoring", labelClass: "bg-gold-light text-[#92730F]" };
}

const ClientOverviewPage = () => {
  const { isClient } = useAuth();
  const { isClientPreview } = useClientPreview();
  const isClientView = isClient || isClientPreview;

  const {
    accountName, lastSyncedAgo,
    selectedAccountId, selectedAccount,
    creatives, isLoading,
    metrics, prevMetrics, hasPrevPeriod,
    scale, watch, kill, killScaleConfig,
    spendThreshold,
  } = useOverviewPageState();

  const { story, upsert } = usePerformanceStory(
    selectedAccountId && selectedAccountId !== "all" ? selectedAccountId : undefined
  );
  const { data: dailyTrends } = useDailyTrends(
    selectedAccountId && selectedAccountId !== "all" ? selectedAccountId : undefined
  );

  const [editing, setEditing] = useState(false);
  const [storyText, setStoryText] = useState("");

  const startEdit = useCallback(() => {
    setStoryText(story?.content || "");
    setEditing(true);
  }, [story]);

  const saveStory = useCallback(() => {
    if (selectedAccountId && selectedAccountId !== "all") {
      upsert.mutate({ accountId: selectedAccountId, content: storyText });
    }
    setEditing(false);
  }, [selectedAccountId, storyText, upsert]);

  // Top 3 performers
  const topPerformers = useMemo(() => {
    return creatives
      .filter((c: any) => (Number(c.spend) || 0) >= spendThreshold && (Number(c.roas) || 0) > 0)
      .sort((a: any, b: any) => (Number(b.roas) || 0) - (Number(a.roas) || 0))
      .slice(0, 3);
  }, [creatives, spendThreshold]);

  // Trend chart data
  const trendLines = useMemo(() => {
    if (!dailyTrends?.length) return { dates: [], lines: [] };
    const dates = dailyTrends.map(d => d.date);
    return {
      dates,
      lines: [
        { key: "spend", label: "Daily Spend", color: "#1B7A4E", prefix: "$", decimals: 0, values: dailyTrends.map(d => d.spend) },
        { key: "roas", label: "ROAS", color: "#D4A843", suffix: "x", decimals: 2, values: dailyTrends.map(d => d.roas) },
      ],
    };
  }, [dailyTrends]);

  // Quick stats
  const totalPurchases = useMemo(() => {
    return creatives.reduce((s: number, c: any) => s + (Number(c.purchases) || 0), 0);
  }, [creatives]);

  const scaledCount = scale.length;
  const killedCount = kill.length;
  const activeCount = creatives.filter((c: any) => (Number(c.spend) || 0) > 0).length;
  const winRate = metrics.winRate;

  const lastSyncDate = selectedAccount?.last_synced_at
    ? format(new Date(selectedAccount.last_synced_at), "MMM d, yyyy")
    : "Unknown";

  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="font-heading text-[36px] text-forest">{accountName}</h1>
          <p className="font-body text-[14px] text-slate font-light mt-1">Creative performance summary</p>
          <p className="font-body text-[13px] text-sage mt-0.5">
            Last 14 days · Updated {lastSyncDate}
          </p>
        </div>

        {/* Hero Metrics */}
        {isLoading ? (
          <MetricCardSkeletonRow />
        ) : (
          <div className="flex items-stretch divide-x divide-border-light">
            <div className="flex-1 px-5 py-3">
              <p className="font-label text-[10px] uppercase tracking-wide text-sage font-medium">Total Spend</p>
              <p className="font-data text-[36px] font-semibold text-charcoal tabular-nums">{fmt$(metrics.totalSpend)}</p>
              {hasPrevPeriod && (() => {
                const d = delta(metrics.totalSpend, prevMetrics?.totalSpend);
                return d ? <p className={cn("font-data text-[14px]", d.positive ? "text-verdant" : "text-red-700")}>{d.positive ? "↑" : "↓"} {d.value}% vs. prior period</p> : null;
              })()}
            </div>
            <div className="flex-1 px-5 py-3">
              <p className="font-label text-[10px] uppercase tracking-wide text-sage font-medium">ROAS</p>
              <p className="font-data text-[36px] font-semibold text-charcoal tabular-nums">{metrics.avgRoas.toFixed(2)}x</p>
              {hasPrevPeriod && (() => {
                const d = delta(metrics.avgRoas, prevMetrics?.avgRoas);
                return d ? <p className={cn("font-data text-[14px]", d.positive ? "text-verdant" : "text-red-700")}>{d.positive ? "↑" : "↓"} {d.value}% vs. prior period</p> : null;
              })()}
            </div>
            <div className="flex-1 px-5 py-3">
              <p className="font-label text-[10px] uppercase tracking-wide text-sage font-medium">CPA</p>
              <p className="font-data text-[36px] font-semibold text-charcoal tabular-nums">{fmt$(metrics.avgCpa)}</p>
              {hasPrevPeriod && (() => {
                const d = deltaInverse(metrics.avgCpa, prevMetrics?.avgCpa);
                return d ? <p className={cn("font-data text-[14px]", d.positive ? "text-verdant" : "text-red-700")}>{d.positive ? "↑" : "↓"} {d.value}% vs. prior period</p> : null;
              })()}
            </div>
            <div className="flex-1 px-5 py-3">
              <p className="font-label text-[10px] uppercase tracking-wide text-sage font-medium">Total Purchases</p>
              <p className="font-data text-[36px] font-semibold text-charcoal tabular-nums">{fmtN(totalPurchases)}</p>
            </div>
          </div>
        )}

        {/* Goals Bar */}
        {!isLoading && selectedAccount && (
          <GoalsBar account={selectedAccount} metrics={metrics} />
        )}

        {/* Performance Story */}
        {selectedAccountId && selectedAccountId !== "all" && (
          <div className="bg-white border border-border-light rounded-[8px] p-7">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-heading text-[22px] text-forest">This Period's Highlights</h2>
              {!isClientView && !editing && (
                <Button size="sm" variant="outline" onClick={startEdit} className="gap-1.5 font-body text-[12px]">
                  <Pencil className="h-3 w-3" /> Edit
                </Button>
              )}
            </div>
            {editing ? (
              <div className="space-y-3">
                <textarea
                  className="w-full min-h-[120px] font-body text-[15px] text-charcoal leading-[1.7] border border-border-light rounded-[6px] p-4 focus:border-verdant focus:outline-none resize-y"
                  value={storyText}
                  onChange={(e) => setStoryText(e.target.value)}
                  placeholder="Write a summary of this period's creative performance for your client..."
                  autoFocus
                />
                <div className="flex items-center gap-2">
                  <Button size="sm" className="bg-verdant text-white hover:bg-verdant/90 font-body text-[12px]" onClick={saveStory} disabled={upsert.isPending}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)} className="font-body text-[12px]">Cancel</Button>
                </div>
              </div>
            ) : story?.content ? (
              <div>
                <div className="font-body text-[15px] text-charcoal leading-[1.7] prose prose-sm max-w-none">
                  <ReactMarkdown>{story.content}</ReactMarkdown>
                </div>
                {!isClientView && story?.updated_at && (
                  <p className="font-body text-[11px] text-sage mt-3">
                    Last updated {formatDistanceToNow(new Date(story.updated_at), { addSuffix: true })}
                  </p>
                )}
              </div>
            ) : (
              <p className="font-body text-[14px] text-sage italic">
                {isClientView
                  ? "Your team hasn't added notes for this period yet."
                  : "No story written yet. Click Edit to write a summary for your client."}
              </p>
            )}
          </div>
        )}

        {/* Top Performers */}
        {!isLoading && topPerformers.length > 0 && (
          <div>
            <h2 className="font-heading text-[20px] text-forest mb-4">What's Working</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {topPerformers.map((c: any) => {
                const roas = Number(c.roas) || 0;
                const cpa = Number(c.cpa) || 0;
                const tl = trafficLight(roas, killScaleConfig.scaleAt, killScaleConfig.killAt);
                return (
                  <div key={c.ad_id} className="bg-white border border-border-light rounded-[8px] shadow-card hover:shadow-card-hover transition-[box-shadow] duration-150">
                    <div className="relative">
                      {c.thumbnail_url ? (
                        <img src={c.thumbnail_url} alt="" className="w-full aspect-video object-cover rounded-t-[6px]" />
                      ) : (
                        <div className="w-full aspect-video bg-cream-dark rounded-t-[6px] flex items-center justify-center">
                          <span className="font-body text-[12px] text-sage">No preview</span>
                        </div>
                      )}
                      {/* Traffic light */}
                      <div className={cn("absolute top-2 right-2 h-3 w-3 rounded-full shadow-sm", tl.color)} />
                    </div>
                    <div className="p-3.5">
                      <p className="font-body text-[13px] font-semibold text-charcoal truncate mb-2">{c.ad_name}</p>
                      <div className="flex items-center gap-4">
                        <div>
                          <p className="font-label text-[9px] uppercase text-sage">ROAS</p>
                          <p className="font-data text-[20px] font-semibold text-verdant tabular-nums">{roas.toFixed(2)}x</p>
                        </div>
                        <div>
                          <p className="font-label text-[9px] uppercase text-sage">CPA</p>
                          <p className="font-data text-[16px] font-medium text-charcoal tabular-nums">{fmt$(cpa)}</p>
                        </div>
                      </div>
                      <span className={cn("inline-block mt-2 font-label text-[9px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-[3px]", tl.labelClass)}>
                        {tl.label} ↑
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Trend Chart */}
        {!isLoading && trendLines.dates.length > 0 && (
          <div>
            <h2 className="font-heading text-[20px] text-forest mb-4">Spend & ROAS Trend</h2>
            <div className="bg-white border border-border-light rounded-[8px] p-6">
              <MultiLineTrendChart dates={trendLines.dates} lines={trendLines.lines} height={260} />
            </div>
          </div>
        )}

        {/* Quick Stats Footer */}
        {!isLoading && (
          <div className="pt-2">
            <p className="font-body text-[13px] text-sage">
              {activeCount} active creatives · {scaledCount} scaled this period · {killedCount} paused this period · Win rate: {winRate.toFixed(1)}%
            </p>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default ClientOverviewPage;
