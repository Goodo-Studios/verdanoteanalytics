import { AppLayout } from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TrendingUp, Download, ArrowUp, ArrowDown, Minus, AlertTriangle, ArrowLeft, Send, Loader2, Pencil, FileText } from "lucide-react";
import { exportReportCSV } from "@/lib/csv";
import { useReports, useSendReportToSlack } from "@/hooks/useReportsApi";
import { useParams } from "react-router-dom";
import { useRoleNavigate } from "@/hooks/useRolePath";
import { useMemo, useState, useCallback, useEffect } from "react";
import { fmtMetric } from "@/lib/formatters";
import { SectionRenderer } from "@/components/reports/SectionRenderer";
import { legacySectionsFromReport, standardReportSections, ReportSection } from "@/lib/reportSections";
import { PortfolioReportView } from "@/components/reports/PortfolioReportView";
import { CreativeDetailModal } from "@/components/CreativeDetailModal";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ReportPrintLayout } from "@/components/reports/ReportPrintLayout";

function DeltaBadge({ current, previous, prefix = "", suffix = "", inverse = false }: {
  current: number | null;
  previous: number | null;
  prefix?: string;
  suffix?: string;
  inverse?: boolean;
}) {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  const diff = Number(current) - Number(previous);
  if (Math.abs(diff) < 0.01) return <span className="text-xs text-muted-foreground flex items-center gap-0.5"><Minus className="h-3 w-3" />—</span>;
  const isPositive = diff > 0;
  const isGood = inverse ? !isPositive : isPositive;
  return (
    <span className={`text-xs flex items-center gap-0.5 ${isGood ? "text-success" : "text-destructive"}`}>
      {isPositive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {prefix}{Math.abs(diff).toLocaleString("en-US", { maximumFractionDigits: 2 })}{suffix}
    </span>
  );
}

const ReportDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useRoleNavigate();
  const { isClient } = useAuth();
  const { data: reports, isLoading } = useReports();
  const slackMut = useSendReportToSlack();
  const [selectedCreative, setSelectedCreative] = useState<any>(null);

  const handleAdClick = async (adId: string) => {
    const { data } = await supabase.from("creatives").select("*").eq("ad_id", adId).maybeSingle();
    if (data) setSelectedCreative(data);
  };

  const report = useMemo(() => reports?.find((r: any) => r.id === id), [reports, id]);

  const previousReport = useMemo(() => {
    if (!report || !reports || reports.length < 2) return undefined;
    const sorted = [...reports].sort((a: any, b: any) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    const currentIdx = sorted.findIndex((r: any) => r.id === report.id);
    if (currentIdx < 0) return undefined;
    for (let i = currentIdx + 1; i < sorted.length; i++) {
      if (sorted[i].account_id === report.account_id) return sorted[i];
    }
    return undefined;
  }, [report, reports]);

  // Fetch top creatives for print layout
  const [topCreatives, setTopCreatives] = useState<any[]>([]);
  const [tagBreakdown, setTagBreakdown] = useState<any[]>([]);

  // useEffect for async side effects (not useMemo which is for pure computation)
  useEffect(() => {
    if (!report?.account_id) return;
    supabase
      .from("creatives")
      .select("ad_id, ad_name, thumbnail_url, roas, spend, cpa, hook, style, ad_type")
      .eq("account_id", report.account_id)
      .order("spend", { ascending: false })
      .limit(6)
      .then(({ data }) => setTopCreatives(data || []));

    supabase
      .from("creatives")
      .select("hook, style, ad_type, roas, spend")
      .eq("account_id", report.account_id)
      .not("spend", "is", null)
      .gt("spend", 0)
      .limit(500)
      .then(({ data }) => {
        if (!data) return;
        const byHook = new Map<string, { count: number; totalRoas: number; totalSpend: number }>();
        const totalSpend = data.reduce((s, c) => s + (Number(c.spend) || 0), 0);
        for (const c of data) {
          const key = c.hook || c.style || c.ad_type || "Untagged";
          const existing = byHook.get(key) || { count: 0, totalRoas: 0, totalSpend: 0 };
          existing.count++;
          existing.totalRoas += Number(c.roas) || 0;
          existing.totalSpend += Number(c.spend) || 0;
          byHook.set(key, existing);
        }
        const rows = [...byHook.entries()]
          .map(([tag, d]) => ({
            tag,
            avgRoas: d.count > 0 ? d.totalRoas / d.count : 0,
            count: d.count,
            spendPct: totalSpend > 0 ? (d.totalSpend / totalSpend) * 100 : 0,
          }))
          .sort((a, b) => b.spendPct - a.spendPct)
          .slice(0, 15);
        setTagBreakdown(rows);
      });
  }, [report?.account_id]);

  const handleExportPDF = useCallback(() => {
    window.print();
  }, []);

  const fmt = fmtMetric;

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!report) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <h3 className="text-lg font-medium mb-2">Report not found</h3>
          <Button variant="outline" size="sm" onClick={() => navigate("/reports")}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />Back to Reports
          </Button>
        </div>
      </AppLayout>
    );
  }

  const prev = previousReport;
  const isPortfolio = report.report_type === "portfolio";
  const reportSections: ReportSection[] = (report.sections && Array.isArray(report.sections) && report.sections.length > 0)
    ? report.sections as ReportSection[]
    : legacySectionsFromReport(report);
  

  const metrics = [
    { label: "Creatives", value: report.creative_count, prevValue: prev?.creative_count, current: report.creative_count },
    { label: "Total Spend", value: fmt(report.total_spend, "$"), prevValue: prev?.total_spend, current: report.total_spend, prefix: "$" },
    { label: "Blended ROAS", value: fmt(report.blended_roas, "", "x"), prevValue: prev?.blended_roas, current: report.blended_roas, suffix: "x" },
    { label: "Avg CPA", value: fmt(report.average_cpa, "$"), prevValue: prev?.average_cpa, current: report.average_cpa, prefix: "$", inverse: true },
    { label: "Avg CTR", value: fmt(report.average_ctr, "", "%"), prevValue: prev?.average_ctr, current: report.average_ctr, suffix: "%" },
    { label: "Win Rate", value: fmt(report.win_rate, "", "%"), prevValue: prev?.win_rate, current: report.win_rate, suffix: "%" },
  ];

  // Build highlights for print layout
  const highlights: string[] = [];
  if (report.win_rate) highlights.push(`Win rate: ${Number(report.win_rate).toFixed(0)}% of creatives are above scale threshold`);
  if (report.blended_roas) highlights.push(`Blended ROAS of ${Number(report.blended_roas).toFixed(2)}x across ${report.creative_count || 0} creatives`);
  if (topPerformers.length > 0) highlights.push(`Top performer: ${topPerformers[0]?.ad_name} at ${Number(topPerformers[0]?.roas || 0).toFixed(2)}x ROAS`);
  if (report.average_cpa) highlights.push(`Average CPA of $${Number(report.average_cpa).toFixed(2)}`);
  if (prev && report.blended_roas && prev.blended_roas) {
    const delta = ((report.blended_roas - prev.blended_roas) / prev.blended_roas * 100).toFixed(0);
    highlights.push(`ROAS ${Number(delta) >= 0 ? 'improved' : 'declined'} ${Math.abs(Number(delta))}% vs. prior period`);
  }

  return (
    <>
      {/* Print-only layout — hidden on screen */}
      <ReportPrintLayout
        report={report}
        previousReport={prev}
        topCreatives={topCreatives}
        tagBreakdown={tagBreakdown}
        highlights={highlights}
      />

      {/* Screen layout */}
      <div className="screen-only-wrapper">
        <AppLayout>
          <div className="max-w-4xl mx-auto space-y-8">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <button
                  onClick={() => navigate("/reports")}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors no-print"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back to Reports
                </button>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-heading font-semibold">{report.report_name}</h1>
                  {report.date_range_days && (
                    <Badge variant="outline" className="text-xs">{report.date_range_days} days</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Generated {new Date(report.created_at).toLocaleString()}
                  {report.date_range_start && report.date_range_end && (
                    <> · {new Date(report.date_range_start).toLocaleDateString()} – {new Date(report.date_range_end).toLocaleDateString()}</>
                  )}
                </p>
              </div>
              {!isClient && (
                <div className="flex items-center gap-2 shrink-0 pt-6 no-print">
                  <Button size="sm" variant="outline" onClick={handleExportPDF}>
                    <FileText className="h-3.5 w-3.5 mr-1.5" />Export PDF
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => navigate(`/reports/${report.id}/build`)}>
                    <Pencil className="h-3.5 w-3.5 mr-1.5" />Edit
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => slackMut.mutate(report.id)} disabled={slackMut.isPending}>
                    <Send className="h-3.5 w-3.5 mr-1.5" />Slack
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => exportReportCSV(report)}>
                    <Download className="h-3.5 w-3.5 mr-1.5" />Export CSV
                  </Button>
                </div>
              )}
            </div>

            {/* Comparison notice */}
            {prev ? (
              <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg px-4 py-3">
                Comparing to <span className="font-medium">{prev.report_name}</span> ({new Date(prev.created_at).toLocaleDateString()})
              </p>
            ) : (
              <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg px-4 py-3">
                This is the first report{report.account_id ? " for this account" : ""}. Generate another after your next sync to see comparisons.
              </p>
            )}

            {/* Portfolio report view */}
            {isPortfolio ? (
              <PortfolioReportView report={report} />
            ) : hasSections ? (
              <div className="space-y-6">
                {(report.sections as ReportSection[]).map((section: ReportSection) => (
                  <SectionRenderer key={section.id} section={section} report={report} />
                ))}
              </div>
            ) : (
              <>
                {/* Legacy: Metrics Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                  {metrics.map((m) => (
                    <div key={m.label} className="glass-panel p-4 text-center space-y-1">
                      <div className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">{m.label}</div>
                      <div className="font-data text-[20px] font-semibold text-foreground tabular-nums">{m.value}</div>
                      {prev && m.current !== undefined && (
                        <DeltaBadge
                          current={m.current ?? null}
                          previous={m.prevValue ?? null}
                          prefix={m.prefix || ""}
                          suffix={m.suffix || ""}
                          inverse={m.inverse || false}
                        />
                      )}
                    </div>
                  ))}
                </div>

                <Separator />

                {/* Legacy: Top Performers */}
                {topPerformers.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-scale" />
                      <h2 className="text-lg font-heading font-semibold">Top Performers</h2>
                      <Badge variant="outline" className="text-xs">by spend</Badge>
                    </div>
                    <div className="space-y-2">
                      {topPerformers.map((p: any, i: number) => (
                        <div
                          key={p.ad_id}
                          className="flex items-center justify-between glass-panel p-4 cursor-pointer hover:bg-accent/50 transition-colors"
                          onClick={() => handleAdClick(p.ad_id)}
                        >
                          <div className="flex items-center gap-3">
                            <span className="font-data text-muted-foreground text-sm w-6">{i + 1}.</span>
                            <div>
                              <div className="text-sm font-medium">{p.ad_name}</div>
                              {p.unique_code && <div className="text-xs font-data text-muted-foreground mt-0.5">{p.unique_code}</div>}
                            </div>
                          </div>
                          <div className="flex items-center gap-6 font-data text-sm">
                            <div className="text-right">
                              <div className="text-xs text-muted-foreground">ROAS</div>
                              <div>{fmt(p.roas, "", "x")}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-muted-foreground">CPA</div>
                              <div>{fmt(p.cpa, "$")}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-muted-foreground">Spend</div>
                              <div>{fmt(p.spend, "$")}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Legacy: Iteration Suggestions */}
                {iterationSuggestions.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-warning" />
                      <h2 className="text-lg font-heading font-semibold">Iteration Suggestions</h2>
                      <Badge variant="outline" className="text-xs">{iterationSuggestions.length} ads need work</Badge>
                    </div>
                    <div className="space-y-2">
                      {iterationSuggestions.map((s: any) => (
                        <div
                          key={s.ad_id}
                          className="glass-panel p-4 space-y-2 cursor-pointer hover:bg-accent/50 transition-colors"
                          onClick={() => handleAdClick(s.ad_id)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <Badge variant="secondary" className="text-xs font-medium shrink-0">{s.label}</Badge>
                              <div>
                                <span className="text-sm font-medium">{s.ad_name}</span>
                                {s.unique_code && <span className="text-xs font-data text-muted-foreground ml-2">{s.unique_code}</span>}
                              </div>
                            </div>
                            <span className="font-data text-sm text-muted-foreground shrink-0">{fmt(s.spend, "$")}</span>
                          </div>
                          <p className="text-sm text-muted-foreground leading-relaxed pl-[calc(theme(spacing.3)+var(--badge-offset,0px))]">
                            {s.recommendation}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {selectedCreative && (
            <CreativeDetailModal
              creative={selectedCreative}
              open={!!selectedCreative}
              onClose={() => setSelectedCreative(null)}
            />
          )}
        </AppLayout>
      </div>
    </>
  );
};

export default ReportDetailPage;
