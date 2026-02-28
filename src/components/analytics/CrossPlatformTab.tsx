import { useMemo, useState } from "react";
import { MetricCard } from "@/components/MetricCard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MultiLineTrendChart, type TrendLine } from "@/components/MultiLineTrendChart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface CrossPlatformTabProps {
  creatives: any[];
  trendData?: any[];
  onCreativeClick?: (c: any) => void;
}

function fmt(v: number | null | undefined, prefix = "", suffix = ""): string {
  if (v == null || isNaN(v)) return "—";
  return `${prefix}${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}${suffix}`;
}

export function CrossPlatformTab({ creatives, trendData, onCreativeClick }: CrossPlatformTabProps) {
  const [selectedMetric, setSelectedMetric] = useState("roas");

  const platformStats = useMemo(() => {
    const platforms = ["meta", "tiktok"] as const;
    return platforms.map((p) => {
      const items = creatives.filter((c) => (c.platform || "meta") === p);
      const withSpend = items.filter((c) => (Number(c.spend) || 0) > 0);
      const totalSpend = items.reduce((s, c) => s + (Number(c.spend) || 0), 0);
      const totalRevenue = items.reduce((s, c) => s + (Number(c.purchase_value) || 0), 0);
      const totalImpressions = items.reduce((s, c) => s + (Number(c.impressions) || 0), 0);
      const totalClicks = items.reduce((s, c) => s + (Number(c.clicks) || 0), 0);
      const totalPurchases = items.reduce((s, c) => s + (Number(c.purchases) || 0), 0);
      const avgRoas = withSpend.length > 0 ? withSpend.reduce((s, c) => s + (Number(c.roas) || 0), 0) / withSpend.length : 0;
      const avgCpa = totalPurchases > 0 ? totalSpend / totalPurchases : 0;
      const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
      return {
        platform: p,
        label: p === "meta" ? "Meta" : "TikTok",
        count: items.length,
        totalSpend,
        totalRevenue,
        avgRoas,
        avgCpa,
        avgCtr,
        totalImpressions,
        totalClicks,
        totalPurchases,
      };
    });
  }, [creatives]);

  // Cross-platform creatives (same ad name on both platforms)
  const crossPlatformCreatives = useMemo(() => {
    const metaMap = new Map<string, any>();
    const tiktokMap = new Map<string, any>();
    creatives.forEach((c) => {
      const key = (c.ad_name || "").toLowerCase().trim();
      if (!key) return;
      if ((c.platform || "meta") === "meta") metaMap.set(key, c);
      else if (c.platform === "tiktok") tiktokMap.set(key, c);
    });
    const matches: { name: string; meta: any; tiktok: any }[] = [];
    metaMap.forEach((metaC, key) => {
      const tiktokC = tiktokMap.get(key);
      if (tiktokC) matches.push({ name: metaC.ad_name, meta: metaC, tiktok: tiktokC });
    });
    return matches.sort((a, b) => ((Number(b.meta.spend) || 0) + (Number(b.tiktok.spend) || 0)) - ((Number(a.meta.spend) || 0) + (Number(a.tiktok.spend) || 0)));
  }, [creatives]);

  // Platform trend data
  const platformTrendData = useMemo(() => {
    if (!trendData?.length) return [];
    const byDate = new Map<string, { meta: number; tiktok: number }>();
    trendData.forEach((d: any) => {
      const date = d.date;
      if (!byDate.has(date)) byDate.set(date, { meta: 0, tiktok: 0 });
      const entry = byDate.get(date)!;
      const platform = d.platform || "meta";
      const val = Number(d[selectedMetric]) || 0;
      if (platform === "meta") entry.meta += val;
      else if (platform === "tiktok") entry.tiktok += val;
    });
    return Array.from(byDate.entries()).map(([date, vals]) => ({
      date,
      Meta: vals.meta,
      TikTok: vals.tiktok,
    })).sort((a, b) => a.date.localeCompare(b.date));
  }, [trendData, selectedMetric]);

  const meta = platformStats.find((p) => p.platform === "meta");
  const tiktok = platformStats.find((p) => p.platform === "tiktok");

  if (!tiktok || tiktok.count === 0) {
    return (
      <div className="glass-panel p-8 text-center">
        <h3 className="font-heading text-[20px] text-forest mb-2">No TikTok Data Yet</h3>
        <p className="font-body text-[14px] text-slate max-w-md mx-auto">
          Connect TikTok Ads in Account Settings and sync to see cross-platform analytics.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Platform comparison cards */}
      <div className="grid grid-cols-2 gap-4">
        {[meta, tiktok].filter(Boolean).map((p) => (
          <div key={p!.platform} className="glass-panel p-5 space-y-3">
            <div className="flex items-center gap-2">
              {p!.platform === "meta" ? (
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-blue-600" fill="currentColor"><path d="M12 2.04C6.5 2.04 2 6.53 2 12.06C2 17.06 5.66 21.21 10.44 21.96V14.96H7.9V12.06H10.44V9.85C10.44 7.34 11.93 5.96 14.22 5.96C15.31 5.96 16.45 6.15 16.45 6.15V8.62H15.19C13.95 8.62 13.56 9.39 13.56 10.18V12.06H16.34L15.89 14.96H13.56V21.96A10 10 0 0 0 22 12.06C22 6.53 17.5 2.04 12 2.04Z" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15.2a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V9.05a8.16 8.16 0 0 0 4.76 1.52V7.12a4.83 4.83 0 0 1-1-.43Z" /></svg>
              )}
              <h3 className="font-heading text-[18px] text-forest">{p!.label}</h3>
              <span className="ml-auto font-data text-[12px] text-sage">{p!.count} creatives</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="font-label text-[10px] uppercase tracking-wide text-sage">Avg ROAS</div>
                <div className="font-data text-[18px] font-semibold text-charcoal">{fmt(p!.avgRoas, "", "x")}</div>
              </div>
              <div>
                <div className="font-label text-[10px] uppercase tracking-wide text-sage">Avg CPA</div>
                <div className="font-data text-[18px] font-semibold text-charcoal">{fmt(p!.avgCpa, "$")}</div>
              </div>
              <div>
                <div className="font-label text-[10px] uppercase tracking-wide text-sage">Spend</div>
                <div className="font-data text-[18px] font-semibold text-charcoal">{fmt(p!.totalSpend, "$")}</div>
              </div>
              <div>
                <div className="font-label text-[10px] uppercase tracking-wide text-sage">CTR</div>
                <div className="font-data text-[18px] font-semibold text-charcoal">{fmt(p!.avgCtr, "", "%")}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Trend chart by platform */}
      {platformTrendData.length > 0 && (() => {
        const dates = platformTrendData.map((d) => d.date);
        const metaLine: TrendLine = { key: "meta", label: "Meta", color: "hsl(var(--primary))", values: platformTrendData.map((d) => d.Meta) };
        const tiktokLine: TrendLine = { key: "tiktok", label: "TikTok", color: "hsl(0 0% 20%)", values: platformTrendData.map((d) => d.TikTok) };
        return (
          <div className="glass-panel p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-[18px] text-forest">Platform Trends</h3>
              <Select value={selectedMetric} onValueChange={setSelectedMetric}>
                <SelectTrigger className="w-36 h-8 font-body text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="spend">Spend</SelectItem>
                  <SelectItem value="roas">ROAS</SelectItem>
                  <SelectItem value="cpa">CPA</SelectItem>
                  <SelectItem value="ctr">CTR</SelectItem>
                  <SelectItem value="impressions">Impressions</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <MultiLineTrendChart dates={dates} lines={[metaLine, tiktokLine]} />
          </div>
        );
      })()}

      {/* Cross-platform creative matches */}
      {crossPlatformCreatives.length > 0 && (
        <div className="glass-panel p-5 space-y-3">
          <h3 className="font-heading text-[18px] text-forest">Cross-Platform Creatives</h3>
          <p className="font-body text-[13px] text-slate">
            Creatives running on both Meta and TikTok (matched by ad name).
          </p>
          <div className="rounded-md border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="font-label text-[10px] uppercase tracking-wide">Creative</TableHead>
                  <TableHead className="font-label text-[10px] uppercase tracking-wide text-center">Meta ROAS</TableHead>
                  <TableHead className="font-label text-[10px] uppercase tracking-wide text-center">TikTok ROAS</TableHead>
                  <TableHead className="font-label text-[10px] uppercase tracking-wide text-center">Meta Spend</TableHead>
                  <TableHead className="font-label text-[10px] uppercase tracking-wide text-center">TikTok Spend</TableHead>
                  <TableHead className="font-label text-[10px] uppercase tracking-wide text-center">Winner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {crossPlatformCreatives.slice(0, 20).map((match) => {
                  const metaRoas = Number(match.meta.roas) || 0;
                  const tiktokRoas = Number(match.tiktok.roas) || 0;
                  const winner = metaRoas > tiktokRoas ? "Meta" : tiktokRoas > metaRoas ? "TikTok" : "Tie";
                  return (
                    <TableRow key={match.name} className="cursor-pointer hover:bg-muted/30" onClick={() => onCreativeClick?.(match.meta)}>
                      <TableCell className="font-body text-[13px] text-charcoal max-w-[250px] truncate">{match.name}</TableCell>
                      <TableCell className="font-data text-[14px] font-semibold text-center tabular-nums">{fmt(metaRoas, "", "x")}</TableCell>
                      <TableCell className="font-data text-[14px] font-semibold text-center tabular-nums">{fmt(tiktokRoas, "", "x")}</TableCell>
                      <TableCell className="font-data text-[13px] text-center tabular-nums">{fmt(Number(match.meta.spend), "$")}</TableCell>
                      <TableCell className="font-data text-[13px] text-center tabular-nums">{fmt(Number(match.tiktok.spend), "$")}</TableCell>
                      <TableCell className="text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${winner === "Meta" ? "bg-blue-50 text-blue-700" : winner === "TikTok" ? "bg-charcoal/10 text-charcoal" : "bg-muted text-slate"}`}>
                          {winner}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
