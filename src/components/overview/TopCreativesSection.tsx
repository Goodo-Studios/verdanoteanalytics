import { useMemo } from "react";
import { cn } from "@/lib/utils";

function fmt$(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

interface Props {
  creatives: any[];
  count?: number;
  sortBy?: string;
  onCreativeClick?: (creative: any) => void;
}

export function TopCreativesSection({ creatives, count = 5, sortBy = "roas", onCreativeClick }: Props) {
  const top = useMemo(() => {
    const qualified = creatives.filter((c: any) => (Number(c.spend) || 0) > 0);
    const sorted = [...qualified].sort((a, b) => {
      const va = Number(a[sortBy]) || 0;
      const vb = Number(b[sortBy]) || 0;
      return vb - va;
    });
    return sorted.slice(0, count);
  }, [creatives, count, sortBy]);

  if (top.length === 0) {
    return <p className="font-body text-[13px] text-sage py-4 text-center">No creatives with spend data.</p>;
  }

  return (
    <div className="bg-white border border-border-light rounded-[8px] p-5">
      <h2 className="font-heading text-[18px] text-forest mb-4">Top Creatives by {sortBy.toUpperCase()}</h2>
      <div className="space-y-3">
        {top.map((c: any, i: number) => (
          <div key={c.ad_id} className={cn("flex items-center gap-3", onCreativeClick && "cursor-pointer hover:bg-sage-light/50 -mx-2 px-2 py-1 rounded-[6px] transition-colors")} onClick={() => onCreativeClick?.(c)}>
            <span className="font-data text-[14px] font-semibold text-sage w-5 text-right">{i + 1}</span>
            {c.thumbnail_url && (
              <img src={c.thumbnail_url} alt="" className="h-10 w-10 rounded-[4px] object-cover flex-shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-body text-[13px] font-medium text-charcoal truncate">{c.ad_name}</p>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="font-data text-[12px] text-verdant font-semibold">{(Number(c.roas) || 0).toFixed(2)}x</span>
                <span className="font-data text-[12px] text-slate">{fmt$(Number(c.spend) || 0)}</span>
                <span className="font-data text-[12px] text-slate">{fmt$(Number(c.cpa) || 0)} CPA</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
