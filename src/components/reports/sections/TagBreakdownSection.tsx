import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  readReportSnapshot,
  TAG_BREAKDOWN_FIELDS,
  type TagBreakdownField,
} from "../../../../supabase/functions/_shared/report-snapshot.ts";

interface TagBreakdownSectionProps {
  config: Record<string, any>;
  report: any;
  isEditing?: boolean;
  onConfigChange?: (config: Record<string, any>) => void;
}

const TAG_FIELDS: { value: TagBreakdownField; label: string }[] = [
  { value: "hook", label: "Hook Type" },
  { value: "ad_type", label: "Format" },
  { value: "style", label: "Creative Type" },
  { value: "person", label: "Person" },
];

// The breakdown groups the report's own creatives by the picked field, from the numbers saved
// with the report, so it never changes after the report is generated (Matthew's decision 17).
export function TagBreakdownSection({ config, report, isEditing, onConfigChange }: TagBreakdownSectionProps) {
  const tagField: TagBreakdownField = (TAG_BREAKDOWN_FIELDS as readonly string[]).includes(config.tagField)
    ? config.tagField
    : "hook";
  const fieldLabel = TAG_FIELDS.find((f) => f.value === tagField)?.label || tagField;
  const breakdown = readReportSnapshot(report?.snapshot)?.tag_mix_by_field?.[tagField] ?? null;
  const maxPct = Math.max(...(breakdown ?? []).map((b) => b.spendPct), 1);

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
      {breakdown && breakdown.length > 0 ? (
        <div className="space-y-2">
          <div className="font-label text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
            Breakdown by {fieldLabel}
          </div>
          {breakdown.map((b) => (
            <div key={b.tag} data-testid="tag-breakdown-row" data-tag={b.tag} className="flex items-center gap-3">
              <span className="font-body text-[13px] text-foreground w-32 shrink-0 truncate">{b.tag}</span>
              <div className="flex-1 h-6 bg-muted/50 rounded-[4px] overflow-hidden">
                <div
                  className="h-full bg-primary/60 rounded-[4px] flex items-center px-2"
                  style={{ width: `${(b.spendPct / maxPct) * 100}%`, minWidth: 24 }}
                >
                  <span className="font-data text-[11px] text-primary-foreground font-medium">{b.spendPct.toFixed(0)}%</span>
                </div>
              </div>
              <span className="font-data text-[12px] text-muted-foreground w-28 shrink-0 text-right tabular-nums">
                {b.roas == null ? "n/a" : `${b.roas.toFixed(2)}x`} · {b.count} ad{b.count === 1 ? "" : "s"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="glass-panel flex items-center justify-center py-8">
          <p className="text-sm text-muted-foreground">
            {breakdown
              ? "No tag breakdown data available for this report."
              : "This report was saved before tag breakdowns were stored. Generate a new report to see it."}
          </p>
        </div>
      )}
    </div>
  );
}
