import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ChevronDown, ChevronRight, Trophy, Lightbulb, Printer, TrendingUp } from "lucide-react";

interface AccountSummary {
  account_id: string;
  name: string;
  spend: number;
  roas: number;
  cpa: number;
  purchases: number;
  win_rate: number;
  creative_count: number;
  top_creative: {
    ad_id: string;
    ad_name: string;
    roas: number;
    spend: number;
    thumbnail_url: string | null;
  } | null;
}

interface PortfolioWinner {
  ad_id: string;
  ad_name: string;
  account_name: string;
  roas: number;
  spend: number;
  thumbnail_url: string | null;
}

interface PortfolioData {
  account_summaries: AccountSummary[];
  portfolio_winners: PortfolioWinner[];
  ai_insights: string[];
  date_start: string;
  date_end: string;
}

interface PortfolioReportViewProps {
  report: any;
}

const fmt = (v: number | null | undefined, prefix = "", suffix = "") => {
  if (v === null || v === undefined) return "—";
  return `${prefix}${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}${suffix}`;
};

export function PortfolioReportView({ report }: PortfolioReportViewProps) {
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());

  const portfolioData: PortfolioData | null = useMemo(() => {
    if (!report.sections || !Array.isArray(report.sections) || report.sections.length === 0) return null;
    return report.sections[0] as PortfolioData;
  }, [report]);

  const portfolioTotals = useMemo(() => {
    if (!portfolioData) return { totalSpend: 0, totalPurchases: 0 };
    const totalSpend = portfolioData.account_summaries.reduce((s, a) => s + a.spend, 0);
    const totalPurchases = portfolioData.account_summaries.reduce((s, a) => s + a.purchases, 0);
    return { totalSpend, totalPurchases };
  }, [portfolioData]);

  if (!portfolioData) return null;

  const { account_summaries, portfolio_winners, ai_insights, date_start, date_end } = portfolioData;

  const toggleExpand = (id: string) => {
    setExpandedAccounts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-10 print:space-y-6">
      {/* COVER */}
      <div className="text-center space-y-3 py-8 print:py-4">
        <h1 className="font-heading text-[32px] text-forest print:text-[24px]">
          {report.report_name}
        </h1>
        <p className="font-body text-[14px] text-muted-foreground">
          {new Date(date_start).toLocaleDateString()} – {new Date(date_end).toLocaleDateString()}
          {" · "}
          {account_summaries.length} accounts
          {" · "}
          {fmt(report.total_spend, "$")} total spend
          {" · "}
          {fmt(report.blended_roas, "", "x")} blended ROAS
        </p>
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            className="print:hidden"
            onClick={() => window.print()}
          >
            <Printer className="h-3.5 w-3.5 mr-1.5" />
            Export PDF
          </Button>
        </div>
      </div>

      {/* SECTION 1 — Portfolio Summary */}
      <div className="space-y-4">
        <h2 className="font-heading text-[22px] text-forest flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          Portfolio Summary
        </h2>
        <div className="glass-panel overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-cream-dark">
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Account</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Spend</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">ROAS</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">CPA</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Purchases</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Win Rate</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Creatives</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {account_summaries.map(a => (
                <TableRow key={a.account_id}>
                  <TableCell className="font-body text-[13px] font-medium text-charcoal">{a.name}</TableCell>
                  <TableCell className="font-data text-[13px] text-right tabular-nums">{fmt(a.spend, "$")}</TableCell>
                  <TableCell className={cn(
                    "font-data text-[13px] text-right tabular-nums font-semibold",
                    a.roas >= 2 ? "text-primary" : a.roas < 1 ? "text-destructive" : "text-foreground"
                  )}>
                    {fmt(a.roas, "", "x")}
                  </TableCell>
                  <TableCell className="font-data text-[13px] text-right tabular-nums">{fmt(a.cpa, "$")}</TableCell>
                  <TableCell className="font-data text-[13px] text-right tabular-nums">{a.purchases.toLocaleString()}</TableCell>
                  <TableCell className="font-data text-[13px] text-right tabular-nums">{fmt(a.win_rate, "", "%")}</TableCell>
                  <TableCell className="font-data text-[13px] text-right tabular-nums">{a.creative_count}</TableCell>
                </TableRow>
              ))}
              {/* Portfolio totals row */}
              <TableRow className="bg-muted/30 border-t-2 border-border">
                <TableCell className="font-body text-[13px] font-bold text-forest">Portfolio Total</TableCell>
                <TableCell className="font-data text-[13px] text-right tabular-nums font-bold">{fmt(report.total_spend, "$")}</TableCell>
                <TableCell className={cn(
                  "font-data text-[13px] text-right tabular-nums font-bold",
                  report.blended_roas >= 2 ? "text-primary" : report.blended_roas < 1 ? "text-destructive" : "text-foreground"
                )}>
                  {fmt(report.blended_roas, "", "x")}
                </TableCell>
                <TableCell className="font-data text-[13px] text-right tabular-nums font-bold">{fmt(report.average_cpa, "$")}</TableCell>
                <TableCell className="font-data text-[13px] text-right tabular-nums font-bold">{portfolioTotals.totalPurchases.toLocaleString()}</TableCell>
                <TableCell className="font-data text-[13px] text-right tabular-nums font-bold">—</TableCell>
                <TableCell className="font-data text-[13px] text-right tabular-nums font-bold">{report.creative_count}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      {/* SECTION 2 — Portfolio Winners */}
      {portfolio_winners.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-heading text-[22px] text-forest flex items-center gap-2">
            <Trophy className="h-5 w-5 text-warning" />
            Portfolio Winners
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {portfolio_winners.map((w, i) => (
              <div key={w.ad_id} className="glass-panel p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "flex items-center justify-center h-6 w-6 rounded-full font-data text-[11px] font-bold",
                    i === 0 ? "bg-warning text-warning-foreground" : "bg-muted text-muted-foreground"
                  )}>
                    {i + 1}
                  </span>
                  <Badge variant="outline" className="text-[10px]">{w.account_name}</Badge>
                </div>
                {w.thumbnail_url && (
                  <div className="w-full aspect-video rounded-md overflow-hidden border border-border-light bg-muted">
                    <img src={w.thumbnail_url} alt={w.ad_name} className="w-full h-full object-cover" />
                  </div>
                )}
                <div>
                  <p className="font-body text-[13px] font-semibold text-charcoal truncate">{w.ad_name}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="font-data text-[13px] font-bold text-primary tabular-nums">{fmt(w.roas, "", "x")} ROAS</span>
                    <span className="font-data text-[12px] text-muted-foreground tabular-nums">{fmt(w.spend, "$")} spent</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SECTION 3 — Account Spotlights */}
      <div className="space-y-4">
        <h2 className="font-heading text-[22px] text-forest">Account Spotlights</h2>
        <div className="space-y-2">
          {account_summaries.map(a => (
            <div key={a.account_id} className="glass-panel overflow-hidden">
              <button
                onClick={() => toggleExpand(a.account_id)}
                className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-accent/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {expandedAccounts.has(a.account_id)
                    ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  }
                  <span className="font-body text-[14px] font-semibold text-charcoal">{a.name}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-data text-[12px] text-muted-foreground tabular-nums">{fmt(a.spend, "$")}</span>
                  <span className={cn(
                    "font-data text-[12px] tabular-nums font-semibold",
                    a.roas >= 2 ? "text-primary" : a.roas < 1 ? "text-destructive" : "text-foreground"
                  )}>
                    {fmt(a.roas, "", "x")}
                  </span>
                  <span className="font-data text-[12px] text-muted-foreground tabular-nums">{a.creative_count} ads</span>
                </div>
              </button>

              {expandedAccounts.has(a.account_id) && (
                <div className="px-5 pb-4 pt-1 border-t border-border-light">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                    <div className="text-center p-3 bg-muted/30 rounded-lg">
                      <div className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Spend</div>
                      <div className="font-data text-[16px] font-semibold tabular-nums">{fmt(a.spend, "$")}</div>
                    </div>
                    <div className="text-center p-3 bg-muted/30 rounded-lg">
                      <div className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">ROAS</div>
                      <div className={cn("font-data text-[16px] font-semibold tabular-nums", a.roas >= 2 ? "text-primary" : a.roas < 1 ? "text-destructive" : "")}>
                        {fmt(a.roas, "", "x")}
                      </div>
                    </div>
                    <div className="text-center p-3 bg-muted/30 rounded-lg">
                      <div className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">CPA</div>
                      <div className="font-data text-[16px] font-semibold tabular-nums">{fmt(a.cpa, "$")}</div>
                    </div>
                    <div className="text-center p-3 bg-muted/30 rounded-lg">
                      <div className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Win Rate</div>
                      <div className="font-data text-[16px] font-semibold tabular-nums">{fmt(a.win_rate, "", "%")}</div>
                    </div>
                  </div>

                  {a.top_creative && (
                    <div className="flex items-center gap-3 p-3 bg-muted/20 rounded-lg">
                      {a.top_creative.thumbnail_url && (
                        <img src={a.top_creative.thumbnail_url} alt="" className="h-12 w-12 rounded object-cover border border-border-light" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-body text-[12px] font-semibold text-charcoal truncate">{a.top_creative.ad_name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="font-data text-[11px] text-primary font-semibold tabular-nums">{fmt(a.top_creative.roas, "", "x")} ROAS</span>
                          <span className="font-data text-[11px] text-muted-foreground tabular-nums">{fmt(a.top_creative.spend, "$")}</span>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[9px]">Top Creative</Badge>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* SECTION 4 — AI Insights & Recommendations */}
      {ai_insights.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-heading text-[22px] text-forest flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-warning" />
            Insights & Recommendations
          </h2>
          <div className="glass-panel p-5 space-y-3">
            {ai_insights.map((insight, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="flex-shrink-0 h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center font-data text-[10px] text-primary font-bold mt-0.5">
                  {i + 1}
                </span>
                <p className="font-body text-[14px] text-charcoal leading-relaxed">{insight}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
