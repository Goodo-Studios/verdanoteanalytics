import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Lightbulb, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { calculateBenchmarks, type MetricLevel } from "@/lib/iterationDiagnostics";

interface Props {
  creative: any;
  allCreatives: any[];
}

function LevelIcon({ level }: { level: MetricLevel }) {
  if (level === "strong") return <TrendingUp className="h-3 w-3 text-success" />;
  if (level === "weak") return <TrendingDown className="h-3 w-3 text-destructive" />;
  return <Minus className="h-3 w-3 text-muted-foreground" />;
}

function levelColor(level: MetricLevel) {
  if (level === "strong") return "bg-success/10 text-success border-success/20";
  if (level === "weak") return "bg-destructive/10 text-destructive border-destructive/20";
  return "bg-muted text-muted-foreground";
}

function levelFor(value: number, p25: number, p75: number): MetricLevel {
  if (value >= p75) return "strong";
  if (value <= p25) return "weak";
  return "average";
}

export function CreativeIterationAnalysis({ creative, allCreatives }: Props) {
  const analysis = useMemo(() => {
    if (allCreatives.length < 3) return null;
    
    const benchmarks = calculateBenchmarks(allCreatives);
    const spend = Number(creative.spend) || 0;
    const hookRate = Number(creative.thumb_stop_rate) || 0;
    const holdRate = Number(creative.hold_rate) || 0;
    const ctr = Number(creative.ctr) || 0;
    const roas = Number(creative.roas) || 0;
    const cpa = Number(creative.cpa) || 0;

    const adType = (creative.ad_type || "").toLowerCase();
    const adName = (creative.ad_name || "").toLowerCase();
    const isImage = adType === "image" || adType === "carousel" || adType === "static" ||
      adName.includes("static") ||
      (adType !== "video" && hookRate === 0 && holdRate === 0);

    const hookLevel: MetricLevel = isImage ? "average" : levelFor(hookRate, benchmarks.hookRate.p25, benchmarks.hookRate.p75);
    const holdLevel: MetricLevel = isImage ? "average" : levelFor(holdRate, benchmarks.holdRate.p25, benchmarks.holdRate.p75);
    const ctrLevel = levelFor(ctr, benchmarks.ctr.p25, benchmarks.ctr.p75);

    // Tag-based suggestions
    const tags = {
      hook: creative.hook || null,
      style: creative.style || null,
      person: creative.person || null,
      product: creative.product || null,
      theme: creative.theme || null,
    };

    // Find best-performing tags from account data
    const tagInsights: string[] = [];
    for (const [tagKey, tagValue] of Object.entries(tags)) {
      if (!tagValue) continue;
      const sameTag = allCreatives.filter((c: any) => c[tagKey] === tagValue && (Number(c.spend) || 0) > 0);
      if (sameTag.length < 2) continue;
      const avgRoas = sameTag.reduce((s: number, c: any) => s + (Number(c.roas) || 0), 0) / sameTag.length;
      const avgCtr = sameTag.reduce((s: number, c: any) => s + (Number(c.ctr) || 0), 0) / sameTag.length;
      
      const label = tagKey.charAt(0).toUpperCase() + tagKey.slice(1);
      if (avgRoas > roas * 1.2 && roas > 0) {
        tagInsights.push(`Other "${tagValue}" ${label} ads average ${avgRoas.toFixed(2)}x ROAS — this ad underperforms the group.`);
      } else if (roas > avgRoas * 1.2 && avgRoas > 0) {
        tagInsights.push(`This ad outperforms other "${tagValue}" ${label} ads (avg ${avgRoas.toFixed(2)}x ROAS) — a candidate for scaling.`);
      }
    }

    // Performance-based recommendations
    const recommendations: string[] = [];
    if (!isImage) {
      if (hookLevel === "weak") recommendations.push("Hook is below the 25th percentile. Test a new opening — different first frame, text overlay, or pattern interrupt.");
      if (hookLevel === "strong" && holdLevel === "weak") recommendations.push("Strong hook but viewers drop off. Tighten pacing in the middle section or restructure the body.");
      if (hookLevel === "strong" && holdLevel === "strong" && ctrLevel === "weak") recommendations.push("Great watch-through but low clicks. Test a different end card, CTA text, or offer framing.");
      if (hookLevel === "weak" && holdLevel === "weak") recommendations.push("Both hook and body are underperforming. Consider a full creative rework with a new concept.");
    } else {
      if (ctrLevel === "weak") recommendations.push("CTR is below the 25th percentile. Test different headlines, copy, or visual hierarchy.");
      if (ctrLevel === "strong") recommendations.push("Strong CTR — this creative format is working. Test variations with different offers or products.");
    }

    if (spend < 100) {
      recommendations.push("Less than $100 in spend — more data needed before drawing conclusions.");
    }

    // Replication suggestions for strong performers
    if (hookLevel === "strong" && !isImage) recommendations.push("Replicate: Use this hook style across new concepts to maintain strong attention capture.");
    if (ctrLevel === "strong") recommendations.push("Replicate: This CTA approach drives clicks — apply similar framing to underperforming ads.");

    return {
      isImage,
      hookRate, holdRate, ctr,
      hookLevel, holdLevel, ctrLevel,
      benchmarks,
      recommendations,
      tagInsights,
      spend,
    };
  }, [creative, allCreatives]);

  if (!analysis) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Lightbulb className="h-4 w-4 text-primary" />
          <h3 className="font-heading text-[15px] text-foreground">Iteration Analysis</h3>
        </div>
        <p className="text-xs text-muted-foreground">Need at least 3 creatives with spend to generate analysis.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Iteration Analysis</h3>
      </div>

      {/* Performance vs benchmarks */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {!analysis.isImage && (
          <>
            <div className="rounded-md border p-2 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Hook</span>
                <LevelIcon level={analysis.hookLevel} />
              </div>
              <p className="font-data text-[17px] font-semibold text-foreground">{analysis.hookRate.toFixed(1)}%</p>
              <Badge variant="outline" className={`text-[10px] ${levelColor(analysis.hookLevel)}`}>
                {analysis.hookLevel}
              </Badge>
            </div>
            <div className="rounded-md border p-2 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Hold</span>
                <LevelIcon level={analysis.holdLevel} />
              </div>
              <p className="font-data text-[17px] font-semibold text-foreground">{analysis.holdRate.toFixed(1)}%</p>
              <Badge variant="outline" className={`text-[10px] ${levelColor(analysis.holdLevel)}`}>
                {analysis.holdLevel}
              </Badge>
            </div>
          </>
        )}
        <div className={`rounded-md border p-2 space-y-1 ${analysis.isImage ? "col-span-3" : ""}`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">CTR</span>
            <LevelIcon level={analysis.ctrLevel} />
          </div>
          <p className="font-data text-[17px] font-semibold text-foreground">{analysis.ctr.toFixed(2)}%</p>
          <Badge variant="outline" className={`text-[10px] ${levelColor(analysis.ctrLevel)}`}>
            {analysis.ctrLevel}
          </Badge>
        </div>
      </div>

      {/* Recommendations */}
      {analysis.recommendations.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Recommendations</p>
          <ul className="space-y-1.5">
            {analysis.recommendations.map((r, i) => (
              <li key={i} className="text-xs leading-relaxed flex gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Tag insights */}
      {analysis.tagInsights.length > 0 && (
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Tag Comparisons</p>
          <ul className="space-y-1.5">
            {analysis.tagInsights.map((t, i) => (
              <li key={i} className="text-xs leading-relaxed flex gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
