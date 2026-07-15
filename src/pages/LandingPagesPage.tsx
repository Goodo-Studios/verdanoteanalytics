// Landing Pages report (Creative Terminal — Phase 1, Feature 1), US-003.
//
// Every destination an account's ads point to, consolidated across duplicate /
// UTM-variant links (server-side, by destination_key), with per-destination
// spend/ROAS/CPA/CVR/AOV and deltas vs the report average. Reads through the
// session-authed `landing-pages` edge function (getLandingPages) — aggregation
// lives entirely in the SQL RPC. Builder-account-first: gated to the builder role
// + the Goodo account until rollout (US-005).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccountContext } from "@/contexts/AccountContext";
import { useAuth } from "@/contexts/AuthContext";
import { getLandingPages, type LandingPageRow } from "@/lib/api";
import { downloadCSV } from "@/lib/csv";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { LandingPageCreativesDialog } from "@/components/landing-pages/LandingPageCreativesDialog";

const BUILDER_ACCOUNT_ID = "act_782159176742035";
const WINDOWS = [7, 14, 30, 90] as const;

type SortKey = "spend" | "roas" | "cpa" | "cvr" | "purchases";
const SORT_LABELS: Record<SortKey, string> = {
  spend: "Spend", roas: "ROAS", cpa: "CPA", cvr: "CVR", purchases: "Purchases",
};

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
const usd = (n: number) =>
  `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const num = (n: number) => (n || 0).toLocaleString();
const x = (n: number) => `${(n || 0).toFixed(2)}x`;
const pct = (n: number) => `${(n || 0).toFixed(1)}%`;
const hostPath = (url: string) => url.replace(/^https?:\/\//, "");

function mean(rows: LandingPageRow[], key: keyof LandingPageRow): number {
  if (!rows.length) return 0;
  return rows.reduce((s, r) => s + (Number(r[key]) || 0), 0) / rows.length;
}

// Delta vs report average. lowerIsBetter flips the good/bad colour (e.g. CPA).
function Delta({ value, avg, lowerIsBetter = false }: { value: number; avg: number; lowerIsBetter?: boolean }) {
  if (!avg) return null;
  const diffPct = ((value - avg) / avg) * 100;
  if (!isFinite(diffPct) || Math.abs(diffPct) < 0.5) return <span className="text-xs text-muted-foreground">~avg</span>;
  const up = diffPct > 0;
  const good = lowerIsBetter ? !up : up;
  return (
    <span className={`text-xs ${good ? "text-green-600" : "text-red-600"}`}>
      {up ? "▲" : "▼"} {Math.abs(diffPct).toFixed(0)}% vs avg
    </span>
  );
}

export default function LandingPagesPage() {
  const { selectedAccountId } = useAccountContext();
  const { isBuilder } = useAuth();

  const [windowDays, setWindowDays] = useState<number>(30);
  const [minSpend, setMinSpend] = useState<number>(0);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  // US-004 drill-in: the destination whose creatives are open in the dialog (null = closed).
  const [drillKey, setDrillKey] = useState<string | null>(null);

  const from = useMemo(() => isoDaysAgo(windowDays), [windowDays]);
  const to = useMemo(() => isoDaysAgo(0), []);

  const gated = !isBuilder || selectedAccountId !== BUILDER_ACCOUNT_ID;

  const { data, isLoading, error } = useQuery({
    queryKey: ["landing-pages", selectedAccountId, from, to, minSpend],
    queryFn: () => getLandingPages(selectedAccountId as string, from, to, minSpend),
    enabled: !gated && !!selectedAccountId,
  });

  const rows = data?.rows ?? [];
  const avg = useMemo(() => ({
    spend: mean(rows, "spend"), roas: mean(rows, "roas"), cpa: mean(rows, "cpa"),
    cvr: mean(rows, "cvr"), aov: mean(rows, "aov"), creative_count: mean(rows, "creative_count"),
  }), [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? rows.filter((r) => r.destination_key.toLowerCase().includes(q)) : rows;
    const dir = sortKey === "cpa" ? 1 : -1; // CPA ascending (lower is better), others descending
    const key = sortKey === "purchases" ? "purchases" : sortKey;
    return [...filtered].sort((a, b) => (Number(a[key]) - Number(b[key])) * dir);
  }, [rows, search, sortKey]);

  const exportCsv = () => {
    const headers = ["Destination", "Ads", "Spend", "ROAS", "CPA", "CVR %", "ATC %", "AOV", "Clicks", "Purchases"];
    const body = visible.map((r) => [
      r.destination_key, String(r.creative_count), r.spend.toFixed(2), r.roas.toFixed(2),
      r.cpa.toFixed(2), r.cvr.toFixed(1), r.atc_rate.toFixed(1), r.aov.toFixed(2),
      String(r.clicks), String(r.purchases),
    ]);
    downloadCSV(`landing-pages-${from}-to-${to}.csv`, headers, body);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Landing Pages</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Every destination your ads point to, consolidated across duplicate and UTM-variant
            links. Each card is one page; click through to the creatives driving it.
          </p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={!visible.length}>Export CSV</Button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={String(windowDays)} onValueChange={(v) => setWindowDays(Number(v))}>
          <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {WINDOWS.map((w) => <SelectItem key={w} value={String(w)}>Last {w} days</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <SelectItem key={k} value={k}>Sort: {SORT_LABELS[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="number" min={0} placeholder="Min spend"
          className="w-[130px]"
          value={minSpend || ""}
          onChange={(e) => setMinSpend(Number(e.target.value) || 0)}
        />
        <Input
          placeholder="Search destination…"
          className="w-[240px]"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {gated && (
        <Card className="p-6 text-sm text-muted-foreground">
          The Landing Pages report is in beta and currently available for the Goodo account.
          Select the Goodo account to view it.
        </Card>
      )}

      {!gated && (
        <>
          {/* Report average */}
          <Card className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              Report average · {rows.length} destination{rows.length === 1 ? "" : "s"}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
              <Metric label="Avg spend" value={usd(avg.spend)} />
              <Metric label="Avg ROAS" value={x(avg.roas)} />
              <Metric label="Avg CPA" value={usd(avg.cpa)} />
              <Metric label="Avg CVR" value={pct(avg.cvr)} />
              <Metric label="Avg AOV" value={usd(avg.aov)} />
              <Metric label="Avg ads/page" value={avg.creative_count.toFixed(1)} />
            </div>
          </Card>

          {isLoading && <Card className="p-6 text-sm text-muted-foreground">Loading destinations…</Card>}
          {error && (
            <Card className="p-6 text-sm text-red-600">
              Couldn’t load the report: {(error as Error).message}
            </Card>
          )}
          {!isLoading && !error && !visible.length && (
            <Card className="p-6 text-sm text-muted-foreground">No destinations match the current filters.</Card>
          )}

          {/* Destination cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {visible.map((r) => (
              <Card
                key={r.destination_key}
                className="p-4 space-y-3 cursor-pointer transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                role="button"
                tabIndex={0}
                aria-label={`View creatives for ${hostPath(r.destination_key)}`}
                onClick={() => setDrillKey(r.destination_key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrillKey(r.destination_key); }
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <a
                    href={r.destination_key} target="_blank" rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-sm font-medium text-primary hover:underline break-all"
                    title={r.destination_key}
                  >
                    {hostPath(r.destination_key)}
                  </a>
                  <Badge variant="secondary" className="shrink-0">{r.creative_count} ads</Badge>
                </div>
                <div className="grid grid-cols-4 gap-3 text-sm">
                  <Stat label="Spend" value={usd(r.spend)} delta={<Delta value={r.spend} avg={avg.spend} />} />
                  <Stat label="ROAS" value={x(r.roas)} delta={<Delta value={r.roas} avg={avg.roas} />} />
                  <Stat label="CPA" value={usd(r.cpa)} delta={<Delta value={r.cpa} avg={avg.cpa} lowerIsBetter />} />
                  <Stat label="CVR" value={pct(r.cvr)} delta={<Delta value={r.cvr} avg={avg.cvr} />} />
                  <Stat label="CTR" value={pct(r.ctr)} />
                  <Stat label="CPC" value={usd(r.cpc)} />
                  <Stat label="AOV" value={usd(r.aov)} />
                  <Stat label="Clicks" value={num(r.clicks)} />
                </div>
              </Card>
            ))}
          </div>

          {/* US-004 drill-in: creatives for the clicked destination over the current window. */}
          <LandingPageCreativesDialog
            accountId={selectedAccountId as string}
            destinationKey={drillKey}
            from={from}
            to={to}
            open={drillKey !== null}
            onClose={() => setDrillKey(null)}
          />
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function Stat({ label, value, delta }: { label: string; value: string; delta?: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
      {delta}
    </div>
  );
}
