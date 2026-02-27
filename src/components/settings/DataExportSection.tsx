import { useState, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAccounts } from "@/hooks/useAccountsApi";
import { useAllCreatives } from "@/hooks/useAllCreatives";
import { useSplitTests, useSplitTestVariants } from "@/hooks/useSplitTestsApi";
import { useAccountContext } from "@/contexts/AccountContext";
import { downloadCSV } from "@/lib/csv";
import { gradeCreatives } from "@/lib/creativeGrading";
import { computeScoreMap } from "@/lib/creativeScore";
import { computeFatigueMap } from "@/lib/fatigueScore";
import { groupByConcept } from "@/lib/conceptGrouping";
import { useKillScaleLogic } from "@/lib/killScaleLogic";
import { Button } from "@/components/ui/button";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { Download, Loader2, FileSpreadsheet, BarChart3, Layers, FlaskConical, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/* ── helpers ───────────────────────────────── */

function downloadJSON(filename: string, data: any) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/* ── main component ───────────────────────── */

export function DataExportSection() {
  const { data: accounts = [] } = useAccounts();
  const { selectedAccountId } = useAccountContext();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-[22px] text-forest mb-1">Data Export Center</h2>
        <p className="font-body text-[13px] text-slate">Download your data as CSV or JSON for external analysis.</p>
      </div>

      <div className="space-y-4">
        <CreativePerformanceExport accounts={accounts} selectedAccountId={selectedAccountId} />
        <TagPerformanceExport accounts={accounts} selectedAccountId={selectedAccountId} />
        <ConceptPerformanceExport accounts={accounts} selectedAccountId={selectedAccountId} />
        <SplitTestExport accounts={accounts} selectedAccountId={selectedAccountId} />
        <AccountSummaryExport accounts={accounts} />
      </div>
    </div>
  );
}

/* ── export card wrapper ───────────────────── */

function ExportCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border-light rounded-[8px] bg-white p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-md bg-sage-light/50 shrink-0">{icon}</div>
        <div>
          <h3 className="font-heading text-[16px] text-forest">{title}</h3>
          <p className="font-body text-[12px] text-slate mt-0.5">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

/* ── account filter selector ───────────────── */

function AccountFilter({
  accounts,
  value,
  onChange,
}: {
  accounts: any[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="font-body text-[12px] border border-border-light rounded-md px-2 py-1.5 bg-background text-foreground"
    >
      <option value="all">All Accounts</option>
      {accounts.map((a: any) => (
        <option key={a.id} value={a.id}>{a.name}</option>
      ))}
    </select>
  );
}

/* ── format picker ─────────────────────────── */

function FormatPicker({ value, onChange, options = ["csv", "json"] }: {
  value: string;
  onChange: (v: string) => void;
  options?: string[];
}) {
  return (
    <div className="flex gap-1">
      {options.map((f) => (
        <button
          key={f}
          onClick={() => onChange(f)}
          className={cn(
            "font-label text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-md border transition-all",
            value === f
              ? "bg-verdant text-white border-verdant"
              : "bg-background text-muted-foreground border-border-light hover:border-verdant/50",
          )}
        >
          {f}
        </button>
      ))}
    </div>
  );
}

/* ── 1. Creative Performance ───────────────── */

function CreativePerformanceExport({ accounts, selectedAccountId }: { accounts: any[]; selectedAccountId: string | undefined }) {
  const [accountFilter, setAccountFilter] = useState(selectedAccountId === "all" ? "all" : selectedAccountId || "all");
  const [dateFrom, setDateFrom] = useState<string | undefined>();
  const [dateTo, setDateTo] = useState<string | undefined>();
  const [minSpend, setMinSpend] = useState("");
  const [format, setFormat] = useState("csv");
  const [loading, setLoading] = useState(false);

  const filters = useMemo(() => ({
    ...(accountFilter !== "all" ? { account_id: accountFilter } : {}),
    ...(dateFrom ? { date_from: dateFrom } : {}),
    ...(dateTo ? { date_to: dateTo } : {}),
  }), [accountFilter, dateFrom, dateTo]);

  const { data: creatives = [] } = useAllCreatives(filters);

  const handleExport = useCallback(async () => {
    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 50)); // yield to show spinner

      let filtered = creatives;
      const minS = parseFloat(minSpend);
      if (minS > 0) filtered = filtered.filter((c: any) => (Number(c.spend) || 0) >= minS);

      const account = accounts.find((a: any) => a.id === (filtered[0] as any)?.account_id);
      const killThreshold = parseFloat(account?.kill_threshold || "1.0");
      const scaleThreshold = parseFloat(account?.scale_threshold || "2.0");

      const grades = gradeCreatives(filtered, killThreshold);
      const scores = computeScoreMap(filtered, scaleThreshold);
      const fatigueMap = computeFatigueMap(filtered);

      if (format === "csv") {
        const headers = [
          "ad_id", "ad_name", "account_id", "campaign", "adset", "status",
          "roas", "spend", "cpa", "purchases", "ctr", "hook_rate",
          "impressions", "clicks", "video_views", "frequency",
          "grade", "creative_score", "fatigue_score",
          "ad_type", "hook", "style", "person", "product", "theme", "tag_source",
          "creator_id",
        ];
        const rows = filtered.map((c: any) => {
          const grade = grades.get(c.ad_id);
          const score = scores.get(c.ad_id);
          const fatigue = fatigueMap.get(c.ad_id);
          return [
            c.ad_id || "", c.ad_name || "", c.account_id || "",
            c.campaign_name || "", c.adset_name || "", c.ad_status || "",
            String(Number(c.roas) || 0), String(Number(c.spend) || 0),
            String(Number(c.cpa) || 0), String(Number(c.purchases) || 0),
            String(Number(c.ctr) || 0), String(Number(c.thumb_stop_rate) || 0),
            String(Number(c.impressions) || 0), String(Number(c.clicks) || 0),
            String(Number(c.video_views) || 0), String(Number(c.frequency) || 0),
            grade?.grade || "", String(score?.score || 0), String(fatigue?.score || 0),
            c.ad_type || "", c.hook || "", c.style || "", c.person || "",
            c.product || "", c.theme || "", c.tag_source || "",
            c.creator_id || "",
          ];
        });
        downloadCSV("creative-performance-export.csv", headers, rows);
      } else {
        const data = filtered.map((c: any) => {
          const grade = grades.get(c.ad_id);
          const score = scores.get(c.ad_id);
          const fatigue = fatigueMap.get(c.ad_id);
          return {
            ad_id: c.ad_id, ad_name: c.ad_name, account_id: c.account_id,
            campaign: c.campaign_name, adset: c.adset_name, status: c.ad_status,
            roas: Number(c.roas) || 0, spend: Number(c.spend) || 0,
            cpa: Number(c.cpa) || 0, purchases: Number(c.purchases) || 0,
            ctr: Number(c.ctr) || 0, hook_rate: Number(c.thumb_stop_rate) || 0,
            impressions: Number(c.impressions) || 0, clicks: Number(c.clicks) || 0,
            video_views: Number(c.video_views) || 0, frequency: Number(c.frequency) || 0,
            grade: grade?.grade || null, creative_score: score?.score || 0,
            fatigue_score: fatigue?.score || 0,
            tags: { ad_type: c.ad_type, hook: c.hook, style: c.style, person: c.person, product: c.product, theme: c.theme },
            tag_source: c.tag_source, creator_id: c.creator_id,
          };
        });
        downloadJSON("creative-performance-export.json", data);
      }
      toast.success(`Exported ${filtered.length} creatives`);
    } catch (e: any) {
      toast.error("Export failed", { description: e.message });
    } finally {
      setLoading(false);
    }
  }, [creatives, accounts, minSpend, format]);

  return (
    <ExportCard
      icon={<FileSpreadsheet className="h-5 w-5 text-forest" />}
      title="Creative Performance"
      description="Full creative-level data with grades, scores, fatigue, and tags."
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Account</label>
          <AccountFilter accounts={accounts} value={accountFilter} onChange={setAccountFilter} />
        </div>
        <div className="space-y-1">
          <label className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Date Range</label>
          <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} />
        </div>
        <div className="space-y-1">
          <label className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Min Spend</label>
          <input
            type="number"
            placeholder="0"
            value={minSpend}
            onChange={(e) => setMinSpend(e.target.value)}
            className="font-body text-[12px] border border-border-light rounded-md px-2 py-1.5 w-20 bg-background"
          />
        </div>
        <div className="space-y-1">
          <label className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Format</label>
          <FormatPicker value={format} onChange={setFormat} />
        </div>
        <Button
          size="sm"
          className="bg-verdant hover:bg-verdant/90 text-white font-body text-[12px] gap-1.5"
          onClick={handleExport}
          disabled={loading || creatives.length === 0}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Download ({creatives.length})
        </Button>
      </div>
    </ExportCard>
  );
}

/* ── 2. Tag Performance ────────────────────── */

function TagPerformanceExport({ accounts, selectedAccountId }: { accounts: any[]; selectedAccountId: string | undefined }) {
  const [accountFilter, setAccountFilter] = useState(selectedAccountId === "all" ? "all" : selectedAccountId || "all");
  const [loading, setLoading] = useState(false);

  const filters = useMemo(() => (accountFilter !== "all" ? { account_id: accountFilter } : {}), [accountFilter]);
  const { data: creatives = [] } = useAllCreatives(filters);

  const handleExport = useCallback(() => {
    setLoading(true);
    setTimeout(() => {
      try {
        const tagCategories = ["ad_type", "hook", "style", "person", "product", "theme"] as const;
        const rows: string[][] = [];
        const account = accounts.find((a: any) => a.id === accountFilter);
        const scaleThreshold = parseFloat(account?.scale_threshold || "2.0");

        for (const cat of tagCategories) {
          const groups: Record<string, { count: number; spend: number; pv: number; clicks: number; imps: number; purchases: number; winners: number }> = {};
          for (const c of creatives) {
            const val = (c as any)[cat];
            if (!val) continue;
            if (!groups[val]) groups[val] = { count: 0, spend: 0, pv: 0, clicks: 0, imps: 0, purchases: 0, winners: 0 };
            const g = groups[val];
            g.count++;
            g.spend += Number(c.spend) || 0;
            g.pv += Number(c.purchase_value) || 0;
            g.clicks += Number(c.clicks) || 0;
            g.imps += Number(c.impressions) || 0;
            g.purchases += Number(c.purchases) || 0;
            if ((Number(c.roas) || 0) >= scaleThreshold) g.winners++;
          }
          for (const [val, g] of Object.entries(groups)) {
            rows.push([
              cat, val, String(g.count),
              String(g.spend.toFixed(2)),
              String(g.spend > 0 ? (g.pv / g.spend).toFixed(2) : "0"),
              String(g.imps > 0 ? ((g.clicks / g.imps) * 100).toFixed(2) : "0"),
              String(g.purchases > 0 ? (g.spend / g.purchases).toFixed(2) : "0"),
              String(g.count > 0 ? ((g.winners / g.count) * 100).toFixed(1) : "0"),
            ]);
          }
        }

        downloadCSV("tag-performance-export.csv", [
          "tag_category", "tag_value", "creative_count", "total_spend", "avg_roas", "avg_ctr", "avg_cpa", "win_rate",
        ], rows);
        toast.success(`Exported ${rows.length} tag groups`);
      } catch (e: any) {
        toast.error("Export failed", { description: e.message });
      } finally {
        setLoading(false);
      }
    }, 50);
  }, [creatives, accounts, accountFilter]);

  return (
    <ExportCard
      icon={<BarChart3 className="h-5 w-5 text-forest" />}
      title="Tag Performance"
      description="Aggregated performance by tag category and value."
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Account</label>
          <AccountFilter accounts={accounts} value={accountFilter} onChange={setAccountFilter} />
        </div>
        <Button size="sm" className="bg-verdant hover:bg-verdant/90 text-white font-body text-[12px] gap-1.5" onClick={handleExport} disabled={loading || creatives.length === 0}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Download CSV
        </Button>
      </div>
    </ExportCard>
  );
}

/* ── 3. Concept Performance ────────────────── */

function ConceptPerformanceExport({ accounts, selectedAccountId }: { accounts: any[]; selectedAccountId: string | undefined }) {
  const [accountFilter, setAccountFilter] = useState(selectedAccountId === "all" ? "all" : selectedAccountId || "all");
  const [loading, setLoading] = useState(false);

  const filters = useMemo(() => (accountFilter !== "all" ? { account_id: accountFilter } : {}), [accountFilter]);
  const { data: creatives = [] } = useAllCreatives(filters);

  const handleExport = useCallback(() => {
    setLoading(true);
    setTimeout(() => {
      try {
        const concepts = groupByConcept(creatives);
        const rows = concepts.map((c) => [
          c.name,
          (creatives.find((cr: any) => cr.ad_name === c.best?.ad_name) as any)?.account_id || "",
          String(c.iterations.length),
          String(c.totalSpend.toFixed(2)),
          String(c.blendedRoas.toFixed(2)),
          c.best?.ad_name || "",
          String(Number(c.best?.roas || 0).toFixed(2)),
          c.worst?.ad_name || "",
          String(Number(c.worst?.roas || 0).toFixed(2)),
        ]);
        downloadCSV("concept-performance-export.csv", [
          "concept_name", "account_id", "iteration_count", "total_spend", "blended_roas",
          "best_iteration_name", "best_iteration_roas", "worst_iteration_name", "worst_iteration_roas",
        ], rows);
        toast.success(`Exported ${concepts.length} concepts`);
      } catch (e: any) {
        toast.error("Export failed", { description: e.message });
      } finally {
        setLoading(false);
      }
    }, 50);
  }, [creatives]);

  return (
    <ExportCard
      icon={<Layers className="h-5 w-5 text-forest" />}
      title="Concept Performance"
      description="One row per concept group with iteration stats and best/worst performers."
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Account</label>
          <AccountFilter accounts={accounts} value={accountFilter} onChange={setAccountFilter} />
        </div>
        <Button size="sm" className="bg-verdant hover:bg-verdant/90 text-white font-body text-[12px] gap-1.5" onClick={handleExport} disabled={loading || creatives.length === 0}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Download CSV
        </Button>
      </div>
    </ExportCard>
  );
}

/* ── 4. Split Test Results ─────────────────── */

function SplitTestExport({ accounts, selectedAccountId }: { accounts: any[]; selectedAccountId: string | undefined }) {
  const [accountFilter, setAccountFilter] = useState(selectedAccountId === "all" ? "all" : selectedAccountId || "all");
  const [loading, setLoading] = useState(false);

  const acctId = accountFilter !== "all" ? accountFilter : undefined;
  const { data: tests = [] } = useSplitTests(acctId);
  const testIds = tests.map((t) => t.id);
  const { data: variants = [] } = useSplitTestVariants(testIds);

  const handleExport = useCallback(() => {
    setLoading(true);
    setTimeout(() => {
      try {
        const completed = tests.filter((t) => t.status === "complete");
        const rows = completed.map((t) => {
          const tvs = variants.filter((v) => v.test_id === t.id);
          return [
            t.name,
            t.variable_tested || "",
            t.hypothesis || "",
            t.start_date || "",
            t.end_date || "",
            String(t.minimum_spend),
            t.status,
            t.winner_ad_id || "",
            tvs.map((v) => `${v.label}:${v.ad_id}`).join("; "),
            t.notes || "",
          ];
        });
        downloadCSV("split-test-results-export.csv", [
          "name", "variable_tested", "hypothesis", "start_date", "end_date",
          "minimum_spend", "status", "winner_ad_id", "variants", "notes",
        ], rows);
        toast.success(`Exported ${completed.length} test results`);
      } catch (e: any) {
        toast.error("Export failed", { description: e.message });
      } finally {
        setLoading(false);
      }
    }, 50);
  }, [tests, variants]);

  return (
    <ExportCard
      icon={<FlaskConical className="h-5 w-5 text-forest" />}
      title="Split Test Results"
      description="All completed split tests with winner and learnings."
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Account</label>
          <AccountFilter accounts={accounts} value={accountFilter} onChange={setAccountFilter} />
        </div>
        <Button size="sm" className="bg-verdant hover:bg-verdant/90 text-white font-body text-[12px] gap-1.5" onClick={handleExport} disabled={loading || tests.length === 0}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Download CSV ({tests.filter((t) => t.status === "complete").length})
        </Button>
      </div>
    </ExportCard>
  );
}

/* ── 5. Account Summary ────────────────────── */

function AccountSummaryExport({ accounts }: { accounts: any[] }) {
  const [loading, setLoading] = useState(false);
  const { data: allCreatives = [] } = useAllCreatives({});

  const handleExport = useCallback(() => {
    setLoading(true);
    setTimeout(() => {
      try {
        const rows = accounts.map((a: any) => {
          const acctCreatives = allCreatives.filter((c: any) => c.account_id === a.id);
          const active = acctCreatives.filter((c: any) => (Number(c.spend) || 0) > 0);
          const totalSpend = active.reduce((s: number, c: any) => s + (Number(c.spend) || 0), 0);
          const totalPV = active.reduce((s: number, c: any) => s + (Number(c.purchase_value) || 0), 0);
          const avgRoas = totalSpend > 0 ? totalPV / totalSpend : 0;
          const scaleThreshold = parseFloat(a.scale_threshold || "2.0");
          const winners = active.filter((c: any) => (Number(c.roas) || 0) >= scaleThreshold);
          const winRate = active.length > 0 ? (winners.length / active.length) * 100 : 0;

          return [
            a.name, String(acctCreatives.length), String(active.length),
            String(totalSpend.toFixed(2)), String(avgRoas.toFixed(2)),
            String(winRate.toFixed(1)),
          ];
        });
        downloadCSV("account-summary-export.csv", [
          "name", "total_creatives", "active_creatives", "total_spend", "avg_roas", "win_rate",
        ], rows);
        toast.success(`Exported ${accounts.length} accounts`);
      } catch (e: any) {
        toast.error("Export failed", { description: e.message });
      } finally {
        setLoading(false);
      }
    }, 50);
  }, [accounts, allCreatives]);

  return (
    <ExportCard
      icon={<Building2 className="h-5 w-5 text-forest" />}
      title="Account Summary"
      description="One row per account with total creatives, spend, ROAS, and win rate."
    >
      <Button size="sm" className="bg-verdant hover:bg-verdant/90 text-white font-body text-[12px] gap-1.5" onClick={handleExport} disabled={loading || accounts.length === 0}>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        Download CSV ({accounts.length} accounts)
      </Button>
    </ExportCard>
  );
}
