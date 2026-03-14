import { useKillScaleLogic, type KillScaleConfig, KPI_LABELS } from "@/lib/killScaleLogic";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { fmtMetric, fmt$ } from "@/lib/formatters";

interface KillScaleListProps {
  creatives: any[];
  config: KillScaleConfig;
  variant: "kill" | "scale";
  onCreativeClick?: (creative: any) => void;
}

const KPI_SUFFIXES: Record<string, { prefix: string; suffix: string }> = {
  roas: { prefix: "", suffix: "x" },
  cpa: { prefix: "$", suffix: "" },
  ctr: { prefix: "", suffix: "%" },
  thumb_stop_rate: { prefix: "", suffix: "%" },
};

export function KillScaleList({ creatives, config, variant, onCreativeClick }: KillScaleListProps) {
  const results = useKillScaleLogic(creatives, config);
  const items = variant === "kill" ? results.kill : results.scale;
  const kpiLabel = results.kpiLabel;

  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground font-body text-sm">
        No creatives in the <span className="font-semibold">{variant}</span> zone right now.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="font-body text-[13px] text-muted-foreground">
        {items.length} creative{items.length !== 1 ? "s" : ""} in the{" "}
        <Badge variant={variant === "kill" ? "destructive" : "default"} className="text-[10px] px-1.5 py-0">
          {variant.toUpperCase()}
        </Badge>{" "}
        zone.
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="font-label text-[11px]">Creative</TableHead>
            <TableHead className="font-label text-[11px] text-right">Spend</TableHead>
            <TableHead className="font-label text-[11px] text-right">{kpiLabel}</TableHead>
            <TableHead className="font-label text-[11px]">Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((c) => (
            <TableRow
              key={c.ad_id}
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => onCreativeClick?.(c)}
            >
              <TableCell className="font-body text-[12px] max-w-[260px] truncate">
                {c.ad_name || c.ad_id}
              </TableCell>
              <TableCell className="font-data text-[12px] text-right tabular-nums">
                {fmt$(Number(c.spend) || 0)}
              </TableCell>
              <TableCell className="font-data text-[12px] text-right tabular-nums">
                {(() => {
                  const kpiVal = c[config.winnerKpi];
                  const units = KPI_SUFFIXES[config.winnerKpi] || { prefix: "", suffix: "" };
                  return kpiVal == null ? "—" : `${units.prefix}${Number(kpiVal).toFixed(2)}${units.suffix}`;
                })()}
              </TableCell>
              <TableCell className="font-body text-[11px] text-muted-foreground max-w-[200px] truncate">
                {c.reason}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
