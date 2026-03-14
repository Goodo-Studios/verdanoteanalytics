import { useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { GoalsBar } from "@/components/GoalsBar";
import { SpendPacingWidget } from "@/components/overview/SpendPacingWidget";
import { useMtdSpend } from "@/hooks/useMtdSpend";
import { MetricCard } from "@/components/MetricCard";

import { Button } from "@/components/ui/button";
import { useOverviewPageState } from "@/hooks/useOverviewPageState";
import { useSync } from "@/hooks/useSyncApi";
import { useAuth } from "@/contexts/AuthContext";
import { useWoWTrends } from "@/hooks/useWoWTrends";
import { useDashboardLayout, type DashboardSection, type SectionSize } from "@/hooks/useDashboardLayout";
import { EditableSectionWrapper } from "@/components/overview/EditableSectionWrapper";
import { AddSectionPanel } from "@/components/overview/AddSectionPanel";
import { TopCreativesSection } from "@/components/overview/TopCreativesSection";
import { TrendChartSection } from "@/components/overview/TrendChartSection";
import { CreativeDetailModal } from "@/components/CreativeDetailModal";

import { TagPerformanceSection } from "@/components/overview/TagPerformanceSection";
import { QuickActionsSection } from "@/components/overview/QuickActionsSection";

import { RecentChangesSection } from "@/components/overview/RecentChangesSection";
import { computeFatigueMap } from "@/lib/fatigueScore";
import { InsightCardsStrip } from "@/components/overview/InsightCardsStrip";
import { useRoleNavigate } from "@/hooks/useRolePath";
import {
  TrendingUp, Eye, XCircle, ArrowRight, RefreshCw,
  Pencil, RotateCcw, Check, Plus,
} from "lucide-react";
import { MetricCardSkeletonRow } from "@/components/skeletons/MetricCardSkeleton";
import { DIAGNOSTIC_META } from "@/lib/iterationDiagnostics";

import { cn } from "@/lib/utils";
import { fmt$, fmtN, fmtPct, delta, deltaInverse } from "@/lib/formatters";

/** Map section size to grid column span class */
function sizeClass(size: SectionSize) {
  switch (size) {
    case "sm": return "md:col-span-3";
    case "md": return "md:col-span-6";
    case "lg": return "md:col-span-12";
  }
}

const OverviewPage = () => {
  const navigate = useRoleNavigate();
  const sync = useSync();
  const { isBuilder, isEmployee } = useAuth();
  const canEdit = isBuilder || isEmployee;
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

  const {
    sections, editing, setEditing, addPanelOpen, setAddPanelOpen,
    toggleVisibility, moveSection, resizeSection, addSection, removeSection, resetLayout, visibleSections, availableSections,
  } = useDashboardLayout();

  const isSingleAccount = selectedAccountId && selectedAccountId !== "all";
  const [selectedCreative, setSelectedCreative] = useState<any>(null);
  
  const { data: wowTrends } = useWoWTrends(isSingleAccount ? selectedAccountId : undefined);
  const { data: mtdSpend = 0 } = useMtdSpend(isSingleAccount ? selectedAccountId : undefined);

  const fatigueMap = useMemo(
    () => (!isLoading && creatives.length > 0 ? computeFatigueMap(creatives, wowTrends) : undefined),
    [creatives, wowTrends, isLoading]
  );

  const subtitle = [
    dateFrom && dateTo ? `${dateFrom} → ${dateTo}` : "All time",
    lastSyncedAgo ? `Synced ${lastSyncedAgo}` : null,
    `${fmtN(creatives.length)} creatives`,
  ].filter(Boolean).join(" · ");

  const renderSection = (sectionId: string) => {
    switch (sectionId) {
      case "metrics":
        return isLoading ? <MetricCardSkeletonRow /> : (
          <>
            <div className="grid grid-cols-2 gap-px bg-border-light sm:grid-cols-3 md:flex md:items-stretch md:divide-x md:divide-border-light md:gap-0 md:bg-transparent">
              <MetricCard label="Total Spend" value={fmt$(metrics.totalSpend)} trend={hasPrevPeriod ? delta(metrics.totalSpend, prevMetrics?.totalSpend) : undefined} className="bg-background flex-1" />
              <MetricCard label="Active Creatives" value={fmtN(metrics.activeCount)} trend={hasPrevPeriod ? delta(metrics.activeCount, prevMetrics?.activeCount) : undefined} className="bg-background flex-1" />
              <MetricCard label="Avg CPA" value={fmt$(metrics.avgCpa)} trend={hasPrevPeriod ? deltaInverse(metrics.avgCpa, prevMetrics?.avgCpa) : undefined} className="bg-background flex-1" />
              <MetricCard label="Avg ROAS" value={`${metrics.avgRoas.toFixed(2)}x`} trend={hasPrevPeriod ? delta(metrics.avgRoas, prevMetrics?.avgRoas) : undefined} className="bg-background flex-1" />
              <MetricCard label="Win Rate" value={fmtPct(metrics.winRate)} className="bg-background flex-1" />
              <MetricCard label="Blended CTR" value={fmtPct(metrics.avgCtr)} trend={hasPrevPeriod ? delta(metrics.avgCtr, prevMetrics?.avgCtr) : undefined} className="bg-background flex-1" />
            </div>
            {canEdit && creatives.length > 0 && (
              <div className="mt-6">
                <InsightCardsStrip
                  creatives={creatives}
                  metrics={metrics}
                  prevMetrics={hasPrevPeriod ? prevMetrics : null}
                  fatigueMap={fatigueMap}
                  wowTrends={wowTrends}
                  scaleThreshold={killScaleConfig.scaleAt}
                  spendThreshold={spendThreshold}
                  onCreativeClick={setSelectedCreative}
                />
              </div>
            )}
          </>
        );
      case "goals":
        return !isLoading && selectedAccount ? (
          <div className="space-y-4">
            <GoalsBar account={selectedAccount} metrics={metrics} />
            <SpendPacingWidget account={selectedAccount} mtdSpend={mtdSpend} />
          </div>
        ) : null;
      case "insights":
        return !isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-card border border-border-light rounded-[8px] p-5">
              <h2 className="font-heading text-[18px] text-forest mb-4">Top Performer</h2>
              {topPerformer ? <CreativeInsightCard creative={topPerformer} variant="top" spendThreshold={spendThreshold} onClick={() => setSelectedCreative(topPerformer)} /> : <p className="font-body text-[13px] text-sage">No qualifying creatives found.</p>}
            </div>
            <div className="bg-card border border-border-light rounded-[8px] p-5">
              <h2 className="font-heading text-[18px] text-forest mb-4">Biggest Concern</h2>
              {biggestConcern ? <CreativeInsightCard creative={biggestConcern} variant="concern" spendThreshold={spendThreshold} onClick={() => setSelectedCreative(biggestConcern)} /> : <p className="font-body text-[13px] text-sage">No underperforming creatives — all ROAS ≥ 1.0.</p>}
            </div>
          </div>
        ) : null;
      case "killscale":
        return !isLoading && canEdit ? (
          <RecommendedActionsSection
            creatives={creatives}
            wowTrends={wowTrends}
            fatigueMap={fatigueMap}
            killThreshold={killScaleConfig.killAt}
          />
        ) : null;
      case "activity":
        return !isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-card border border-border-light rounded-[8px] p-5">
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
                  <button onClick={() => navigate("/analytics?tab=iterations")} className="font-body text-[13px] font-medium text-verdant hover:underline flex items-center gap-1 mt-1">
                    View all <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
            <div className="bg-card border border-border-light rounded-[8px] p-5">
              <h2 className="font-heading text-[18px] text-forest mb-4">Tagging Progress</h2>
              <div className="space-y-3">
                <div className="h-2 rounded-full bg-cream-dark overflow-hidden">
                  <div className="h-full bg-verdant rounded-full transition-progress" style={{ width: `${taggingProgress.pct}%` }} />
                </div>
                <p className="font-data text-[17px] text-charcoal tabular-nums">{fmtN(taggingProgress.tagged)} tagged · {fmtN(taggingProgress.untagged)} untagged</p>
                <button onClick={() => navigate("/tagging")} className="font-body text-[13px] font-medium text-verdant hover:underline flex items-center gap-1">
                  Start tagging <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        ) : null;
      case "topCreatives":
        return !isLoading ? <TopCreativesSection creatives={creatives} onCreativeClick={setSelectedCreative} /> : null;
      case "trendChart":
        return <TrendChartSection accountId={isSingleAccount ? selectedAccountId : undefined} />;
      case "recentTests":
        return null;
      case "tagPerformance":
        return !isLoading ? <TagPerformanceSection creatives={creatives} /> : null;
      case "recentChanges":
        return <RecentChangesSection />;
      case "quickActions":
        return <QuickActionsSection accountId={isSingleAccount ? selectedAccountId : undefined} />;
      default:
        return null;
    }
  };

  const displaySections = editing ? sections : visibleSections;

  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-heading text-[24px] sm:text-[32px] text-forest">{accountName}</h1>
              {canEdit && (
                <Button variant="ghost" size="icon" className={cn("h-7 w-7", editing && "bg-verdant/10 text-verdant")} onClick={() => setEditing(!editing)} title={editing ? "Done editing" : "Edit dashboard layout"}>
                  {editing ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                </Button>
              )}
            </div>
            <p className="font-body text-[12px] sm:text-[13px] text-slate font-light mt-1">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} />
              <Button size="sm" className="bg-verdant hover:bg-verdant/90 text-white font-body text-[13px] font-medium" onClick={() => sync.mutate({ account_id: selectedAccountId && selectedAccountId !== "all" ? selectedAccountId : undefined })} disabled={sync.isPending}>
                <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", sync.isPending && "animate-spin")} />
                Sync
              </Button>
            </div>
          </div>
        </div>

        {/* Edit mode banner */}
        {editing && (
          <div className="flex items-center gap-3 p-3 rounded-card border border-verdant/30 bg-verdant/5">
            <Pencil className="h-4 w-4 text-verdant shrink-0" />
            <p className="font-body text-[13px] text-foreground flex-1">
              Reorder, resize (¼ / ½ / full), hide/show, or add new sections.
            </p>
            <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => setAddPanelOpen(!addPanelOpen)}>
              <Plus className="h-3 w-3" />Add Section
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-[11px] text-muted-foreground hover:text-foreground gap-1" onClick={resetLayout}>
              <RotateCcw className="h-3 w-3" />Reset
            </Button>
            <Button size="sm" className="h-7 bg-verdant text-white hover:bg-verdant/90 text-[11px]" onClick={() => setEditing(false)}>
              <Check className="h-3 w-3 mr-1" />Done
            </Button>
          </div>
        )}

        {/* Add Section Panel */}
        {editing && <AddSectionPanel sections={availableSections} onAdd={addSection} open={addPanelOpen} onClose={() => setAddPanelOpen(false)} />}

        {/* Sections with 12-col grid for sizing */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          {displaySections.map((section, index) => {
            const content = renderSection(section.id);
            if (!content && !editing) return null;

            return (
              <div key={section.id} className={sizeClass(section.size)}>
                <EditableSectionWrapper
                  section={section}
                  index={index}
                  total={displaySections.length}
                  editing={editing}
                  onToggle={toggleVisibility}
                  onMove={moveSection}
                  onResize={resizeSection}
                  onRemove={removeSection}
                >
                  {content}
                </EditableSectionWrapper>
              </div>
            );
          })}
        </div>

        {selectedCreative && (
          <CreativeDetailModal
            creative={selectedCreative}
            open={!!selectedCreative}
            onClose={() => setSelectedCreative(null)}
            fatigueMap={fatigueMap}
          />
        )}
      </div>
    </AppLayout>
  );
};

/* ── Sub-components ─────────────────────────────────────────── */

function CreativeInsightCard({ creative, variant, spendThreshold, onClick }: { creative: any; variant: "top" | "concern"; spendThreshold: number; onClick?: () => void }) {
  const roas = Number(creative.roas) || 0;
  const cpa = Number(creative.cpa) || 0;
  const ctr = Number(creative.ctr) || 0;
  const spend = Number(creative.spend) || 0;
  const roasColor = variant === "top" ? "text-verdant" : "text-destructive";
  const tags = [creative.ad_type, creative.hook, creative.person].filter(Boolean);
  const estimatedLoss = variant === "concern" && roas < 1 ? spend * (1 - roas) : 0;

  return (
    <div className={cn("flex gap-4", onClick && "cursor-pointer hover:bg-sage-light/50 -mx-2 px-2 py-1 rounded-[6px] transition-colors")} onClick={onClick}>
      {creative.thumbnail_url && <img src={creative.thumbnail_url} alt="" className="h-20 w-20 rounded-[4px] object-cover flex-shrink-0" />}
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
            {tags.map((tag) => <span key={tag} className="font-label text-[9px] font-medium uppercase tracking-wide bg-sage-light text-forest px-1.5 py-0.5 rounded-[3px]">{tag}</span>)}
          </div>
        )}
        {creative.notes && <p className="font-body text-[12px] text-slate italic truncate">{creative.notes}</p>}
        {variant === "concern" && estimatedLoss > 0 && (
          <p className="font-body text-[12px] text-slate">
            Spending {fmt$(spend)} at {roas.toFixed(1)}x ROAS — losing approximately{" "}
            <span className="font-data text-[17px] font-semibold text-destructive">{fmt$(estimatedLoss)}</span>
          </p>
        )}
      </div>
    </div>
  );
}

function MiniMetric({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <p className="font-label text-[9px] uppercase tracking-[0.06em] text-sage font-medium">{label}</p>
      <p className={cn("font-data text-[17px] font-semibold tabular-nums", valueClass || "text-charcoal")}>{value}</p>
    </div>
  );
}

function ActionCard({ icon, count, countColor, label, subtitle, bgTint, onClick }: {
  icon: React.ReactNode; count: number; countColor: string; label: string; subtitle: string; bgTint: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick} className={cn("border border-border-light rounded-[8px] p-5 text-left transition-hover hover:shadow-card-hover cursor-pointer", bgTint)}>
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
