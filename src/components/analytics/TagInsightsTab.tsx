import { useMemo, useState } from "react";
import { useRoleNavigate } from "@/hooks/useRolePath";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tags, Trophy, AlertTriangle, Lightbulb, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { KPI_LABELS } from "@/lib/killScaleLogic";

const TAG_DIMENSIONS = [
  { key: "ad_type", label: "Type" },
  { key: "person", label: "Person" },
  { key: "style", label: "Style" },
  { key: "hook", label: "Hook" },
  { key: "product", label: "Product" },
  { key: "theme", label: "Theme" },
];

const METRIC_OPTIONS = [
  { key: "roas", label: "ROAS", format: (v: number) => `${v.toFixed(2)}x` },
  { key: "ctr", label: "CTR", format: (v: number) => `${v.toFixed(2)}%` },
  { key: "cpa", label: "CPA", format: (v: number) => `$${v.toFixed(2)}` },
  { key: "cpm", label: "CPM", format: (v: number) => `$${v.toFixed(2)}` },
  { key: "thumb_stop_rate", label: "Hook Rate", format: (v: number) => `${v.toFixed(2)}%` },
  { key: "hold_rate", label: "Hold Rate", format: (v: number) => `${v.toFixed(2)}%` },
];

interface TagInsightsTabProps {
  creatives: any[];
  spendThreshold: number;
  winnerKpi?: string;
  winnerKpiDirection?: string;
  winnerKpiThreshold?: number;
}

export function TagInsightsTab({
  creatives, spendThreshold,
  winnerKpi = "roas", winnerKpiDirection = "gte", winnerKpiThreshold = 2,
}: TagInsightsTabProps) {
  const navigate = useRoleNavigate();
  const [selectedDims, setSelectedDims] = useState<Set<string>>(new Set(["hook"]));
  const [metric, setMetric] = useState("roas");
  const [minSpend, setMinSpend] = useState(spendThreshold);
  const [minCreatives, setMinCreatives] = useState(3);

  const metricConfig = METRIC_OPTIONS.find(m => m.key === metric) || METRIC_OPTIONS[0];

  const toggleDim = (key: string) => {
    setSelectedDims(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key);
      } else if (next.size < 3) {
        next.add(key);
      }
      return next;
    });
  };

  // Tagged creatives
  const taggedCreatives = useMemo(() =>
    creatives.filter((c: any) => c.tag_source && c.tag_source !== "untagged"),
  [creatives]);

  const coverage = creatives.length > 0 ? (taggedCreatives.length / creatives.length) * 100 : 0;

  // Account average for the selected metric
  const accountAvg = useMemo(() => {
    const withSpend = taggedCreatives.filter((c: any) => (Number(c.spend) || 0) > 0);
    if (withSpend.length === 0) return 0;
    const totalSpend = withSpend.reduce((s: number, c: any) => s + (Number(c.spend) || 0), 0);
    const weighted = withSpend.reduce((s: number, c: any) => {
      const spend = Number(c.spend) || 0;
      const val = Number(c[metric]) || 0;
      return s + val * spend;
    }, 0);
    return totalSpend > 0 ? weighted / totalSpend : 0;
  }, [taggedCreatives, metric]);

  // Winner logic
  const isWinner = useMemo(() => {
    return (c: any) => {
      const val = Number(c[winnerKpi]) || 0;
      const spend = Number(c.spend) || 0;
      if (spend < spendThreshold) return false;
      return winnerKpiDirection === "lte" ? (val > 0 && val <= winnerKpiThreshold) : val >= winnerKpiThreshold;
    };
  }, [winnerKpi, winnerKpiDirection, winnerKpiThreshold, spendThreshold]);

  // Combination data
  const dims = useMemo(() => [...selectedDims], [selectedDims]);

  const combinations = useMemo(() => {
    const groups: Record<string, any[]> = {};

    taggedCreatives.forEach((c: any) => {
      // Only include if all selected dims are present
      const vals = dims.map(d => c[d === "ad_type" ? "ad_type" : d]);
      if (vals.some(v => !v)) return;

      const key = vals.join(" | ");
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    });

    return Object.entries(groups)
      .map(([comboKey, items]) => {
        const withSpend = items.filter((c: any) => (Number(c.spend) || 0) >= minSpend);
        if (withSpend.length < minCreatives) return null;

        const totalSpend = withSpend.reduce((s: number, c: any) => s + (Number(c.spend) || 0), 0);

        // Spend-weighted average for the selected metric
        const weightedMetric = totalSpend > 0
          ? withSpend.reduce((s: number, c: any) => s + (Number(c[metric]) || 0) * (Number(c.spend) || 0), 0) / totalSpend
          : 0;

        const weightedCpa = totalSpend > 0
          ? withSpend.reduce((s: number, c: any) => s + (Number(c.cpa) || 0) * (Number(c.spend) || 0), 0) / totalSpend
          : 0;

        const winners = withSpend.filter(isWinner).length;
        const winRate = withSpend.length > 0 ? (winners / withSpend.length) * 100 : 0;

        const vsAvg = accountAvg > 0 ? ((weightedMetric - accountAvg) / accountAvg) * 100 : 0;

        const tagValues = dims.map(d => {
          const val = items[0][d];
          return { dim: d, value: val };
        });

        return {
          key: comboKey,
          tagValues,
          count: withSpend.length,
          avgMetric: weightedMetric,
          avgCpa: weightedCpa,
          totalSpend,
          winRate,
          vsAvg,
        };
      })
      .filter(Boolean) as NonNullable<ReturnType<typeof Array.prototype.map>[number]>[];
  }, [taggedCreatives, dims, metric, minSpend, minCreatives, accountAvg, isWinner]);

  // Sort by metric descending (for "higher is better" metrics) or ascending (for CPA/CPM)
  const isLowerBetter = metric === "cpa" || metric === "cpm";
  const sorted = useMemo(() => {
    return [...combinations].sort((a, b) =>
      isLowerBetter ? (a as any).avgMetric - (b as any).avgMetric : (b as any).avgMetric - (a as any).avgMetric
    );
  }, [combinations, isLowerBetter]);

  const maxMetric = sorted.length > 0 ? Math.max(...sorted.map((r: any) => r.avgMetric)) : 1;

  // Insight cards
  const bestRecipe = sorted.length > 0 ? sorted[0] : null;
  const worstRecipe = sorted.length > 1 ? sorted[sorted.length - 1] : null;

  const underexplored = useMemo(() => {
    if (sorted.length < 3) return null;
    // Find high metric, low count
    const candidates = sorted.filter((r: any) => r.count < minCreatives * 2 && r.count >= minCreatives);
    if (candidates.length === 0) return null;
    return candidates[0];
  }, [sorted, minCreatives]);

  // Empty state
  if (taggedCreatives.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Tags className="h-12 w-12 text-sage mb-4" />
        <h2 className="font-heading text-[22px] text-forest mb-2">Tag your creatives to unlock insights</h2>
        <p className="font-body text-[14px] text-slate max-w-[480px] mb-5">
          Tag Insights analyzes performance across creative attributes like hook type, talent, and visual style. Start tagging to discover which creative recipes drive the best results.
        </p>
        <Button className="bg-verdant hover:bg-verdant/90 text-white font-body text-[13px] font-medium" onClick={() => navigate("/tagging")}>
          Start Tagging <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Section 1: Coverage */}
      <div className="space-y-3">
        <p className="font-body text-[13px] text-slate">
          Analyze performance by creative attributes. Creatives must be tagged to appear in this analysis.
        </p>
        <div className="flex items-center gap-3">
          <span className="font-data text-[17px] font-semibold text-charcoal tabular-nums">
            {taggedCreatives.length.toLocaleString()} of {creatives.length.toLocaleString()} creatives tagged ({coverage.toFixed(1)}%)
          </span>
          <div className="w-[200px] h-1 rounded-full bg-cream-dark overflow-hidden">
            <div className="h-full bg-verdant rounded-full" style={{ width: `${Math.min(coverage, 100)}%` }} />
          </div>
        </div>
        {coverage < 20 && (
          <div className="bg-gold-light rounded-[6px] py-2 px-4">
            <p className="font-body text-[13px] text-charcoal">
              Tag more creatives for better insights. The more you tag, the stronger these patterns become.{" "}
              <button onClick={() => navigate("/tagging")} className="text-verdant font-medium hover:underline">Go to Tagging →</button>
            </p>
          </div>
        )}
      </div>

      {/* Section 2: Controls */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="space-y-1">
          <p className="font-label text-[10px] uppercase tracking-wide text-sage font-medium">Analyze by</p>
          <div className="flex gap-1.5">
            {TAG_DIMENSIONS.map(dim => (
              <button
                key={dim.key}
                onClick={() => toggleDim(dim.key)}
                className={cn(
                  "font-body text-[12px] px-2.5 py-1 rounded-full border transition-hover",
                  selectedDims.has(dim.key)
                    ? "bg-verdant text-white border-verdant font-medium"
                    : "bg-white text-slate border-border-light hover:text-forest hover:border-forest"
                )}
              >
                {dim.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <p className="font-label text-[10px] uppercase tracking-wide text-sage font-medium">Metric</p>
          <Select value={metric} onValueChange={setMetric}>
            <SelectTrigger className="w-32 h-8 font-body text-[13px] text-charcoal border-border-light">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METRIC_OPTIONS.map(m => (
                <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <p className="font-label text-[10px] uppercase tracking-wide text-sage font-medium">Min Spend</p>
          <Input
            type="number"
            value={minSpend}
            onChange={e => setMinSpend(Number(e.target.value) || 0)}
            className="w-24 h-8 font-data text-[17px] border-border-light"
          />
        </div>

        <div className="space-y-1">
          <p className="font-label text-[10px] uppercase tracking-wide text-sage font-medium">Min Creatives</p>
          <Input
            type="number"
            value={minCreatives}
            onChange={e => setMinCreatives(Number(e.target.value) || 1)}
            className="w-20 h-8 font-data text-[15px] border-border-light"
          />
        </div>
      </div>

      {/* Section 3: Table */}
      {sorted.length > 0 ? (
        <div className="glass-panel overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-cream-dark">
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Tag Combination</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Creatives</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Avg {metricConfig.label}</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Avg CPA</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Total Spend</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Win Rate</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">vs. Avg</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((row: any) => {
                const barWidth = maxMetric > 0 ? (row.avgMetric / maxMetric) * 100 : 0;
                return (
                  <TableRow key={row.key} className="border-b border-border-light">
                    <TableCell>
                      <div className="flex items-center gap-1 flex-wrap">
                        {row.tagValues.map((tv: any, i: number) => (
                          <span key={tv.dim} className="flex items-center gap-1">
                            {i > 0 && <span className="font-body text-[10px] text-sage">+</span>}
                            <span className="font-label text-[10px] font-medium bg-sage-light text-forest px-1.5 py-0.5 rounded-[3px]">{tv.value}</span>
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="font-data text-[15px] font-medium text-charcoal tabular-nums text-right">{row.count}</TableCell>
                    <TableCell className="text-right">
                      <div className="relative inline-flex items-center justify-end min-w-[120px]">
...
                      </div>
                    </TableCell>
                    <TableCell className="font-data text-[15px] font-medium text-charcoal tabular-nums text-right">${row.avgCpa.toFixed(2)}</TableCell>
                    <TableCell className="font-data text-[15px] font-medium text-charcoal tabular-nums text-right">${row.totalSpend.toLocaleString("en-US", { maximumFractionDigits: 0 })}</TableCell>
                    <TableCell className={cn(
                      "font-data text-[15px] font-medium tabular-nums text-right",
                      row.winRate >= 50 ? "text-verdant" : row.winRate < 20 ? "text-red-700" : "text-charcoal"
                    )}>
                      {row.winRate.toFixed(1)}%
                    </TableCell>
                    <TableCell className={cn(
                      "font-data text-[15px] font-medium tabular-nums text-right",
                      row.vsAvg > 0 ? "text-verdant" : row.vsAvg < 0 ? "text-red-700" : "text-charcoal"
                    )}>
                      {row.vsAvg > 0 ? "+" : ""}{row.vsAvg.toFixed(0)}%
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="glass-panel flex flex-col items-center justify-center py-16 text-center">
          <Tags className="h-10 w-10 text-sage mb-3" />
          <h3 className="font-heading text-[18px] text-forest mb-1">No combinations found</h3>
          <p className="font-body text-[13px] text-slate max-w-md">Try lowering the minimum spend or creative count, or tag more creatives.</p>
        </div>
      )}

      {/* Section 4: Insight Cards */}
      {sorted.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {bestRecipe && (
            <InsightCard
              icon={<Trophy className="h-5 w-5 text-verdant" />}
              title="Best Recipe"
              body={`${formatComboName(bestRecipe)} averages ${metricConfig.format((bestRecipe as any).avgMetric)}, ${Math.abs((bestRecipe as any).vsAvg).toFixed(0)}% ${(bestRecipe as any).vsAvg >= 0 ? "above" : "below"} your account average, across ${(bestRecipe as any).count} creatives with $${(bestRecipe as any).totalSpend.toLocaleString("en-US", { maximumFractionDigits: 0 })} in spend.`}
            />
          )}
          {worstRecipe && (
            <InsightCard
              icon={<AlertTriangle className="h-5 w-5 text-red-700" />}
              title="Worst Recipe"
              body={`${formatComboName(worstRecipe)} averages ${metricConfig.format((worstRecipe as any).avgMetric)}, ${Math.abs((worstRecipe as any).vsAvg).toFixed(0)}% ${(worstRecipe as any).vsAvg >= 0 ? "above" : "below"} average. Consider pausing or reworking creatives with this approach.`}
            />
          )}
          {underexplored && (
            <InsightCard
              icon={<Lightbulb className="h-5 w-5 text-gold" />}
              title="Underexplored"
              body={`${formatComboName(underexplored)} shows strong early results (${metricConfig.format((underexplored as any).avgMetric)}) but only has ${(underexplored as any).count} creatives. Consider producing more to validate.`}
            />
          )}
        </div>
      )}
    </div>
  );
}

function InsightCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="bg-white border border-border-light rounded-[8px] p-5">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h3 className="font-heading text-[16px] text-forest">{title}</h3>
      </div>
      <p className="font-body text-[13px] text-charcoal">{body}</p>
    </div>
  );
}

function formatComboName(row: any): string {
  return (row as any).tagValues.map((tv: any) => tv.value).join(" + ");
}
