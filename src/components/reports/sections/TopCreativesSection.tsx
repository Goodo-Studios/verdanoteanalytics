import { useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

import { fmtMetric as fmt } from "@/lib/formatters";

interface TopCreativesSectionProps {
  config: Record<string, any>;
  report: any;
  isEditing?: boolean;
  onConfigChange?: (config: Record<string, any>) => void;
}

export function TopCreativesSection({ config, report, isEditing, onConfigChange }: TopCreativesSectionProps) {
  const count = config.count || 6;
  const sortBy = config.sortBy || "spend";

  const performers = useMemo(() => {
    try {
      const parsed = JSON.parse(report.top_performers || "[]");
      const sorted = [...parsed].sort((a: any, b: any) => (Number(b[sortBy]) || 0) - (Number(a[sortBy]) || 0));
      return sorted.slice(0, count);
    } catch { return []; }
  }, [report.top_performers, count, sortBy]);

  return (
    <div className="space-y-3">
      {isEditing && (
        <div className="flex items-center gap-4 p-3 rounded-[6px] bg-muted/50 border border-border-light">
          <div className="space-y-1">
            <Label className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Show Top</Label>
            <Select value={String(count)} onValueChange={(v) => onConfigChange?.({ ...config, count: Number(v) })}>
              <SelectTrigger className="w-20 h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="3">3</SelectItem>
                <SelectItem value="6">6</SelectItem>
                <SelectItem value="9">9</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Sort By</Label>
            <Select value={sortBy} onValueChange={(v) => onConfigChange?.({ ...config, sortBy: v })}>
              <SelectTrigger className="w-28 h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="spend">Spend</SelectItem>
                <SelectItem value="roas">ROAS</SelectItem>
                <SelectItem value="cpa">CPA</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {performers.map((p: any, i: number) => (
          <div key={p.ad_id} className="flex items-center justify-between glass-panel p-3">
            <div className="flex items-center gap-3">
              <span className="font-data text-[13px] text-muted-foreground w-5">{i + 1}.</span>
              <div>
                <div className="font-body text-[13px] font-medium text-foreground">{p.ad_name}</div>
                {p.unique_code && <div className="font-data text-[11px] text-muted-foreground">{p.unique_code}</div>}
              </div>
            </div>
            <div className="flex items-center gap-5 font-data text-[13px] tabular-nums">
              <div className="text-right">
                <div className="text-[10px] text-muted-foreground uppercase">ROAS</div>
                <div className="text-foreground">{fmt(p.roas, "", "x")}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-muted-foreground uppercase">CPA</div>
                <div className="text-foreground">{fmt(p.cpa, "$")}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-muted-foreground uppercase">Spend</div>
                <div className="text-foreground">{fmt(p.spend, "$")}</div>
              </div>
            </div>
          </div>
        ))}
        {performers.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">No top performers data available.</p>
        )}
      </div>
    </div>
  );
}
