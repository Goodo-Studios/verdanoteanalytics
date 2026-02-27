import { AppLayout } from "@/components/AppLayout";
import { GoalsBar } from "@/components/GoalsBar";
import { SpendPacingWidget } from "@/components/overview/SpendPacingWidget";
import { useMtdSpend } from "@/hooks/useMtdSpend";
import { useOverviewPageState } from "@/hooks/useOverviewPageState";
import { usePerformanceStory } from "@/hooks/usePerformanceStory";
import { useDailyTrends } from "@/hooks/useDailyTrends";
import { useAuth } from "@/contexts/AuthContext";
import { useClientPreview } from "@/hooks/useClientPreviewMode";
import { MultiLineTrendChart } from "@/components/MultiLineTrendChart";
import { MetricCardSkeletonRow } from "@/components/skeletons/MetricCardSkeleton";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";
import { useState, useCallback, useMemo } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import { ClientInsightsFeed } from "@/components/client/ClientInsightsFeed";
import { GlossaryTooltip } from "@/components/client/GlossaryTooltip";
import { NextStepsPanel } from "@/components/client/NextStepsPanel";
import { DownloadReportButton } from "@/components/client/DownloadReportButton";

// ── Helpers ──

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

function trafficLight(roas: number, scaleAt: number, killAt: number) {
  if (roas >= scaleAt) return { color: "bg-primary", label: "Scaling", labelClass: "bg-muted text-primary" };
  if (roas < killAt) return { color: "bg-destructive", label: "Paused", labelClass: "bg-destructive/10 text-destructive" };
  return { color: "bg-warning", label: "Monitoring", labelClass: "bg-warning/10 text-warning" };
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getFirstName(user: any): string {
  const meta = user?.user_metadata;
  if (meta?.display_name) return meta.display_name.split(" ")[0];
  if (meta?.full_name) return meta.full_name.split(" ")[0];
  if (meta?.name) return meta.name.split(" ")[0];
  const email = user?.email || "";
  return email.split("@")[0] || "there";
}

// ── Component ──

const ClientOverviewPage = () => {
  const { user, isClient } = useAuth();
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
  const { data: mtdSpend = 0 } = useMtdSpend(
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

  // Fatiguing creatives (frequency > 4)
  const fatiguingCreatives = useMemo(() => {
    return creatives
      .filter((c: any) => (Number(c.frequency) || 0) > 4 && (Number(c.spend) || 0) > 200)
      .map((c: any) => c.ad_name)
      .slice(0, 3);
  }, [creatives]);

  // Trend chart data
  const trendLines = useMemo(() => {
    if (!dailyTrends?.length) return { dates: [], lines: [] };
    const dates = dailyTrends.map(d => d.date);
    return {
      dates,
      lines: [
        { key: "spend", label: "Daily Spend", color: "hsl(var(--primary))", prefix: "$", decimals: 0, values: dailyTrends.map(d => d.spend) },
        { key: "roas", label: "ROAS", color: "hsl(var(--warning))", suffix: "x", decimals: 2, values: dailyTrends.map(d => d.roas) },
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

  const todayFormatted = format(new Date(), "EEEE, MMMM d, yyyy");

  return (
    <AppLayout>
      <div className="space-y-8">
        {/* 1. WELCOME MESSAGE */}
        <div>
          {isClientView ? (
            <>
              <h1 className="font-heading text-[36px] text-foreground">
                {getGreeting()}, {getFirstName(user)}
              </h1>
              <p className="font-body text-[14px] text-muted-foreground font-light mt-1">
                Here's how your creative is performing.
              </p>
              <p className="font-body text-[13px] text-secondary-foreground/60 mt-0.5">
                {todayFormatted} · {accountName}
              </p>
            </>
          ) : (
            <>
              <h1 className="font-heading text-[36px] text-foreground">{accountName}</h1>
              <p className="font-body text-[14px] text-muted-foreground font-light mt-1">Creative performance summary</p>
              <p className="font-body text-[13px] text-secondary-foreground/60 mt-0.5">
                Last 14 days · Updated {lastSyncDate}
              </p>
            </>
          )}

          {/* 4. DOWNLOAD REPORT — client only */}
          {isClientView && !isLoading && (
            <div className="mt-3">
              <DownloadReportButton
                accountName={accountName}
                metrics={metrics}
                topPerformers={topPerformers}
                storyContent={story?.content}
              />
            </div>
          )}
        </div>

        {/* Hero Metrics with 3. GLOSSARY TOOLTIPS */}
        {isLoading ? (
          <MetricCardSkeletonRow />
        ) : (
          <div className="flex items-stretch divide-x divide-input">
            <HeroMetric
              label="Total Spend"
              value={fmt$(metrics.totalSpend)}
              delta={hasPrevPeriod ? delta(metrics.totalSpend, prevMetrics?.totalSpend) : undefined}
              showGlossary={isClientView}
            />
            <HeroMetric
              label="ROAS"
              value={`${metrics.avgRoas.toFixed(2)}x`}
              delta={hasPrevPeriod ? delta(metrics.avgRoas, prevMetrics?.avgRoas) : undefined}
              showGlossary={isClientView}
              glossaryValue={metrics.avgRoas}
            />
            <HeroMetric
              label="CPA"
              value={fmt$(metrics.avgCpa)}
              delta={hasPrevPeriod ? deltaInverse(metrics.avgCpa, prevMetrics?.avgCpa) : undefined}
              showGlossary={isClientView}
            />
            <HeroMetric
              label="Total Purchases"
              value={fmtN(totalPurchases)}
              showGlossary={isClientView}
            />
          </div>
        )}

        {/* Goals Bar & Pacing */}
        {!isLoading && selectedAccount && (
          <div className="space-y-4">
            <GoalsBar account={selectedAccount} metrics={metrics} />
            <SpendPacingWidget account={selectedAccount} mtdSpend={mtdSpend} />
          </div>
        )}

        {/* 2. INSIGHTS FEED — client only */}
        {isClientView && selectedAccountId && selectedAccountId !== "all" && !isLoading && (
          <ClientInsightsFeed accountId={selectedAccountId} />
        )}

        {/* Performance Story */}
        {selectedAccountId && selectedAccountId !== "all" && (
          <div className="glass-panel p-7">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-heading text-[22px] text-foreground">This Period's Highlights</h2>
              {!isClientView && !editing && (
                <Button size="sm" variant="outline" onClick={startEdit} className="gap-1.5 font-body text-[12px]">
                  <Pencil className="h-3 w-3" /> Edit
                </Button>
              )}
            </div>
            {editing ? (
              <div className="space-y-3">
                <textarea
                  className="w-full min-h-[120px] font-body text-[15px] text-foreground leading-[1.7] border border-input rounded-[6px] p-4 focus:border-primary focus:outline-none resize-y"
                  value={storyText}
                  onChange={(e) => setStoryText(e.target.value)}
                  placeholder="Write a summary of this period's creative performance for your client..."
                  autoFocus
                />
                <div className="flex items-center gap-2">
                  <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 font-body text-[12px]" onClick={saveStory} disabled={upsert.isPending}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)} className="font-body text-[12px]">Cancel</Button>
                </div>
              </div>
            ) : story?.content ? (
              <div>
                <div className="font-body text-[15px] text-foreground leading-[1.7] prose prose-sm max-w-none">
                  <ReactMarkdown>{story.content}</ReactMarkdown>
                </div>
                {!isClientView && story?.updated_at && (
                  <p className="font-body text-[11px] text-muted-foreground mt-3">
                    Last updated {formatDistanceToNow(new Date(story.updated_at), { addSuffix: true })}
                  </p>
                )}
              </div>
            ) : (
              <p className="font-body text-[14px] text-muted-foreground italic">
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
            <h2 className="font-heading text-[20px] text-foreground mb-4">What's Working</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {topPerformers.map((c: any) => {
                const roas = Number(c.roas) || 0;
                const cpa = Number(c.cpa) || 0;
                const tl = trafficLight(roas, killScaleConfig.scaleAt, killScaleConfig.killAt);
                return (
                  <div key={c.ad_id} className="glass-panel shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-hover)] transition-[box-shadow] duration-150">
                    <div className="relative">
                      {c.thumbnail_url ? (
                        <img src={c.thumbnail_url} alt="" className="w-full aspect-video object-cover rounded-t-[6px]" />
                      ) : (
                        <div className="w-full aspect-video bg-muted rounded-t-[6px] flex items-center justify-center">
                          <span className="font-body text-[12px] text-muted-foreground">No preview</span>
                        </div>
                      )}
                      <div className={cn("absolute top-2 right-2 h-3 w-3 rounded-full shadow-sm", tl.color)} />
                    </div>
                    <div className="p-3.5">
                      <p className="font-body text-[13px] font-semibold text-foreground truncate mb-2">{c.ad_name}</p>
                      <div className="flex items-center gap-4">
                        <div>
                          <p className="font-label text-[9px] uppercase text-muted-foreground">ROAS</p>
                          <p className="font-data text-[20px] font-semibold text-primary tabular-nums">{roas.toFixed(2)}x</p>
                        </div>
                        <div>
                          <p className="font-label text-[9px] uppercase text-muted-foreground">CPA</p>
                          <p className="font-data text-[16px] font-medium text-foreground tabular-nums">{fmt$(cpa)}</p>
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

        {/* 5. NEXT STEPS — client only */}
        {isClientView && !isLoading && (
          <NextStepsPanel
            winRate={winRate}
            targetRoas={selectedAccount?.target_roas ? Number(selectedAccount.target_roas) : undefined}
            avgRoas={metrics.avgRoas}
            fatiguingCreatives={fatiguingCreatives}
          />
        )}

        {/* Trend Chart */}
        {!isLoading && trendLines.dates.length > 0 && (
          <div>
            <h2 className="font-heading text-[20px] text-foreground mb-4">Spend & ROAS Trend</h2>
            <div className="glass-panel p-6">
              <MultiLineTrendChart dates={trendLines.dates} lines={trendLines.lines} height={260} />
            </div>
          </div>
        )}

        {/* Quick Stats Footer */}
        {!isLoading && (
          <div className="pt-2">
            <p className="font-body text-[13px] text-muted-foreground">
              {activeCount} active creatives · {scaledCount} scaled this period · {killedCount} paused this period · Win rate: {winRate.toFixed(1)}%
            </p>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default ClientOverviewPage;

// ── Sub-component: Hero Metric ──

function HeroMetric({
  label,
  value,
  delta: d,
  showGlossary,
  glossaryValue,
}: {
  label: string;
  value: string;
  delta?: { value: number; positive: boolean };
  showGlossary?: boolean;
  glossaryValue?: number;
}) {
  return (
    <div className="flex-1 px-5 py-3">
      <p className="font-label text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
        {label}
        {showGlossary && <GlossaryTooltip metric={label} value={glossaryValue} />}
      </p>
      <p className="font-data text-[36px] font-semibold text-foreground tabular-nums">{value}</p>
      {d && (
        <p className={cn("font-data text-[14px]", d.positive ? "text-primary" : "text-destructive")}>
          {d.positive ? "↑" : "↓"} {d.value}% vs. prior period
        </p>
      )}
    </div>
  );
}
