import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { fmtMetric as fmt } from "@/lib/formatters";

interface IterationsSectionProps {
  config: Record<string, any>;
  report: any;
  isEditing?: boolean;
  onConfigChange?: (config: Record<string, any>) => void;
}

export function IterationsSection({ config, report }: IterationsSectionProps) {
  const count = config.count || 5;

  const { suggestions, totalCount } = useMemo(() => {
    try {
      const parsed = JSON.parse(report.iteration_suggestions || "[]");
      return { suggestions: parsed.slice(0, count), totalCount: parsed.length };
    } catch {
      return { suggestions: [], totalCount: 0 };
    }
  }, [report.iteration_suggestions, count]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="font-data text-[11px]">
          {totalCount} iteration {totalCount === 1 ? "opportunity" : "opportunities"}
        </Badge>
      </div>
      <div className="space-y-2">
        {suggestions.map((s: any, i: number) => (
          <div key={s.ad_id || i} className="glass-panel p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="font-data text-[13px] text-muted-foreground w-5">{i + 1}.</span>
                <div>
                  <span className="font-body text-[13px] font-medium text-foreground">{s.ad_name}</span>
                  {s.unique_code && <span className="font-data text-[11px] text-muted-foreground ml-2">{s.unique_code}</span>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {s.label && <Badge variant="secondary" className="text-[10px] font-medium">{s.label}</Badge>}
                <span className="font-data text-[13px] text-muted-foreground tabular-nums">{fmt(s.spend, "$")}</span>
              </div>
            </div>
            {s.recommendation && (
              <p className="font-body text-[12px] text-muted-foreground leading-relaxed pl-8">
                {s.recommendation}
              </p>
            )}
          </div>
        ))}
        {suggestions.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">No iteration suggestions available.</p>
        )}
      </div>
    </div>
  );
}
