import { useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface TagBreakdownSectionProps {
  config: Record<string, any>;
  report: any;
  isEditing?: boolean;
  onConfigChange?: (config: Record<string, any>) => void;
}

const TAG_FIELDS = [
  { value: "hook", label: "Hook Type" },
  { value: "ad_type", label: "Format" },
  { value: "style", label: "Style" },
  { value: "person", label: "Person" },
];

export function TagBreakdownSection({ config, report, isEditing, onConfigChange }: TagBreakdownSectionProps) {
  const tagField = config.tagField || "hook";
  const fieldLabel = TAG_FIELDS.find((f) => f.value === tagField)?.label || tagField;

  const breakdown = useMemo(() => {
    try {
      const performers = JSON.parse(report.top_performers || "[]");
      const buckets = new Map<string, { totalRoas: number; count: number; totalSpend: number }>();
      for (const p of performers) {
        // We only have top_performers data, which doesn't carry tags.
        // For a richer implementation you'd query creatives. For now show a placeholder.
      }
      // Placeholder: show from iteration_suggestions which have labels
      const suggestions = JSON.parse(report.iteration_suggestions || "[]");
      for (const s of suggestions) {
        const key = s.label || "Other";
        const existing = buckets.get(key) || { totalRoas: 0, count: 0, totalSpend: 0 };
        existing.count++;
        existing.totalSpend += s.spend || 0;
        buckets.set(key, existing);
      }
      return [...buckets.entries()]
        .map(([tag, data]) => ({ tag, count: data.count, avgSpend: data.totalSpend / data.count }))
        .sort((a, b) => b.count - a.count);
    } catch { return []; }
  }, [report, tagField]);

  const maxCount = Math.max(...breakdown.map((b) => b.count), 1);

  return (
    <div className="space-y-3">
      {isEditing && (
        <div className="p-3 rounded-[6px] bg-muted/50 border border-border-light">
          <Label className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Tag Category</Label>
          <Select value={tagField} onValueChange={(v) => onConfigChange?.({ ...config, tagField: v })}>
            <SelectTrigger className="w-32 h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TAG_FIELDS.map((f) => (
                <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {breakdown.length > 0 ? (
        <div className="space-y-2">
          <div className="font-label text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
            Breakdown by {fieldLabel}
          </div>
          {breakdown.map((b) => (
            <div key={b.tag} className="flex items-center gap-3">
              <span className="font-body text-[13px] text-foreground w-32 shrink-0 truncate">{b.tag}</span>
              <div className="flex-1 h-6 bg-muted/50 rounded-[4px] overflow-hidden">
                <div
                  className="h-full bg-primary/60 rounded-[4px] flex items-center px-2"
                  style={{ width: `${(b.count / maxCount) * 100}%`, minWidth: 24 }}
                >
                  <span className="font-data text-[11px] text-primary-foreground font-medium">{b.count}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="glass-panel flex items-center justify-center py-8">
          <p className="text-sm text-muted-foreground">No tag breakdown data available for this report.</p>
        </div>
      )}
    </div>
  );
}
