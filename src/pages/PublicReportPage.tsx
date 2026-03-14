import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { TrendingUp, AlertTriangle, Loader2, LogIn } from "lucide-react";
import { useParams, Link } from "react-router-dom";
import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SectionRenderer } from "@/components/reports/SectionRenderer";
import { ReportSection } from "@/lib/reportSections";
import { PortfolioReportView } from "@/components/reports/PortfolioReportView";

function usePublicReport(id: string | undefined) {
  return useQuery({
    queryKey: ["public-report", id],
    queryFn: async () => {
      if (!id) throw new Error("No report ID");
      const { data, error } = await supabase.from("reports").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

import { fmtMetric } from "@/lib/formatters";
const fmt = fmtMetric;

const PublicReportPage = () => {
  const { id } = useParams<{ id: string }>();
  const { data: report, isLoading } = usePublicReport(id);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session?.user);
    });
  }, []);

  const topPerformers = useMemo(() => {
    try { return JSON.parse(report?.top_performers || "[]"); } catch { return []; }
  }, [report]);

  const iterationSuggestions = useMemo(() => {
    try { return JSON.parse(report?.iteration_suggestions || "[]"); } catch { return []; }
  }, [report]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <h3 className="text-lg font-medium text-muted-foreground">Report not found</h3>
      </div>
    );
  }

  const metrics = [
    { label: "Creatives", value: report.creative_count },
    { label: "Total Spend", value: fmt(report.total_spend, "$") },
    { label: "Blended ROAS", value: fmt(report.blended_roas, "", "x") },
    { label: "Avg CPA", value: fmt(report.average_cpa, "$") },
    { label: "Avg CTR", value: fmt(report.average_ctr, "", "%") },
    { label: "Win Rate", value: fmt(report.win_rate, "", "%") },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-10 space-y-8">
        {/* Branding */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/favicon.png" alt="Verdanote" className="h-8 w-8 rounded-lg shadow-sm" />
            <span className="text-sm font-serif font-semibold text-foreground tracking-tight">Verdanote</span>
          </div>
          {isAuthenticated === false && (
            <Link
              to="/login"
              className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors bg-primary/10 rounded-md px-3 py-1.5"
            >
              <LogIn className="h-3.5 w-3.5" />
              Sign in for full access
            </Link>
          )}
        </div>

        {/* Header */}
        <div className="space-y-2">
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

        {/* Portfolio or section-based or legacy content */}
        {(report as any).report_type === "portfolio" ? (
          <PortfolioReportView report={report} />
        ) : report.sections && Array.isArray(report.sections) && report.sections.length > 0 ? (
          <div className="space-y-6">
            {(report.sections as unknown as ReportSection[]).map((section: ReportSection) => (
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
                    <div key={p.ad_id} className="flex items-center justify-between glass-panel p-4">
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
                    <div key={s.ad_id} className="glass-panel p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Badge variant="secondary" className="text-xs font-medium shrink-0">{s.label}</Badge>
                          <div>
                            <span className="text-sm font-medium">{s.ad_name}</span>
                            {s.unique_code && <span className="text-xs font-data text-muted-foreground ml-2">{s.unique_code}</span>}
                          </div>
                        </div>
                        <span className="font-mono text-sm text-muted-foreground shrink-0">{fmt(s.spend, "$")}</span>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">
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
    </div>
  );
};

export default PublicReportPage;
