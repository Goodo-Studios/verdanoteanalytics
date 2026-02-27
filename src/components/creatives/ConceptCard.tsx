import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ConceptGroup } from "@/lib/conceptGrouping";
import { cn } from "@/lib/utils";
import { ImageIcon } from "lucide-react";
import { GradeBadge } from "./GradeBadge";
import { gradeOrder, type GradeInfo } from "@/lib/creativeGrading";

interface ConceptCardProps {
  concept: ConceptGroup;
  gradeMap?: Map<string, GradeInfo>;
}

export function ConceptCard({ concept, gradeMap }: ConceptCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { name, iterations, totalSpend, totalPurchases, blendedRoas, best, worst } = concept;

  const sortedIterations = [...iterations].sort((a, b) => (Number(b.roas) || 0) - (Number(a.roas) || 0));
  const thumbs = iterations.filter(c => c.thumbnail_url || c.video_url).slice(0, 4);

  // Best grade across iterations
  const bestGrade = gradeMap ? iterations.reduce<GradeInfo | null>((best, c) => {
    const g = gradeMap.get(c.ad_id);
    if (!g) return best;
    if (!best || gradeOrder(g.grade) < gradeOrder(best.grade)) return g;
    return best;
  }, null) : null;

  return (
    <div className="rounded-card border border-border-light bg-card shadow-card transition-shadow duration-200 hover:shadow-card-hover">
      {/* Header */}
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="w-full text-left p-4 flex items-start gap-4"
      >
        {/* Mini thumbnails */}
        {thumbs.length > 0 && (
          <div className="flex -space-x-2 shrink-0">
            {thumbs.map((c: any, i: number) => (
              <div key={c.ad_id} className="h-10 w-10 rounded-md border border-border-light overflow-hidden bg-muted" style={{ zIndex: thumbs.length - i }}>
                {c.thumbnail_url ? <img src={c.thumbnail_url} alt={c.ad_name} className="h-full w-full object-cover" /> : <ImageIcon className="h-4 w-4 text-muted-foreground m-auto mt-3" />}
              </div>
            ))}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="font-heading text-[15px] text-foreground truncate">{name}</h3>
              {bestGrade && <GradeBadge grade={bestGrade.grade} />}
            </div>
            <div className="flex items-center gap-1 text-muted-foreground shrink-0">
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
          </div>
          <p className="font-body text-[12px] text-muted-foreground mt-0.5">
            {iterations.length} version{iterations.length !== 1 ? "s" : ""}
          </p>
        </div>
      </button>

      {/* Metrics row */}
      <div className="px-4 pb-3 flex items-stretch divide-x divide-border-light text-center">
        <MetricCell label="Blended ROAS" value={`${blendedRoas.toFixed(2)}x`} highlight={blendedRoas >= 2 ? "positive" : blendedRoas < 1 ? "negative" : undefined} />
        <MetricCell label="Total Spend" value={`$${totalSpend.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} />
        <MetricCell label="Purchases" value={totalPurchases.toLocaleString()} />
      </div>

      {/* Best / Worst */}
      {(best || worst) && (
        <div className="px-4 pb-3 flex gap-3 text-[12px] font-body">
          {best && (
            <div className="flex-1 min-w-0">
              <span className="text-muted-foreground">Best: </span>
              <span className="text-success font-medium truncate">{best.ad_name} ({(Number(best.roas) || 0).toFixed(2)}x)</span>
            </div>
          )}
          {worst && (
            <div className="flex-1 min-w-0">
              <span className="text-muted-foreground">Worst: </span>
              <span className="text-destructive font-medium truncate">{worst.ad_name} ({(Number(worst.roas) || 0).toFixed(2)}x)</span>
            </div>
          )}
        </div>
      )}

      {/* Expanded iterations */}
      {expanded && (
        <div className="border-t border-border-light">
          <table className="w-full text-[12px] font-body">
            <thead>
              <tr className="text-muted-foreground font-label text-[10px] uppercase tracking-wider">
                <th className="text-left py-2 px-4">Ad Name</th>
                <th className="text-right py-2 px-3">ROAS</th>
                <th className="text-right py-2 px-3">Spend</th>
                <th className="text-right py-2 px-3">CTR</th>
              </tr>
            </thead>
            <tbody>
              {sortedIterations.map((c: any) => (
                <tr key={c.ad_id} className="border-t border-border-light hover:bg-muted/40">
                  <td className="py-2 px-4 flex items-center gap-2 min-w-0">
                    <div className="h-7 w-7 rounded overflow-hidden bg-muted shrink-0">
                      {c.thumbnail_url ? <img src={c.thumbnail_url} alt={c.ad_name} className="h-full w-full object-cover" /> : <ImageIcon className="h-3.5 w-3.5 text-muted-foreground m-auto mt-1.5" />}
                    </div>
                    <span className="truncate text-foreground">{c.ad_name}</span>
                  </td>
                  <td className={cn(
                    "text-right py-2 px-3 font-data font-medium",
                    (Number(c.roas) || 0) >= 2 ? "text-success" : (Number(c.roas) || 0) < 1 ? "text-destructive" : "text-foreground"
                  )}>
                    {(Number(c.roas) || 0).toFixed(2)}x
                  </td>
                  <td className="text-right py-2 px-3 font-data text-foreground">
                    ${(Number(c.spend) || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </td>
                  <td className="text-right py-2 px-3 font-data text-foreground">
                    {(Number(c.ctr) || 0).toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MetricCell({ label, value, highlight }: { label: string; value: string; highlight?: "positive" | "negative" }) {
  return (
    <div className="flex-1 py-1 px-3">
      <p className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        "font-data text-[18px] font-semibold leading-tight mt-0.5",
        highlight === "positive" ? "text-success" : highlight === "negative" ? "text-destructive" : "text-foreground"
      )}>
        {value}
      </p>
    </div>
  );
}
