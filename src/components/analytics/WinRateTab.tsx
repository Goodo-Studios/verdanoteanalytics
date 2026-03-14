import { useMemo, useState } from "react";
import { MetricCard } from "@/components/MetricCard";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { BarChart3, TrendingUp, Target } from "lucide-react";
import { KPI_LABELS } from "@/lib/killScaleLogic";

interface WinRateTabProps {
  creatives: any[];
  roasThreshold: number;
  spendThreshold: number;
  defaultSlice?: string;
  winnerKpi?: string;
  winnerKpiDirection?: string;
  winnerKpiThreshold?: number;
}

export function WinRateTab({
  creatives, roasThreshold, spendThreshold, defaultSlice = "ad_type",
  winnerKpi = "roas", winnerKpiDirection = "gte", winnerKpiThreshold,
}: WinRateTabProps) {
  const [sliceBy, setSliceBy] = useState(defaultSlice);

  // Use the new KPI threshold, falling back to legacy roasThreshold
  const threshold = winnerKpiThreshold ?? roasThreshold;

  const winRateData = useMemo(() => {
    if (creatives.length === 0) return null;

    const isWinner = (c: any) => {
      const kpiValue = Number(c[winnerKpi]) || 0;
      const spend = Number(c.spend) || 0;
      const meetsThreshold = winnerKpiDirection === "lte"
        ? kpiValue <= threshold && kpiValue > 0
        : kpiValue >= threshold;
      return meetsThreshold && spend > spendThreshold;
    };

    const winners = creatives.filter(isWinner);
    const totalSpend = creatives.reduce((s: number, c: any) => s + (Number(c.spend) || 0), 0);
    const totalPurchaseValue = creatives.reduce((s: number, c: any) => s + (Number(c.purchase_value) || 0), 0);
    const blendedRoas = totalSpend > 0 ? totalPurchaseValue / totalSpend : 0;

    const sliceMap: Record<string, { total: number; winners: number }> = {};
    creatives.forEach((c: any) => {
      const key = c[sliceBy] || "(none)";
      if (!sliceMap[key]) sliceMap[key] = { total: 0, winners: 0 };
      sliceMap[key].total++;
      if (isWinner(c)) sliceMap[key].winners++;
    });

    const breakdown = Object.entries(sliceMap)
      .map(([name, { total, winners: w }]) => ({ name, total, winners: w, winRate: total > 0 ? (w / total) * 100 : 0 }))
      .sort((a, b) => b.winRate - a.winRate);

    return {
      total: creatives.length,
      winners: winners.length,
      winRate: ((winners.length / creatives.length) * 100).toFixed(1),
      blendedRoas: blendedRoas.toFixed(2),
      breakdown,
    };
  }, [creatives, sliceBy, winnerKpi, winnerKpiDirection, threshold, spendThreshold]);

  const kpiLabel = KPI_LABELS[winnerKpi] || winnerKpi;
  const dirSymbol = winnerKpiDirection === "lte" ? "≤" : "≥";

  return (
    <div className="space-y-4">
      <div className="flex items-stretch divide-x divide-border-light">
        <MetricCard label="Total Creatives" value={winRateData?.total || 0} icon={<BarChart3 className="h-4 w-4 text-sage" />} />
        <MetricCard label="Winners" value={winRateData?.winners || 0} icon={<TrendingUp className="h-4 w-4 text-sage" />} />
        <MetricCard label="Win Rate" value={winRateData ? `${winRateData.winRate}%` : "—"} icon={<Target className="h-4 w-4 text-sage" />} />
        <MetricCard label="Blended ROAS" value={winRateData ? `${winRateData.blendedRoas}x` : "—"} />
      </div>

      <div className="flex items-center gap-3 font-body text-[13px] text-slate">
        <span>Winner: <span className="font-data font-semibold text-charcoal">{kpiLabel} {dirSymbol} {threshold}</span> &amp; spend &gt; <span className="font-data font-semibold text-charcoal">${spendThreshold}</span></span>
      </div>

      <div className="flex items-center gap-2">
        <span className="font-body text-[13px] text-slate">Slice by:</span>
        <Select value={sliceBy} onValueChange={setSliceBy}>
          <SelectTrigger className="w-36 h-8 font-body text-[13px] text-charcoal bg-background border border-border-light"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ad_type">Type</SelectItem>
            <SelectItem value="person">Person</SelectItem>
            <SelectItem value="style">Style</SelectItem>
            <SelectItem value="hook">Hook</SelectItem>
            <SelectItem value="product">Product</SelectItem>
            <SelectItem value="theme">Theme</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {winRateData && winRateData.breakdown.length > 0 ? (
        <div className="glass-panel overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-cream-dark">
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">{sliceBy.replace("ad_", "").replace("_", " ")}</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Total</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Winners</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Win Rate</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Visual</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {winRateData.breakdown.map((row) => (
                <TableRow key={row.name} className="border-b border-border-light">
                  <TableCell className="font-body text-[13px] text-charcoal">{row.name}</TableCell>
                  <TableCell className="font-data text-[17px] font-medium text-charcoal tabular-nums text-right">{row.total}</TableCell>
                  <TableCell className="font-data text-[17px] font-medium text-charcoal tabular-nums text-right">{row.winners}</TableCell>
                  <TableCell className="font-data text-[17px] font-medium text-charcoal tabular-nums text-right">{row.winRate.toFixed(1)}%</TableCell>
                  <TableCell>
                    <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-verdant rounded-full" style={{ width: `${Math.min(row.winRate, 100)}%` }} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="glass-panel flex flex-col items-center justify-center py-16 text-center">
          <BarChart3 className="h-10 w-10 text-muted-foreground mb-3" />
          <h3 className="text-lg font-medium mb-1">No data yet</h3>
          <p className="text-sm text-muted-foreground max-w-md">Sync creatives and ensure they are tagged to see win rate analysis.</p>
        </div>
      )}
    </div>
  );
}
