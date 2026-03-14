import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface Props {
  creatives: any[];
}

interface TagGroup {
  tag: string;
  count: number;
  avgRoas: number;
  totalSpend: number;
}

export function TagPerformanceSection({ creatives }: Props) {
  const tagGroups = useMemo(() => {
    const groups: Record<string, { count: number; totalSpend: number; totalPurchaseValue: number }> = {};
    for (const c of creatives) {
      const tags = [c.ad_type, c.hook, c.style, c.theme].filter(Boolean);
      if (tags.length === 0) continue;
      for (const tag of tags) {
        if (!groups[tag]) groups[tag] = { count: 0, totalSpend: 0, totalPurchaseValue: 0 };
        groups[tag].count++;
        groups[tag].totalSpend += Number(c.spend) || 0;
        groups[tag].totalPurchaseValue += Number(c.purchase_value) || 0;
      }
    }
    return Object.entries(groups)
      .map(([tag, g]): TagGroup => ({
        tag,
        count: g.count,
        avgRoas: g.totalSpend > 0 ? g.totalPurchaseValue / g.totalSpend : 0,
        totalSpend: g.totalSpend,
      }))
      .filter((g) => g.totalSpend > 0)
      .sort((a, b) => b.avgRoas - a.avgRoas)
      .slice(0, 8);
  }, [creatives]);

  if (tagGroups.length === 0) {
    return (
      <div className="bg-white border border-border-light rounded-[8px] p-5 text-center">
        <p className="font-body text-[13px] text-sage">No tagged creatives with spend data.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-border-light rounded-[8px] p-5">
      <h2 className="font-heading text-[18px] text-forest mb-4">Tag Performance</h2>
      <div className="space-y-2">
        {tagGroups.map((g) => (
          <div key={g.tag} className="flex items-center gap-3">
            <span className="font-label text-[10px] uppercase tracking-wide bg-sage-light text-forest px-2 py-0.5 rounded-[3px] w-24 text-center truncate">{g.tag}</span>
            <div className="flex-1 h-2 rounded-full bg-cream-dark overflow-hidden">
              <div
                className={cn("h-full rounded-full", g.avgRoas >= 2 ? "bg-verdant" : g.avgRoas >= 1 ? "bg-gold" : "bg-red-500")}
                style={{ width: `${Math.min((g.avgRoas / 4) * 100, 100)}%` }}
              />
            </div>
            <span className={cn("font-data text-[17px] font-semibold tabular-nums w-14 text-right", g.avgRoas >= 2 ? "text-verdant" : g.avgRoas >= 1 ? "text-gold" : "text-red-600")}>
              {g.avgRoas.toFixed(2)}x
            </span>
            <span className="font-body text-[11px] text-slate w-10 text-right">{g.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
