import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Activity, TrendingDown, TrendingUp, AlertTriangle, CheckCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAccountContext } from "@/contexts/AccountContext";

interface DiagnosticResult {
  account_name: string;
  date_range: { since: string; until: string; days: number };
  attribution: { click_window: number | null; view_window: number | null };
  meta: { spend: number; impressions: number; purchases: number; purchase_value: number; roas: number; ad_count: number | null };
  verdanote_snapshot: { spend: number; impressions: number; purchases: number; purchase_value: number; roas: number; creative_count: number };
  verdanote_daily: { spend: number; impressions: number; purchases: number; purchase_value: number; roas: number; ad_count: number };
  delta_snapshot: { spend: number; spend_pct: number; impressions: number; ad_count: number | null };
  delta_daily: { spend: number; spend_pct: number; impressions: number; ad_count: number | null };
}

function MetricRow({ label, metaVal, snapshotVal, dailyVal, format = "number" }: {
  label: string; metaVal: number | null; snapshotVal: number | null; dailyVal: number | null; format?: "number" | "currency" | "pct";
}) {
  if (metaVal === null && snapshotVal === null && dailyVal === null) return null;
  const mv = metaVal ?? 0;
  const dv = dailyVal ?? 0;
  const delta = dv - mv;
  const deltaPct = mv > 0 ? (delta / mv) * 100 : 0;

  const fmt = (v: number) => {
    if (format === "currency") return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (format === "pct") return `${v.toFixed(2)}%`;
    return v.toLocaleString("en-US");
  };

  const isOk = Math.abs(deltaPct) < 2;
  const isWarning = Math.abs(deltaPct) >= 2 && Math.abs(deltaPct) < 10;

  return (
    <div className="grid grid-cols-5 gap-2 py-2 border-b border-border/50 last:border-0 items-center">
      <span className="font-label text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-data text-[15px] text-foreground text-right tabular-nums">{fmt(mv)}</span>
      <span className="font-data text-[15px] text-muted-foreground text-right tabular-nums">{fmt(snapshotVal ?? 0)}</span>
      <span className="font-data text-[15px] text-foreground text-right tabular-nums font-semibold">{fmt(dv)}</span>
      <span className={`font-data text-[12px] text-right tabular-nums flex items-center justify-end gap-1 ${isOk ? "text-emerald-600" : isWarning ? "text-amber-600" : "text-destructive"}`}>
        {isOk ? <CheckCircle className="h-3 w-3" /> : isWarning ? <AlertTriangle className="h-3 w-3" /> : delta < 0 ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
        {delta >= 0 ? "+" : ""}{fmt(delta)} ({deltaPct >= 0 ? "+" : ""}{deltaPct.toFixed(1)}%)
      </span>
    </div>
  );
}

export function SpendDiagnosticSection() {
  const { selectedAccount } = useAccountContext();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runDiagnostic = async () => {
    if (!selectedAccount) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await apiFetch("spend-diagnostic", "", {
        method: "POST",
        body: JSON.stringify({ account_id: selectedAccount.id }),
      });
      setResult(data);
    } catch (err: any) {
      setError(err.message || "Failed to run diagnostic");
    } finally {
      setLoading(false);
    }
  };

  const dailyDeltaPct = result ? Math.abs(result.delta_daily.spend_pct) : 0;

  return (
    <section className="glass-panel p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-[20px] text-foreground">Spend Diagnostic</h2>
          <p className="font-body text-[13px] text-muted-foreground font-light mt-1">
            Compare Verdanote totals against Meta's account-level data. "Daily" column uses accumulated daily metrics (accurate). "Snapshot" shows the creatives table (may drift).
          </p>
        </div>
        <Button
          onClick={runDiagnostic}
          disabled={loading || !selectedAccount}
          className="gap-1.5"
          size="sm"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
          Run Diagnostic
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive rounded-md px-4 py-3 font-body text-[13px]">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-body text-[13px] text-muted-foreground">
              {result.account_name} · {result.date_range.since} → {result.date_range.until} ({result.date_range.days}d)
            </span>
          </div>

          <div className="rounded-md border border-border overflow-hidden">
            <div className="grid grid-cols-5 gap-2 px-4 py-2 bg-muted/50">
              <span className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Metric</span>
              <span className="font-label text-[10px] uppercase tracking-wider text-muted-foreground text-right">Meta</span>
              <span className="font-label text-[10px] uppercase tracking-wider text-muted-foreground text-right">Snapshot</span>
              <span className="font-label text-[10px] uppercase tracking-wider text-muted-foreground text-right font-bold">Daily ✓</span>
              <span className="font-label text-[10px] uppercase tracking-wider text-muted-foreground text-right">Daily vs Meta</span>
            </div>
            <div className="px-4">
              <MetricRow label="Spend" metaVal={result.meta.spend} snapshotVal={result.verdanote_snapshot.spend} dailyVal={result.verdanote_daily.spend} format="currency" />
              <MetricRow label="Impressions" metaVal={result.meta.impressions} snapshotVal={result.verdanote_snapshot.impressions} dailyVal={result.verdanote_daily.impressions} />
              <MetricRow label="Purchases" metaVal={result.meta.purchases} snapshotVal={result.verdanote_snapshot.purchases} dailyVal={result.verdanote_daily.purchases} />
              <MetricRow label="Revenue" metaVal={result.meta.purchase_value} snapshotVal={result.verdanote_snapshot.purchase_value} dailyVal={result.verdanote_daily.purchase_value} format="currency" />
              <MetricRow label="ROAS" metaVal={result.meta.roas} snapshotVal={result.verdanote_snapshot.roas} dailyVal={result.verdanote_daily.roas} />
              <div className="grid grid-cols-5 gap-2 py-2 items-center">
                <span className="font-label text-[11px] uppercase tracking-wide text-muted-foreground">Ad Count</span>
                <span className="font-data text-[13px] text-foreground text-right tabular-nums">{result.meta.ad_count ?? "—"}</span>
                <span className="font-data text-[13px] text-muted-foreground text-right tabular-nums">{result.verdanote_snapshot.creative_count}</span>
                <span className="font-data text-[13px] text-foreground text-right tabular-nums font-semibold">{result.verdanote_daily.ad_count}</span>
                <span className={`font-data text-[12px] text-right tabular-nums ${result.delta_daily.ad_count === 0 ? "text-emerald-600" : "text-amber-600"}`}>
                  {result.meta.ad_count !== null ? `${(result.delta_daily.ad_count ?? 0) >= 0 ? "+" : ""}${result.delta_daily.ad_count}` : "—"}
                </span>
              </div>
            </div>
          </div>

          {dailyDeltaPct >= 2 && (
            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-md px-4 py-3 space-y-2">
              <p className="font-label text-[12px] font-semibold text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                Daily metrics still diverge from Meta ({result.delta_daily.spend_pct.toFixed(1)}%)
              </p>
              <ul className="space-y-1 font-body text-[12px] text-amber-700 dark:text-amber-300">
                {result.delta_daily.spend < 0 && (
                  <>
                    <li className="flex items-start gap-1.5">• Phase 4 (daily breakdowns) may not have completed — try a full re-sync with "daily" mode</li>
                    {(result.delta_daily.ad_count ?? 0) < 0 && (
                      <li className="flex items-start gap-1.5">• Meta reports {result.meta.ad_count} ads but daily metrics only cover {result.verdanote_daily.ad_count} — {Math.abs(result.delta_daily.ad_count ?? 0)} ads missing daily data</li>
                    )}
                    <li className="flex items-start gap-1.5">• Deleted/archived ads may not appear in ad-level queries but count at the account level</li>
                    <li className="flex items-start gap-1.5">• Attribution window mismatch between Verdanote settings and Ads Manager view</li>
                  </>
                )}
                {result.delta_daily.spend > 0 && (
                  <li className="flex items-start gap-1.5">• Verdanote daily total exceeds Meta — possible duplicate rows or overlapping sync windows</li>
                )}
              </ul>
            </div>
          )}

          {dailyDeltaPct < 2 && (
            <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-md px-4 py-3">
              <p className="font-body text-[13px] text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                <CheckCircle className="h-4 w-4" />
                Daily metrics are within 2% of Meta — data is healthy.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
