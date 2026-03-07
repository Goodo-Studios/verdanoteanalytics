import { useMemo, useState, useCallback } from "react";
import { X, RefreshCw, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { computeFatigueMap, type FatigueResult } from "@/lib/fatigueScore";
import { useRoleNavigate } from "@/hooks/useRolePath";

/* ── Types ─────────────────────────────────── */

interface InsightCard {
  id: string;
  type: "winner" | "format" | "fatigue" | "momentum" | "opportunity" | "concept";
  icon: string;
  headline: string;
  body: string;
  cta: string;
  ctaAction: () => void;
  priority: number; // lower = higher priority
}

interface InsightCardsProps {
  creatives: any[];
  metrics: { avgRoas: number; totalSpend: number; avgCpa: number; avgCtr: number; winRate: number; activeCount: number };
  prevMetrics?: { avgRoas: number; totalSpend: number } | null;
  fatigueMap?: Map<string, FatigueResult>;
  wowTrends?: Map<string, any>;
  scaleThreshold: number;
  spendThreshold: number;
  onCreativeClick?: (creative: any) => void;
}

/* ── Dismiss logic (localStorage, 24h TTL) ── */

const DISMISS_KEY = "insight_dismissed";

function getDismissed(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(DISMISS_KEY) || "{}");
  } catch { return {}; }
}

function dismissCard(id: string) {
  const d = getDismissed();
  d[id] = Date.now();
  localStorage.setItem(DISMISS_KEY, JSON.stringify(d));
}

function isDismissed(id: string): boolean {
  const d = getDismissed();
  const ts = d[id];
  if (!ts) return false;
  return Date.now() - ts < 24 * 60 * 60 * 1000;
}

/* ── Formatting helpers ────────────────────── */

function fmt$(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

/* ── Card generation logic ─────────────────── */

function generateInsights(
  creatives: any[],
  metrics: InsightCardsProps["metrics"],
  prevMetrics: InsightCardsProps["prevMetrics"],
  fatigueMap: Map<string, FatigueResult> | undefined,
  wowTrends: Map<string, any> | undefined,
  scaleThreshold: number,
  spendThreshold: number,
  navigate: (path: string) => void,
  onCreativeClick?: (creative: any) => void,
): InsightCard[] {
  const cards: InsightCard[] = [];
  const active = creatives.filter((c: any) => (Number(c.spend) || 0) >= spendThreshold);
  if (active.length === 0) return cards;

  // Sort by ROAS desc for winner detection
  const byRoas = [...active].sort((a: any, b: any) => (Number(b.roas) || 0) - (Number(a.roas) || 0));
  const avgRoas = metrics.avgRoas;

  // ── WINNER ALERT ──
  const topCreative = byRoas[0];
  if (topCreative && (Number(topCreative.roas) || 0) >= scaleThreshold) {
    const roas = Number(topCreative.roas) || 0;
    const spend = Number(topCreative.spend) || 0;
    const diff = (roas - avgRoas).toFixed(1);
    cards.push({
      id: `winner-${topCreative.ad_id}`,
      type: "winner",
      icon: "🏆",
      headline: "New best performer",
      body: `${topCreative.ad_name} is your #1 creative at ${roas.toFixed(1)}x ROAS and ${fmt$(spend)} spend. It's outperforming your account average by ${diff}x.`,
      cta: "View Creative →",
      ctaAction: () => onCreativeClick ? onCreativeClick(topCreative) : navigate(`/creatives?highlight=${topCreative.ad_id}`),
      priority: 1,
    });
  }

  // ── FORMAT INSIGHT ──
  const byFormat: Record<string, { count: number; totalRoas: number; totalSpend: number }> = {};
  for (const c of active) {
    const fmt = (c.ad_type || "unknown").toLowerCase();
    if (!byFormat[fmt]) byFormat[fmt] = { count: 0, totalRoas: 0, totalSpend: 0 };
    byFormat[fmt].count++;
    byFormat[fmt].totalRoas += Number(c.roas) || 0;
    byFormat[fmt].totalSpend += Number(c.spend) || 0;
  }
  const formats = Object.entries(byFormat).map(([k, v]) => ({
    format: k, avgRoas: v.count > 0 ? v.totalRoas / v.count : 0, totalSpend: v.totalSpend, count: v.count,
  })).sort((a, b) => b.avgRoas - a.avgRoas);

  if (formats.length >= 2 && formats[0].avgRoas > formats[1].avgRoas * 1.3) {
    const best = formats[0];
    const worst = formats[1];
    const totalSpend = formats.reduce((s, f) => s + f.totalSpend, 0);
    const worstPct = totalSpend > 0 ? Math.round((worst.totalSpend / totalSpend) * 100) : 0;
    cards.push({
      id: `format-${best.format}-${worst.format}`,
      type: "format",
      icon: "📊",
      headline: `${best.format} is outperforming ${worst.format}`,
      body: `Your ${best.format} creatives average ${best.avgRoas.toFixed(1)}x vs ${worst.avgRoas.toFixed(1)}x for ${worst.format}. That's a ${(best.avgRoas - worst.avgRoas).toFixed(1)}x difference. ${worstPct}% of budget is on ${worst.format}.`,
      cta: "See breakdown →",
      ctaAction: () => navigate("/analytics?tab=taginsights"),
      priority: 4,
    });
  }

  // ── FATIGUE WARNING ──
  if (fatigueMap && fatigueMap.size > 0) {
    const fatigued = active.filter((c: any) => {
      const f = fatigueMap.get(c.ad_id);
      return f && f.score >= 70;
    }).sort((a: any, b: any) => (Number(b.spend) || 0) - (Number(a.spend) || 0));

    if (fatigued.length > 0) {
      const top3 = fatigued.slice(0, 3);
      const totalFatigueSpend = fatigued.reduce((s: number, c: any) => s + (Number(c.spend) || 0), 0);
      const names = top3.map((c: any) => c.ad_name).join(", ");
      cards.push({
        id: `fatigue-${fatigued.length}`,
        type: "fatigue",
        icon: "⚠️",
        headline: `${fatigued.length} creative${fatigued.length > 1 ? "s" : ""} fatiguing fast`,
        body: `${names}${fatigued.length > 3 ? ` and ${fatigued.length - 3} more` : ""} ha${fatigued.length === 1 ? "s" : "ve"} fatigue scores above 70. They account for ${fmt$(totalFatigueSpend)} in spend.`,
        cta: "Review now →",
        ctaAction: () => navigate("/creatives?fatigue=true"),
        priority: 2,
      });
    }
  }

  // ── MOMENTUM ──
  if (prevMetrics && prevMetrics.avgRoas > 0) {
    const roasDiff = metrics.avgRoas - prevMetrics.avgRoas;
    if (Math.abs(roasDiff) >= 0.3) {
      const improving = roasDiff > 0;
      // Find biggest contributor via WoW trends
      let contributor = "";
      if (wowTrends && wowTrends.size > 0) {
        let best = { name: "", delta: 0 };
        for (const c of active) {
          const t = wowTrends.get(c.ad_id);
          if (t) {
            const d = improving ? (t.direction === "up" ? t.pctChange : 0) : (t.direction === "down" ? t.pctChange : 0);
            if (d > best.delta) best = { name: c.ad_name, delta: d };
          }
        }
        if (best.name) contributor = ` The ${improving ? "lift" : "drop"} came primarily from ${best.name}.`;
      }
      cards.push({
        id: `momentum-${improving ? "up" : "down"}`,
        type: "momentum",
        icon: improving ? "📈" : "📉",
        headline: improving ? "Strong period" : "ROAS dipping",
        body: `Your blended ROAS ${improving ? "improved" : "declined"} from ${prevMetrics.avgRoas.toFixed(1)}x to ${metrics.avgRoas.toFixed(1)}x.${contributor}`,
        cta: "See what changed →",
        ctaAction: () => navigate("/analytics?tab=trends"),
        priority: improving ? 3 : 2,
      });
    }
  }

  // ── OPPORTUNITY (underfunded winners) ──
  const underfunded = active
    .filter((c: any) => (Number(c.roas) || 0) >= scaleThreshold && (Number(c.spend) || 0) < metrics.totalSpend * 0.05)
    .sort((a: any, b: any) => (Number(b.roas) || 0) - (Number(a.roas) || 0));

  if (underfunded.length > 0) {
    const c = underfunded[0];
    const roas = Number(c.roas) || 0;
    const spend = Number(c.spend) || 0;
    const targetSpend = Math.max(spend * 3, 3000);
    const projectedRevenue = (targetSpend * roas - targetSpend).toFixed(0);
    cards.push({
      id: `opportunity-${c.ad_id}`,
      type: "opportunity",
      icon: "💡",
      headline: "Underfunded winner",
      body: `${c.ad_name} has a ${roas.toFixed(1)}x ROAS but only ${fmt$(spend)} in spend. Scaling to ${fmt$(targetSpend)} could add ~${fmt$(Number(projectedRevenue))} in attributed revenue.`,
      cta: "View Creative →",
      ctaAction: () => onCreativeClick ? onCreativeClick(c) : navigate(`/creatives?highlight=${c.ad_id}`),
      priority: 3,
    });
  }

  // ── CONCEPT PATTERN ──
  const conceptGroups: Record<string, any[]> = {};
  for (const c of active) {
    const code = c.unique_code;
    if (!code) continue;
    // Strip version suffix to group: e.g. "Hair Drain v2" → "Hair Drain"
    const base = code.replace(/\s*v\d+$/i, "").replace(/\s*-\s*\d+$/, "").trim();
    if (!base) continue;
    if (!conceptGroups[base]) conceptGroups[base] = [];
    conceptGroups[base].push(c);
  }
  const bestConcept = Object.entries(conceptGroups)
    .filter(([, items]) => items.length >= 3)
    .map(([name, items]) => {
      const sorted = [...items].sort((a: any, b: any) => (Number(b.roas) || 0) - (Number(a.roas) || 0));
      return { name, items: sorted, bestRoas: Number(sorted[0].roas) || 0, count: items.length };
    })
    .sort((a, b) => b.bestRoas - a.bestRoas)[0];

  if (bestConcept) {
    const winner = bestConcept.items[0];
    cards.push({
      id: `concept-${bestConcept.name}`,
      type: "concept",
      icon: "🔄",
      headline: "Your best concept family",
      body: `The '${bestConcept.name}' concept has ${bestConcept.count} iterations. ${winner.ad_name} is the clear winner at ${bestConcept.bestRoas.toFixed(1)}x.`,
      cta: "See concept →",
      ctaAction: () => navigate(`/creatives?search=${encodeURIComponent(bestConcept.name)}`),
      priority: 5,
    });
  }

  return cards.sort((a, b) => a.priority - b.priority).slice(0, 6);
}

/* ── Component ─────────────────────────────── */

export function InsightCardsStrip({
  creatives, metrics, prevMetrics, fatigueMap, wowTrends, scaleThreshold, spendThreshold, onCreativeClick,
}: InsightCardsProps) {
  const navigate = useRoleNavigate();
  const [refreshKey, setRefreshKey] = useState(0);
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    const d = getDismissed();
    return new Set(Object.entries(d).filter(([, ts]) => Date.now() - ts < 86400000).map(([k]) => k));
  });

  const allCards = useMemo(
    () => generateInsights(creatives, metrics, prevMetrics, fatigueMap, wowTrends, scaleThreshold, spendThreshold, navigate, onCreativeClick),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [creatives, metrics, prevMetrics, fatigueMap, wowTrends, scaleThreshold, spendThreshold, refreshKey, onCreativeClick]
  );

  const visibleCards = useMemo(() => allCards.filter((c) => !dismissed.has(c.id)), [allCards, dismissed]);

  const handleDismiss = useCallback((id: string) => {
    dismissCard(id);
    setDismissed((prev) => new Set(prev).add(id));
  }, []);

  const handleRefresh = useCallback(() => {
    // Clear all dismissals and regenerate
    localStorage.removeItem(DISMISS_KEY);
    setDismissed(new Set());
    setRefreshKey((k) => k + 1);
  }, []);

  if (visibleCards.length === 0) return null;

  const CARD_STYLES: Record<InsightCard["type"], { border: string; iconBg: string }> = {
    winner: { border: "border-verdant/30", iconBg: "bg-verdant/10" },
    format: { border: "border-primary/30", iconBg: "bg-primary/10" },
    fatigue: { border: "border-gold/40", iconBg: "bg-gold/10" },
    momentum: { border: "border-verdant/30", iconBg: "bg-verdant/10" },
    opportunity: { border: "border-primary/30", iconBg: "bg-primary/10" },
    concept: { border: "border-accent-foreground/20", iconBg: "bg-accent/40" },
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-[16px] text-foreground">Insights</h2>
        <Button variant="ghost" size="sm" className="h-7 text-[11px] text-muted-foreground gap-1" onClick={handleRefresh}>
          <RefreshCw className="h-3 w-3" /> Refresh
        </Button>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin">
        {visibleCards.map((card) => {
          const style = CARD_STYLES[card.type];
          return (
            <div
              key={card.id}
              className={cn(
                "relative flex-shrink-0 w-[280px] h-[180px] rounded-lg border bg-card p-4 flex flex-col justify-between transition-shadow hover:shadow-card-hover",
                style.border
              )}
            >
              {/* Dismiss */}
              <button
                onClick={() => handleDismiss(card.id)}
                className="absolute top-2 right-2 p-1 rounded-full hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className={cn("w-7 h-7 rounded-md flex items-center justify-center text-[16px]", style.iconBg)}>
                    {card.icon}
                  </span>
                  <h3 className="font-heading text-[13px] font-semibold text-foreground leading-tight pr-5">
                    {card.headline}
                  </h3>
                </div>
                <p className="font-body text-[11px] text-muted-foreground leading-relaxed line-clamp-3">
                  {card.body}
                </p>
              </div>

              <button
                onClick={card.ctaAction}
                className="font-body text-[11px] font-medium text-primary hover:underline flex items-center gap-1 mt-auto pt-1"
              >
                {card.cta} <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
