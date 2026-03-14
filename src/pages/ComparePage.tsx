import { AppLayout } from "@/components/AppLayout";
import { useSearchParams, Link } from "react-router-dom";
import { useRolePrefix } from "@/hooks/useRolePath";
import { useAllCreatives } from "@/hooks/useAllCreatives";
import { useAccountContext } from "@/contexts/AccountContext";
import { calculateBenchmarks, diagnoseCreatives, DIAGNOSTIC_META, DiagnosedCreative } from "@/lib/iterationDiagnostics";
import { groupByConcept, ConceptGroup } from "@/lib/conceptGrouping";
import { cn } from "@/lib/utils";
import { ArrowLeft, Video, Play } from "lucide-react";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

import { fmt$ } from "@/lib/formatters";

const METRIC_CONFIG = [
  { key: "roas", label: "ROAS", format: (v: number) => `${v.toFixed(2)}x`, best: "max" },
  { key: "ctr", label: "CTR", format: (v: number) => `${v.toFixed(2)}%`, best: "max" },
  { key: "cpa", label: "CPA", format: (v: number) => fmt$(v), best: "min" },
  { key: "cpm", label: "CPM", format: (v: number) => fmt$(v), best: "min" },
  { key: "spend", label: "Spend", format: (v: number) => fmt$(v), best: "max" },
  { key: "purchases", label: "Purchases", format: (v: number) => v.toLocaleString(), best: "max" },
  { key: "thumb_stop_rate", label: "Hook Rate", format: (v: number) => `${v.toFixed(2)}%`, best: "max" },
  { key: "hold_rate", label: "Hold Rate", format: (v: number) => `${v.toFixed(2)}%`, best: "max" },
  { key: "frequency", label: "Frequency", format: (v: number) => v.toFixed(2), best: "min" },
] as const;

const TAG_FIELDS = [
  { key: "ad_type", label: "Type" },
  { key: "hook", label: "Hook" },
  { key: "person", label: "Person" },
  { key: "style", label: "Style" },
  { key: "product", label: "Product" },
  { key: "theme", label: "Theme" },
];

const ComparePage = () => {
  const [searchParams] = useSearchParams();
  const ids = (searchParams.get("ids") || "").split(",").filter(Boolean);
  const { selectedAccountId, selectedAccount } = useAccountContext();
  const prefix = useRolePrefix();
  const [mode, setMode] = useState<"ads" | "concepts">("ads");

  const filters = useMemo(() => ({
    ...(selectedAccountId && selectedAccountId !== "all" ? { account_id: selectedAccountId } : {}),
  }), [selectedAccountId]);

  const { data: allCreatives = [], isLoading } = useAllCreatives(filters);

  // --- Ads mode data ---
  const selected = useMemo(() => {
    return ids.map(id => allCreatives.find((c: any) => c.ad_id === id)).filter(Boolean) as any[];
  }, [ids, allCreatives]);

  const diagnosticsMap = useMemo(() => {
    if (allCreatives.length === 0) return new Map<string, DiagnosedCreative>();
    const benchmarks = calculateBenchmarks(allCreatives);
    const diagnosed = diagnoseCreatives(allCreatives, benchmarks, 0);
    const map = new Map<string, DiagnosedCreative>();
    diagnosed.forEach(d => map.set(d.ad_id, d));
    return map;
  }, [allCreatives]);

  const metricHighlights = useMemo(() => {
    if (selected.length < 2) return {};
    const result: Record<string, { bestIdx: number; worstIdx: number }> = {};
    for (const m of METRIC_CONFIG) {
      const values = selected.map((c: any) => Number(c[m.key]) || 0);
      let bestIdx = 0;
      let worstIdx = 0;
      for (let i = 1; i < values.length; i++) {
        if (m.best === "max") {
          if (values[i] > values[bestIdx]) bestIdx = i;
          if (values[i] < values[worstIdx]) worstIdx = i;
        } else {
          if (values[i] > 0 && (values[bestIdx] === 0 || values[i] < values[bestIdx])) bestIdx = i;
          if (values[i] > values[worstIdx]) worstIdx = i;
        }
      }
      if (values[bestIdx] !== values[worstIdx]) {
        result[m.key] = { bestIdx, worstIdx };
      }
    }
    return result;
  }, [selected]);

  const patterns = useMemo(() => {
    if (selected.length < 2) return [];
    const lines: string[] = [];
    const roasVals = selected.map((c: any) => ({ name: c.ad_name, roas: Number(c.roas) || 0 }));
    const bestRoas = roasVals.reduce((a, b) => b.roas > a.roas ? b : a);
    const worstRoas = roasVals.reduce((a, b) => b.roas < a.roas ? b : a);
    if (bestRoas.roas !== worstRoas.roas) {
      const pctHigher = worstRoas.roas > 0
        ? Math.round(((bestRoas.roas - worstRoas.roas) / worstRoas.roas) * 100)
        : null;
      lines.push(`**${bestRoas.name}** has the highest ROAS at ${bestRoas.roas.toFixed(2)}x${pctHigher ? `, ${pctHigher}% higher than **${worstRoas.name}**` : ""}`);
    }
    const cpaVals = selected.map((c: any) => ({ name: c.ad_name, cpa: Number(c.cpa) || 0 })).filter(v => v.cpa > 0);
    if (cpaVals.length >= 2) {
      const bestCpa = cpaVals.reduce((a, b) => b.cpa < a.cpa ? b : a);
      lines.push(`**${bestCpa.name}** has the lowest CPA at ${fmt$(bestCpa.cpa)}`);
    }
    const hookVals = selected.map((c: any) => ({ name: c.ad_name, hook: Number(c.thumb_stop_rate) || 0 })).filter(v => v.hook > 0);
    if (hookVals.length >= 2) {
      const bestHook = hookVals.reduce((a, b) => b.hook > a.hook ? b : a);
      const worstHook = hookVals.reduce((a, b) => b.hook < a.hook ? b : a);
      if (bestHook.hook > worstHook.hook * 1.2) {
        const pct = Math.round(((bestHook.hook - worstHook.hook) / worstHook.hook) * 100);
        lines.push(`**${bestHook.name}** retains ${pct}% more viewers in the first 3 seconds`);
      }
    }
    const allTagged = selected.every((c: any) => c.tag_source && c.tag_source !== "untagged");
    if (allTagged) {
      const bestRoasC = selected.reduce((a: any, b: any) => (Number(b.roas) || 0) > (Number(a.roas) || 0) ? b : a);
      const worstRoasC = selected.reduce((a: any, b: any) => (Number(b.roas) || 0) < (Number(a.roas) || 0) ? b : a);
      if (bestRoasC.hook && worstRoasC.hook && bestRoasC.hook !== worstRoasC.hook) {
        lines.push(`The top performer uses **${bestRoasC.hook}** hook while the underperformer uses **${worstRoasC.hook}**`);
      }
    }
    return lines.slice(0, 5);
  }, [selected]);

  const anyUntagged = selected.some((c: any) => !c.tag_source || c.tag_source === "untagged");

  // --- Concepts mode data ---
  const conceptGroups = useMemo(() => {
    if (allCreatives.length === 0) return [];
    return groupByConcept(allCreatives).filter(g => g.iterations.length > 1);
  }, [allCreatives]);

  const [conceptA, setConceptA] = useState<string>("");
  const [conceptB, setConceptB] = useState<string>("");

  const selectedConcepts = useMemo(() => {
    const result: (ConceptGroup | null)[] = [null, null];
    if (conceptA) result[0] = conceptGroups.find(g => g.name === conceptA) || null;
    if (conceptB) result[1] = conceptGroups.find(g => g.name === conceptB) || null;
    return result;
  }, [conceptA, conceptB, conceptGroups]);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <div className="h-5 w-5 border-2 border-verdant border-t-transparent rounded-full animate-spin" />
        </div>
      </AppLayout>
    );
  }

  if (mode === "ads" && selected.length === 0) {
    return (
      <AppLayout>
        <div className="py-20 text-center">
          <p className="font-body text-[14px] text-slate">No creatives found. Please select creatives from the Creatives page.</p>
          <Link to={`${prefix}/creatives`} className="font-body text-[13px] text-verdant hover:underline mt-2 inline-block">← Back to Creatives</Link>
        </div>
      </AppLayout>
    );
  }

  const colClass = selected.length === 2 ? "grid-cols-2" : "grid-cols-3";

  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Header */}
        <div>
          <Link to={`${prefix}/creatives`} className="font-body text-[13px] text-verdant hover:underline flex items-center gap-1 mb-3">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Creatives
          </Link>
          <h1 className="font-heading text-[32px] text-forest">Creative Comparison</h1>
          <p className="font-body text-[13px] text-slate font-light mt-1">
            {mode === "ads"
              ? `Comparing ${selected.length} creatives · ${selectedAccount?.name || "All Accounts"}`
              : `Comparing concepts · ${selectedAccount?.name || "All Accounts"}`}
          </p>
        </div>

        {/* Mode toggle */}
        <div className="flex items-center gap-1 p-1 bg-muted rounded-md w-fit">
          <button
            onClick={() => setMode("ads")}
            className={cn(
              "font-label text-[11px] uppercase tracking-wide px-4 py-1.5 rounded-[4px] transition-colors",
              mode === "ads" ? "bg-background text-forest shadow-sm" : "text-slate hover:text-charcoal"
            )}
          >
            Compare Ads
          </button>
          <button
            onClick={() => setMode("concepts")}
            className={cn(
              "font-label text-[11px] uppercase tracking-wide px-4 py-1.5 rounded-[4px] transition-colors",
              mode === "concepts" ? "bg-background text-forest shadow-sm" : "text-slate hover:text-charcoal"
            )}
          >
            Compare Concepts
          </button>
        </div>

        {mode === "ads" ? (
          <>
            {/* Existing ad comparison columns */}
            <div className={cn("grid gap-0", colClass)}>
              {selected.map((c: any, idx: number) => (
                <div
                  key={c.ad_id}
                  className={cn(
                    "px-5 py-4",
                    idx < selected.length - 1 && "border-r border-border-light"
                  )}
                >
                  <ComparisonThumbnail creative={c} />
                  <div className="mt-4">
                    <p className="font-body text-[15px] font-semibold text-charcoal truncate">{c.ad_name}</p>
                    <p className="font-body text-[11px] text-sage mt-0.5">{c.unique_code || "—"}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {TAG_FIELDS.map(tf => {
                        const val = c[tf.key];
                        return val ? (
                          <span key={tf.key} className="font-label text-[9px] font-medium uppercase tracking-wide bg-sage-light text-forest px-1.5 py-0.5 rounded-[3px]">{val}</span>
                        ) : (
                          <span key={tf.key} className="font-label text-[9px] text-sage/50 px-1.5 py-0.5">—</span>
                        );
                      })}
                    </div>
                  </div>
                  <div className="mt-5">
                    <p className="font-label text-[10px] uppercase tracking-wide text-sage font-medium mb-2">Performance</p>
                    <div className="space-y-1.5">
                      {METRIC_CONFIG.map(m => {
                        const val = Number(c[m.key]) || 0;
                        const h = metricHighlights[m.key];
                        let colorClass = "text-charcoal";
                        if (h) {
                          if (h.bestIdx === idx) colorClass = "text-verdant";
                          else if (h.worstIdx === idx) colorClass = "text-destructive";
                        }
                        return (
                          <div key={m.key} className="flex items-center justify-between">
                            <span className="font-label text-[10px] uppercase tracking-[0.04em] text-sage">{m.label}</span>
                            <span className={cn("font-data text-[16px] font-semibold tabular-nums", colorClass)}>
                              {m.format(val)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="mt-5">
                    <p className="font-label text-[10px] uppercase tracking-wide text-sage font-medium mb-1">Notes</p>
                    {c.notes ? (
                      <p className="font-body text-[13px] text-slate italic">{c.notes}</p>
                    ) : (
                      <p className="font-body text-[13px] text-sage">No notes yet</p>
                    )}
                  </div>
                  {diagnosticsMap.has(c.ad_id) && (() => {
                    const d = diagnosticsMap.get(c.ad_id)!;
                    const meta = DIAGNOSTIC_META[d.diagnostic];
                    return (
                      <div className="mt-4">
                        <p className="font-label text-[10px] uppercase tracking-wide text-sage font-medium mb-1">Diagnostic</p>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={cn("font-label text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-[3px]", meta.color)}>{meta.label}</span>
                          <span className={cn(
                            "font-label text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-[3px]",
                            d.priorityLabel === "High" ? "bg-red-100 text-red-700" : d.priorityLabel === "Medium" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"
                          )}>{d.priorityLabel}</span>
                        </div>
                        <p className="font-body text-[12px] text-slate">{d.recommendation}</p>
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>

            {/* Pattern Summary */}
            <div className="bg-white border border-border-light rounded-[8px] p-6">
              <h2 className="font-heading text-[20px] text-forest mb-4">What stands out</h2>
              {patterns.length > 0 ? (
                <ul className="space-y-2">
                  {patterns.map((line, i) => (
                    <li key={i} className="font-body text-[14px] text-charcoal prose prose-sm max-w-none">
                      <ReactMarkdown>{line}</ReactMarkdown>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="font-body text-[14px] text-sage">Not enough data to generate comparisons.</p>
              )}
              {anyUntagged && (
                <p className="font-body text-[13px] text-sage mt-3">
                  <Link to={`${prefix}/tagging`} className="text-verdant hover:underline">Tag these creatives</Link> to unlock qualitative pattern analysis.
                </p>
              )}
            </div>
          </>
        ) : (
          <ConceptComparison
            conceptGroups={conceptGroups}
            conceptA={conceptA}
            conceptB={conceptB}
            setConceptA={setConceptA}
            setConceptB={setConceptB}
            selectedConcepts={selectedConcepts}
          />
        )}
      </div>
    </AppLayout>
  );
};

// ─── Concept Comparison ─────────────────────────────────────────────────────

interface ConceptComparisonProps {
  conceptGroups: ConceptGroup[];
  conceptA: string;
  conceptB: string;
  setConceptA: (v: string) => void;
  setConceptB: (v: string) => void;
  selectedConcepts: (ConceptGroup | null)[];
}

function ConceptComparison({ conceptGroups, conceptA, conceptB, setConceptA, setConceptB, selectedConcepts }: ConceptComparisonProps) {
  const [a, b] = selectedConcepts;

  const conceptMetrics = useMemo(() => {
    if (!a || !b) return [];

    const avgField = (group: ConceptGroup, field: string) => {
      const withSpend = group.iterations.filter(c => (Number(c.spend) || 0) > 0);
      if (withSpend.length === 0) return 0;
      const totalSpend = withSpend.reduce((s, c) => s + (Number(c.spend) || 0), 0);
      return withSpend.reduce((s, c) => s + (Number(c[field]) || 0) * (Number(c.spend) || 0), 0) / totalSpend;
    };

    return [
      { label: "Blended ROAS", valA: a.blendedRoas, valB: b.blendedRoas, format: (v: number) => `${v.toFixed(2)}x`, best: "max" as const },
      { label: "Total Spend", valA: a.totalSpend, valB: b.totalSpend, format: fmt$, best: "max" as const },
      { label: "Iterations", valA: a.iterations.length, valB: b.iterations.length, format: (v: number) => String(v), best: "max" as const },
      { label: "Total Purchases", valA: a.totalPurchases, valB: b.totalPurchases, format: (v: number) => v.toLocaleString(), best: "max" as const },
      {
        label: "Best Iteration",
        valA: a.best ? Number(a.best.roas) || 0 : 0,
        valB: b.best ? Number(b.best.roas) || 0 : 0,
        format: (_v: number, group: ConceptGroup | null) => {
          if (!group?.best) return "—";
          return `${group.best.ad_name} (${(Number(group.best.roas) || 0).toFixed(1)}x)`;
        },
        best: "max" as const,
        useGroup: true,
      },
      {
        label: "Worst Iteration",
        valA: a.worst ? Number(a.worst.roas) || 0 : 0,
        valB: b.worst ? Number(b.worst.roas) || 0 : 0,
        format: (_v: number, group: ConceptGroup | null) => {
          if (!group?.worst) return "—";
          return `${group.worst.ad_name} (${(Number(group.worst.roas) || 0).toFixed(1)}x)`;
        },
        best: "max" as const,
        useGroup: true,
      },
      { label: "Avg CTR", valA: avgField(a, "ctr"), valB: avgField(b, "ctr"), format: (v: number) => `${v.toFixed(2)}%`, best: "max" as const },
      { label: "Avg Hook Rate", valA: avgField(a, "thumb_stop_rate"), valB: avgField(b, "thumb_stop_rate"), format: (v: number) => `${v.toFixed(2)}%`, best: "max" as const },
    ];
  }, [a, b]);

  if (conceptGroups.length < 2) {
    return (
      <div className="glass-panel p-8 text-center">
        <p className="font-body text-[14px] text-slate">Need at least 2 concept groups with multiple iterations to compare. Tag and name your creatives with version indicators (e.g. v1, v2) to create concepts.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Selectors */}
      <div className="grid grid-cols-2 gap-6">
        <ConceptSelector
          label="Concept A"
          value={conceptA}
          onChange={setConceptA}
          groups={conceptGroups}
          excludeValue={conceptB}
          concept={a}
        />
        <ConceptSelector
          label="Concept B"
          value={conceptB}
          onChange={setConceptB}
          groups={conceptGroups}
          excludeValue={conceptA}
          concept={b}
        />
      </div>

      {/* Metrics Table */}
      {a && b && (
        <div className="glass-panel p-0 overflow-hidden rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-label text-[11px] uppercase tracking-wide text-slate w-[200px]">Metric</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-wide text-slate">{a.name}</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-wide text-slate">{b.name}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {conceptMetrics.map((row) => {
                const aWins = row.best === "max" ? row.valA > row.valB : row.valA < row.valB;
                const bWins = row.best === "max" ? row.valB > row.valA : row.valB < row.valA;
                const tied = row.valA === row.valB;
                return (
                  <TableRow key={row.label}>
                    <TableCell className="font-label text-[11px] uppercase tracking-wide text-slate">{row.label}</TableCell>
                    <TableCell className={cn(
                      "font-data text-[14px] font-semibold tabular-nums",
                      !tied && aWins ? "bg-emerald-50 text-emerald-700" : "text-charcoal"
                    )}>
                      {row.useGroup ? (row as any).format(row.valA, a) : (row as any).format(row.valA)}
                    </TableCell>
                    <TableCell className={cn(
                      "font-data text-[14px] font-semibold tabular-nums",
                      !tied && bWins ? "bg-emerald-50 text-emerald-700" : "text-charcoal"
                    )}>
                      {row.useGroup ? (row as any).format(row.valB, b) : (row as any).format(row.valB)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function ConceptSelector({ label, value, onChange, groups, excludeValue, concept }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  groups: ConceptGroup[];
  excludeValue: string;
  concept: ConceptGroup | null;
}) {
  return (
    <div className="space-y-3">
      <label className="font-label text-[10px] uppercase tracking-wide text-sage font-medium">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-[13px] text-charcoal focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">Select a concept…</option>
        {groups.filter(g => g.name !== excludeValue).map(g => (
          <option key={g.name} value={g.name}>
            {g.name} ({g.iterations.length} iterations · {g.blendedRoas.toFixed(2)}x ROAS)
          </option>
        ))}
      </select>
      {concept && (
        <div className="glass-panel p-4 space-y-2">
          {concept.best?.thumbnail_url && (
            <div className="aspect-video rounded-[6px] overflow-hidden bg-muted">
              <img src={concept.best.thumbnail_url} alt="" className="h-full w-full object-cover" />
            </div>
          )}
          <p className="font-body text-[15px] font-semibold text-charcoal">{concept.name}</p>
          <div className="flex items-center gap-3">
            <span className="font-data text-[12px] text-slate">{concept.iterations.length} iterations</span>
            <span className="font-data text-[12px] text-slate">·</span>
            <span className="font-data text-[12px] text-slate">{concept.blendedRoas.toFixed(2)}x blended ROAS</span>
            <span className="font-data text-[12px] text-slate">·</span>
            <span className="font-data text-[12px] text-slate">{fmt$(concept.totalSpend)} spend</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Shared Components ──────────────────────────────────────────────────────

function ComparisonThumbnail({ creative }: { creative: any }) {
  const isVideoAd = (creative.video_views || 0) > 0;
  const adPreviewUrl = creative.ad_post_url || null;

  return (
    <div className="relative aspect-video rounded-[6px] overflow-hidden bg-muted">
      {creative.thumbnail_url ? (
        <img src={creative.thumbnail_url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full flex items-center justify-center">
          <span className="text-muted-foreground font-body text-[13px]">No preview</span>
        </div>
      )}
      {isVideoAd && (
        <div className="absolute top-2 left-2 bg-charcoal/80 rounded-[3px] px-1.5 py-0.5 flex items-center gap-0.5">
          <Video className="h-3 w-3 text-white" />
          <span className="font-label text-[9px] font-semibold uppercase tracking-wide text-white">Video</span>
        </div>
      )}
      {isVideoAd && adPreviewUrl && (
        <a
          href={adPreviewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 hover:opacity-100 transition-opacity"
        >
          <div className="h-10 w-10 rounded-full bg-white/90 flex items-center justify-center">
            <Play className="h-5 w-5 text-charcoal ml-0.5" />
          </div>
        </a>
      )}
    </div>
  );
}

export default ComparePage;
