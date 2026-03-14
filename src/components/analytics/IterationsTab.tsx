import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Target, Info, TrendingUp, MousePointerClick, Eye, ChevronDown, ChevronUp, Trophy, Repeat, DollarSign } from "lucide-react";
import {
  calculateBenchmarks,
  diagnoseCreatives,
  DIAGNOSTIC_META,
  type Benchmarks,
  type DiagnosedCreative,
  type DiagnosticType,
} from "@/lib/iterationDiagnostics";

interface IterationsTabProps {
  creatives: any[];
  spendThreshold: number;
  onCreativeClick?: (creative: any) => void;
}


function MetricDot({ level }: { level: "strong" | "average" | "weak" }) {
  const cls =
    level === "strong"
      ? "bg-success"
      : level === "weak"
      ? "bg-destructive"
      : "bg-warning";
  return <span className={`status-dot ${cls} mr-1.5`} />;
}

function BenchmarkBar({ benchmarks }: { benchmarks: Benchmarks }) {
  const [open, setOpen] = useState(true);
  const metrics = [
    { label: "Hook Rate", data: benchmarks.hookRate, icon: Eye },
    { label: "Hold Rate", data: benchmarks.holdRate, icon: TrendingUp },
    { label: "CTR", data: benchmarks.ctr, icon: MousePointerClick },
  ];

  return (
    <div className="glass-panel p-4">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full md:pointer-events-none"
      >
        <div className="flex items-center gap-2">
          <h3 className="font-heading text-[18px] text-forest">Account Benchmarks</h3>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                Benchmarks are calculated from all active ads in this account, weighted by spend. Updated each time you sync.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <span className="md:hidden">
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      <div className={`grid grid-cols-1 md:grid-cols-3 gap-4 mt-3 ${open ? "" : "hidden md:grid"}`}>
        {metrics.map((m) => (
          <div key={m.label} className="flex items-center gap-3">
            <m.icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <div>
              <p className="font-body text-[13px] font-medium text-charcoal">{m.label}: <span className="font-data text-[17px] font-semibold text-charcoal">{m.data.median.toFixed(2)}%</span></p>
              <p className="font-data text-[11px] text-sage">
                25th: {m.data.p25.toFixed(2)}% &nbsp;|&nbsp; 75th: {m.data.p75.toFixed(2)}%
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface TopPerformersProps {
  creatives: any[];
  benchmarks: Benchmarks;
  minSpend: number;
  onCreativeClick?: (creative: any) => void;
}

function TopPerformers({ creatives, benchmarks, minSpend, onCreativeClick }: TopPerformersProps) {
  const tops = useMemo(() => {
    const qualified = creatives.filter((c: any) => (Number(c.spend) || 0) >= minSpend);

    const isImageAd = (c: any) => {
      const adType = (c.ad_type || "").toLowerCase();
      const adName = (c.ad_name || "").toLowerCase();
      return adType === "image" || adType === "carousel" || adType === "static" ||
        adName.includes("static") ||
        (adType !== "video" && (Number(c.thumb_stop_rate) || 0) === 0 && (Number(c.hold_rate) || 0) === 0);
    };

    const videoOnly = qualified.filter((c) => !isImageAd(c));

    const byHook = [...videoOnly]
      .filter((c) => (Number(c.thumb_stop_rate) || 0) > 0)
      .sort((a, b) => (Number(b.thumb_stop_rate) || 0) - (Number(a.thumb_stop_rate) || 0))
      .slice(0, 5);

    const byHold = [...videoOnly]
      .filter((c) => (Number(c.hold_rate) || 0) > 0)
      .sort((a, b) => (Number(b.hold_rate) || 0) - (Number(a.hold_rate) || 0))
      .slice(0, 5);

    const byCtr = [...qualified]
      .filter((c) => (Number(c.ctr) || 0) > 0)
      .sort((a, b) => (Number(b.ctr) || 0) - (Number(a.ctr) || 0))
      .slice(0, 5);

    return { byHook, byHold, byCtr };
  }, [creatives, minSpend]);

  const sections = [
    { title: "Best Hook Rates", subtitle: "These hooks stop the scroll — duplicate the opening approach", icon: Eye, items: tops.byHook, metric: "thumb_stop_rate", label: "Hook Rate" },
    { title: "Best Hold Rates", subtitle: "These keep viewers watching — replicate the pacing and structure", icon: TrendingUp, items: tops.byHold, metric: "hold_rate", label: "Hold Rate" },
    { title: "Best CTRs", subtitle: "These drive clicks — reuse the CTA approach and end card style", icon: MousePointerClick, items: tops.byCtr, metric: "ctr", label: "CTR" },
  ];

  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <div key={section.title}>
          <div className="flex items-center gap-2 mb-1">
            <section.icon className="h-4 w-4 text-verdant" />
            <h3 className="font-heading text-[18px] text-forest">{section.title}</h3>
          </div>
          <p className="font-body text-[12px] text-sage mb-3">{section.subtitle}</p>

          {section.items.length === 0 ? (
            <p className="font-body text-[12px] text-sage italic">No qualifying ads with this metric.</p>
          ) : (
            <div className="divide-y divide-border-light">
              {section.items.map((c: any, i: number) => {
                const val = Number(c[section.metric]) || 0;
                return (
                  <div
                    key={c.ad_id}
                    className="py-3 px-1 cursor-pointer hover:bg-accent/40 transition-colors"
                    onClick={() => onCreativeClick?.(c)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge variant="outline" className="font-label text-[10px] shrink-0">#{i + 1}</Badge>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="font-body text-[14px] font-medium text-charcoal truncate">{c.ad_name}</span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-sm text-xs">{c.ad_name}</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-data text-[17px] font-semibold text-verdant">{val.toFixed(2)}%</span>
                        <span className="font-data text-[17px] font-medium text-slate">${(Number(c.spend) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      <span className="font-body text-[11px] text-sage">ROAS: <span className="font-data text-[12px] font-medium text-charcoal">{(Number(c.roas) || 0).toFixed(2)}x</span></span>
                      {c.hook && <Badge variant="outline" className="font-label text-[10px]">{c.hook}</Badge>}
                      {c.style && <Badge variant="outline" className="font-label text-[10px]">{c.style}</Badge>}
                      {c.person && <span className="font-body text-[11px] text-sage">Person: <span className="font-data text-[12px] font-medium text-charcoal">{c.person}</span></span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function IterationCard({ item, onClick }: { item: DiagnosedCreative; onClick?: () => void }) {
  const meta = DIAGNOSTIC_META[item.diagnostic];

  // Map priority labels to design system badge styles
  const priorityBadgeClass =
    item.priorityLabel === "High"
      ? "bg-sage-light text-verdant border-0"
      : item.priorityLabel === "Medium"
      ? "bg-gold-light text-amber-700 border-0"
      : "border-muted-foreground text-muted-foreground";

  return (
    <div className="glass-panel p-4 flex flex-col gap-3 cursor-pointer transition-shadow hover:shadow-card-hover" onClick={onClick}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="font-body text-[15px] font-semibold text-charcoal truncate">{item.ad_name}</p>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm text-xs">{item.ad_name}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge className="font-label text-[10px] font-semibold tracking-wide bg-red-100 text-red-700 border-0">{meta.label}</Badge>
          <Badge
            variant="outline"
            className={`font-label text-[10px] font-semibold tracking-wide ${priorityBadgeClass}`}
          >
            {item.priorityLabel}
          </Badge>
        </div>
      </div>

      {/* Metrics row */}
      <div className={`grid grid-cols-1 ${item.isImage ? "sm:grid-cols-1 max-w-[200px]" : "sm:grid-cols-3"} gap-2`}>
        {item.isImage ? (
          <div className="bg-muted/40 rounded-md px-3 py-2 flex items-center gap-2">
            <MetricDot level={item.ctrLevel} />
            <div>
              <p className="font-label text-[9px] uppercase tracking-[0.05em] text-sage">CTR</p>
              <p className="font-data text-[17px] font-semibold text-charcoal">{item.ctr.toFixed(2)}%</p>
            </div>
          </div>
        ) : (
          ([
            { label: "Hook Rate", value: item.hookRate, level: item.hookLevel },
            { label: "Hold Rate", value: item.holdRate, level: item.holdLevel },
            { label: "CTR", value: item.ctr, level: item.ctrLevel },
          ] as const).map((m) => (
            <div key={m.label} className="bg-muted/40 rounded-md px-3 py-2 flex items-center gap-2">
              <MetricDot level={m.level} />
              <div>
                <p className="font-label text-[9px] uppercase tracking-[0.05em] text-sage">{m.label}</p>
                <p className="font-data text-[17px] font-semibold text-charcoal">{m.value.toFixed(2)}%</p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Context row */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span className="font-body text-[11px] text-sage">Spend: <span className="font-data text-[12px] font-medium text-charcoal">${item.spend.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></span>
        <span className="font-body text-[11px] text-sage">ROAS: <span className="font-data text-[12px] font-medium text-charcoal">{item.roas.toFixed(2)}x</span></span>
        <span className="font-body text-[11px] text-sage">CPA: <span className="font-data text-[12px] font-medium text-charcoal">${item.cpa.toFixed(2)}</span></span>
        <span className="font-body text-[11px] text-sage">Frequency: <span className="font-data text-[12px] font-medium text-charcoal">{item.frequency.toFixed(1)}</span></span>
      </div>

      {/* Recommendation */}
      <p className="font-body text-[13px] text-slate italic border-t border-border-light pt-2">
        {item.recommendation}
      </p>
    </div>
  );
}

export function IterationsTab({ creatives, spendThreshold, onCreativeClick }: IterationsTabProps) {
  const [minSpendOverride, setMinSpendOverride] = useState<string>("");

  const effectiveMinSpend = minSpendOverride !== "" ? Math.max(0, Number(minSpendOverride) || 0) : spendThreshold;

  const benchmarks = useMemo(() => calculateBenchmarks(creatives), [creatives]);

  const diagnosed = useMemo(
    () => diagnoseCreatives(creatives, benchmarks, effectiveMinSpend),
    [creatives, benchmarks, effectiveMinSpend]
  );

  const filtered = useMemo(() => {
    return [...diagnosed].sort((a, b) => b.priorityScore - a.priorityScore);
  }, [diagnosed]);

  if (creatives.length === 0) {
    return (
      <div className="glass-panel flex flex-col items-center justify-center py-16 text-center">
        <Target className="h-10 w-10 text-muted-foreground mb-3" />
        <h3 className="text-lg font-medium mb-1">No iteration priorities yet</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Sync tagged creatives with enough spend data to surface opportunities.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Benchmarks */}
      <BenchmarkBar benchmarks={benchmarks} />

      {/* Sub-tabs: Duplicate what works vs Fix what's broken */}
      <Tabs defaultValue="fix" className="space-y-4">
        <TabsList className="bg-transparent border-b border-border-light rounded-none p-0 h-auto gap-0">
          <TabsTrigger
            value="duplicate"
            className="font-body text-[13px] font-medium text-slate data-[state=active]:text-forest data-[state=active]:font-semibold data-[state=active]:border-b-2 data-[state=active]:border-verdant data-[state=active]:shadow-none rounded-none px-4 py-2.5 bg-transparent gap-1.5"
          >
            <Trophy className="h-3.5 w-3.5" />
            Duplicate What Works
          </TabsTrigger>
          <TabsTrigger
            value="fix"
            className="font-body text-[13px] font-medium text-slate data-[state=active]:text-forest data-[state=active]:font-semibold data-[state=active]:border-b-2 data-[state=active]:border-verdant data-[state=active]:shadow-none rounded-none px-4 py-2.5 bg-transparent gap-1.5"
          >
            <Repeat className="h-3.5 w-3.5" />
            Fix What's Broken
          </TabsTrigger>
        </TabsList>

        <TabsContent value="duplicate" className="space-y-4">
          <p className="font-body text-[12px] text-sage">
            Top 5 ads by Hook Rate, Hold Rate, and CTR — ads worth duplicating and remixing. Min spend: ${effectiveMinSpend}.
          </p>
          <TopPerformers
            creatives={creatives}
            benchmarks={benchmarks}
            minSpend={effectiveMinSpend}
            onCreativeClick={onCreativeClick}
          />
        </TabsContent>

        <TabsContent value="fix" className="space-y-4">
          {/* Filter controls */}
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <label className="font-label text-[10px] uppercase tracking-[0.05em] text-slate">Min Spend ($)</label>
              <Input
                type="number"
                placeholder={String(spendThreshold)}
                value={minSpendOverride}
                onChange={(e) => setMinSpendOverride(e.target.value)}
                className="w-[100px] h-8 font-body text-[13px]"
              />
            </div>

            <p className="font-body text-[12px] text-sage self-end pb-1">
              {filtered.length} ad{filtered.length !== 1 ? "s" : ""} found
            </p>
          </div>

          {/* Cards */}
          {filtered.length === 0 ? (
            <div className="glass-panel flex flex-col items-center justify-center py-16 text-center">
              <Target className="h-10 w-10 text-muted-foreground mb-3" />
              <h3 className="text-lg font-medium mb-1">No iteration opportunities found</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                All ads with sufficient spend are performing at or above account benchmarks. Nice work.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {filtered.map((item) => (
                <IterationCard
                  key={item.ad_id}
                  item={item}
                  onClick={() => {
                    const original = creatives.find((c: any) => c.ad_id === item.ad_id);
                    if (original && onCreativeClick) onCreativeClick(original);
                  }}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
