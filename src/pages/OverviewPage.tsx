import { AppLayout } from "@/components/AppLayout";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { GoalsBar } from "@/components/GoalsBar";
import { MetricCard } from "@/components/MetricCard";
import { AccountHealthScore } from "@/components/AccountHealthScore";
import { Button } from "@/components/ui/button";
import { useOverviewPageState } from "@/hooks/useOverviewPageState";
import { useSync } from "@/hooks/useSyncApi";
import { useAuth } from "@/contexts/AuthContext";
import { useWoWTrends } from "@/hooks/useWoWTrends";
import { useNavigate } from "react-router-dom";
import { TrendingUp, Eye, XCircle, ArrowRight, RefreshCw } from "lucide-react";
import { MetricCardSkeletonRow } from "@/components/skeletons/MetricCardSkeleton";
import { DIAGNOSTIC_META } from "@/lib/iterationDiagnostics";
import { cn } from "@/lib/utils";

function fmt$(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}
function fmtN(n: number) {
  return n.toLocaleString();
}
function fmtPct(n: number) {
  return `${n.toFixed(1)}%`;
}
function delta(cur: number, prev: number | undefined): { value: number; positive: boolean } | undefined {
  if (prev == null || prev === 0) return undefined;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  return { value: Math.round(Math.abs(pct)), positive: pct >= 0 };
}
function deltaInverse(cur: number, prev: number | undefined): { value: number; positive: boolean } | undefined {
  const d = delta(cur, prev);
  if (!d) return undefined;
  return { ...d, positive: !d.positive }; // lower CPA = positive
}

const OverviewPage = () => {
  const navigate = useNavigate();
  const sync = useSync();
  const { isBuilder, isEmployee } = useAuth();
  const {
    accountName, lastSyncedAgo,
    dateFrom, dateTo, setDateFrom, setDateTo,
    selectedAccountId, selectedAccount,
    creatives, isLoading,
    metrics, prevMetrics, hasPrevPeriod,
    topPerformer, biggestConcern,
    scale, watch, kill, killScaleConfig,
    recentDiagnostics, taggingProgress,
    spendThreshold,
  } = useOverviewPageState();

  const isSingleAccount = selectedAccountId && selectedAccountId !== "all";
  const showHealthScore = isSingleAccount && (isBuilder || isEmployee) && !isLoading && creatives.length > 0;
  const { data: wowTrends } = useWoWTrends(isSingleAccount ? selectedAccountId : undefined);

  const subtitle = [
    dateFrom && dateTo ? `${dateFrom} → ${dateTo}` : "All time",
    lastSyncedAgo ? `Synced ${lastSyncedAgo}` : null,
    `${fmtN(creatives.length)} creatives`,
  ].filter(Boolean).join(" · ");

  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Section 1: Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-heading text-[32px] text-forest">{accountName}</h1>
            <p className="font-body text-[13px] text-slate font-light mt-1">{subtitle}</p>
          </div>
          <div className="flex items-center gap-4">
            {showHealthScore && (
              <AccountHealthScore
                creatives={creatives}
                metrics={metrics}
                targetRoas={selectedAccount?.target_roas}
                scaleThreshold={killScaleConfig.scaleAt}
                wowTrends={wowTrends}
              />
            )}
            <div className="flex items-center gap-2">
              <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} />
              <Button
                size="sm"
                className="bg-verdant hover:bg-verdant/90 text-white font-body text-[13px] font-medium"
                onClick={() => sync.mutate({ account_id: selectedAccountId && selectedAccountId !== "all" ? selectedAccountId : undefined })}
                disabled={sync.isPending}
              >
                <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", sync.isPending && "animate-spin")} />
                Sync
              </Button>
            </div>
          </div>
        </div>

        {/* Section 2: Metrics Row */}
        {isLoading ? (
          <MetricCardSkeletonRow />
        ) : (
          <div className="flex items-stretch divide-x divide-border-light">
            <MetricCard label="Total Spend" value={fmt$(metrics.totalSpend)} trend={hasPrevPeriod ? delta(metrics.totalSpend, prevMetrics?.totalSpend) : undefined} className="flex-1" />
            <MetricCard label="Active Creatives" value={fmtN(metrics.activeCount)} trend={hasPrevPeriod ? delta(metrics.activeCount, prevMetrics?.activeCount) : undefined} className="flex-1" />
            <MetricCard label="Avg CPA" value={fmt$(metrics.avgCpa)} trend={hasPrevPeriod ? deltaInverse(metrics.avgCpa, prevMetrics?.avgCpa) : undefined} className="flex-1" />
            <MetricCard label="Avg ROAS" value={`${metrics.avgRoas.toFixed(2)}x`} trend={hasPrevPeriod ? delta(metrics.avgRoas, prevMetrics?.avgRoas) : undefined} className="flex-1" />
            <MetricCard label="Win Rate" value={fmtPct(metrics.winRate)} className="flex-1" />
            <MetricCard label="Blended CTR" value={fmtPct(metrics.avgCtr)} trend={hasPrevPeriod ? delta(metrics.avgCtr, prevMetrics?.avgCtr) : undefined} className="flex-1" />
          </div>
        )}

        {/* Goals Bar */}
        {!isLoading && selectedAccount && (
          <GoalsBar account={selectedAccount} metrics={metrics} />
        )}

        {/* Section 3: Insight Cards */}
        {!isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Top Performer */}
            <div className="bg-white border border-border-light rounded-[8px] p-5">
              <h2 className="font-heading text-[18px] text-forest mb-4">Top Performer</h2>
              {topPerformer ? (
                <CreativeInsightCard creative={topPerformer} variant="top" spendThreshold={spendThreshold} />
              ) : (
                <p className="font-body text-[13px] text-sage">No qualifying creatives found.</p>
              )}
            </div>
            {/* Biggest Concern */}
            <div className="bg-white border border-border-light rounded-[8px] p-5">
              <h2 className="font-heading text-[18px] text-forest mb-4">Biggest Concern</h2>
              {biggestConcern ? (
                <CreativeInsightCard creative={biggestConcern} variant="concern" spendThreshold={spendThreshold} />
              ) : (
                <p className="font-body text-[13px] text-sage">No underperforming creatives — all ROAS ≥ 1.0.</p>
              )}
            </div>
          </div>
        )}

        {/* Section 4: Scale / Watch / Kill */}
        {!isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ActionCard
              icon={<TrendingUp className="h-5 w-5 text-verdant" />}
              count={scale.length}
              countColor="text-verdant"
              label="SCALE CANDIDATES"
              subtitle={`ROAS ≥ ${killScaleConfig.scaleAt} · Increase spend`}
              bgTint="bg-sage-light/30"
              onClick={() => navigate("/analytics?tab=scale")}
            />
            <ActionCard
              icon={<Eye className="h-5 w-5 text-gold" />}
              count={watch.length}
              countColor="text-gold"
              label="WATCH"
              subtitle="Between thresholds · Monitor closely"
              bgTint="bg-gold-light/30"
              onClick={() => navigate("/analytics?tab=winrate")}
            />
            <ActionCard
              icon={<XCircle className="h-5 w-5 text-red-700" />}
              count={kill.length}
              countColor="text-red-700"
              label="KILL CANDIDATES"
              subtitle={`ROAS < ${killScaleConfig.killAt} · Turn off`}
              bgTint="bg-red-50/30"
              onClick={() => navigate("/analytics?tab=kill")}
            />
          </div>
        )}

        {/* Section 5: Recent Activity */}
        {!isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Recent Iterations */}
            <div className="bg-white border border-border-light rounded-[8px] p-5">
              <h2 className="font-heading text-[18px] text-forest mb-4">Recent Iterations</h2>
              {recentDiagnostics.length === 0 ? (
                <p className="font-body text-[13px] text-sage">No iteration diagnostics yet.</p>
              ) : (
                <div className="space-y-3">
                  {recentDiagnostics.map((d) => {
                    const meta = DIAGNOSTIC_META[d.diagnostic];
                    return (
                      <div key={d.ad_id} className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-body text-[13px] font-medium text-charcoal truncate">{d.ad_name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={cn("font-label text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-[3px]", meta.color)}>{meta.label}</span>
                            <span className="font-body text-[12px] text-slate truncate">{d.recommendation}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <button
                    onClick={() => navigate("/analytics?tab=iterations")}
                    className="font-body text-[13px] font-medium text-verdant hover:underline flex items-center gap-1 mt-1"
                  >
                    View all <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>

            {/* Tagging Progress */}
            <div className="bg-white border border-border-light rounded-[8px] p-5">
              <h2 className="font-heading text-[18px] text-forest mb-4">Tagging Progress</h2>
              <div className="space-y-3">
                <div className="h-2 rounded-full bg-cream-dark overflow-hidden">
                  <div
                    className="h-full bg-verdant rounded-full transition-progress"
                    style={{ width: `${taggingProgress.pct}%` }}
                  />
                </div>
                <p className="font-data text-[13px] text-charcoal tabular-nums">
                  {fmtN(taggingProgress.tagged)} tagged · {fmtN(taggingProgress.untagged)} untagged
                </p>
                <button
                  onClick={() => navigate("/tagging")}
                  className="font-body text-[13px] font-medium text-verdant hover:underline flex items-center gap-1"
                >
                  Start tagging <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

/* ── Sub-components ─────────────────────────────────────────── */

function CreativeInsightCard({ creative, variant, spendThreshold }: { creative: any; variant: "top" | "concern"; spendThreshold: number }) {
  const roas = Number(creative.roas) || 0;
  const cpa = Number(creative.cpa) || 0;
  const ctr = Number(creative.ctr) || 0;
  const spend = Number(creative.spend) || 0;

  const roasColor = variant === "top" ? "text-verdant" : "text-red-700";

  const tags = [creative.ad_type, creative.hook, creative.person].filter(Boolean);
  const estimatedLoss = variant === "concern" && roas < 1 ? spend * (1 - roas) : 0;

  return (
    <div className="flex gap-4">
      {creative.thumbnail_url && (
        <img
          src={creative.thumbnail_url}
          alt=""
          className="h-20 w-20 rounded-[4px] object-cover flex-shrink-0"
        />
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-body text-[14px] font-semibold text-charcoal truncate">{creative.ad_name}</p>

        <div className="flex items-center gap-4">
          <MiniMetric label="ROAS" value={`${roas.toFixed(2)}x`} valueClass={roasColor} />
          <MiniMetric label="CTR" value={`${ctr.toFixed(2)}%`} />
          <MiniMetric label="CPA" value={fmt$(cpa)} />
          <MiniMetric label="Spend" value={fmt$(spend)} />
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span key={tag} className="font-label text-[9px] font-medium uppercase tracking-wide bg-sage-light text-forest px-1.5 py-0.5 rounded-[3px]">{tag}</span>
            ))}
          </div>
        )}

        {creative.notes && (
          <p className="font-body text-[12px] text-slate italic truncate">{creative.notes}</p>
        )}

        {variant === "concern" && estimatedLoss > 0 && (
          <div className="space-y-0.5">
            <p className="font-body text-[12px] text-slate">
              Spending {fmt$(spend)} at {roas.toFixed(1)}x ROAS — losing approximately{" "}
              <span className="font-data text-[14px] font-semibold text-red-700">{fmt$(estimatedLoss)}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function MiniMetric({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <p className="font-label text-[9px] uppercase tracking-[0.06em] text-sage font-medium">{label}</p>
      <p className={cn("font-data text-[14px] font-semibold tabular-nums", valueClass || "text-charcoal")}>{value}</p>
    </div>
  );
}

function ActionCard({ icon, count, countColor, label, subtitle, bgTint, onClick }: {
  icon: React.ReactNode;
  count: number;
  countColor: string;
  label: string;
  subtitle: string;
  bgTint: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "border border-border-light rounded-[8px] p-5 text-left transition-hover hover:shadow-card-hover cursor-pointer",
        bgTint
      )}
    >
      <div className="flex items-center gap-3 mb-2">
        {icon}
        <span className={cn("font-data text-[28px] font-semibold tabular-nums", countColor)}>{count}</span>
      </div>
      <p className="font-label text-[10px] uppercase tracking-[0.06em] text-sage font-medium">{label}</p>
      <p className="font-body text-[12px] text-slate mt-0.5">{subtitle}</p>
    </button>
  );
}

export default OverviewPage;
