import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileText, Plus, Trash2, Loader2, Eye, Download, CalendarClock, Send, CalendarIcon, Link2, Files, Layers } from "lucide-react";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import { format, subDays } from "date-fns";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useState, useCallback, useMemo } from "react";
import { fmtMetric } from "@/lib/formatters";
import { useRoleNavigate } from "@/hooks/useRolePath";
import { useReports, useGenerateReport, useDeleteReport, useSendReportToSlack, useReportSchedules, useUpsertReportSchedule } from "@/hooks/useReportsApi";
import { useAccounts } from "@/hooks/useAccountsApi";
import { exportReportCSV } from "@/lib/csv";
import { useAuth } from "@/contexts/AuthContext";
import { useAccountContext } from "@/contexts/AccountContext";
import { MonthlyRollupModal } from "@/components/reports/MonthlyRollupModal";
import { PortfolioReportModal } from "@/components/reports/PortfolioReportModal";

const CADENCES = [
  { key: "weekly", label: "Weekly", defaultDays: 7, description: "Runs every Monday" },
  { key: "monthly", label: "Monthly", defaultDays: 30, description: "Runs on the 1st" },
] as const;

const ReportsPage = () => {
  const { isClient, isBuilder } = useAuth();
  const { selectedAccountId } = useAccountContext();
  const [showGenerate, setShowGenerate] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showRollup, setShowRollup] = useState(false);
  const [showPortfolio, setShowPortfolio] = useState(false);
  const [reportName, setReportName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [dateStart, setDateStart] = useState<Date>(subDays(new Date(), 7));
  const [dateEnd, setDateEnd] = useState<Date>(subDays(new Date(), 1));
  const navigate = useRoleNavigate();

  const { data: rawReports, isLoading } = useReports();
  const { data: accounts } = useAccounts();
  const { data: schedules } = useReportSchedules();
  const generateMut = useGenerateReport();
  const deleteMut = useDeleteReport();
  const slackMut = useSendReportToSlack();
  const upsertScheduleMut = useUpsertReportSchedule();

  const reports = useMemo(() => {
    if (!rawReports) return [];
    if (!selectedAccountId || selectedAccountId === "all") return rawReports;
    return rawReports.filter((r: any) => r.account_id === selectedAccountId);
  }, [rawReports, selectedAccountId]);

  const getSchedule = useCallback((accountId: string, cadence: string) => {
    return schedules?.find((s: any) => s.account_id === accountId && s.cadence === cadence);
  }, [schedules]);

  const handleToggleSchedule = (accountId: string, cadence: string, enabled: boolean) => {
    const existing = getSchedule(accountId, cadence);
    upsertScheduleMut.mutate({
      account_id: accountId,
      cadence,
      enabled,
      report_name_template: existing?.report_name_template || `{cadence} Report - {account}`,
      date_range_days: existing?.date_range_days || (cadence === "weekly" ? 7 : 30),
      deliver_to_app: existing?.deliver_to_app ?? true,
      deliver_to_slack: existing?.deliver_to_slack ?? false,
    });
  };

  const handleUpdateSchedule = (accountId: string, cadence: string, field: string, value: any) => {
    const existing = getSchedule(accountId, cadence);
    upsertScheduleMut.mutate({
      account_id: accountId,
      cadence,
      enabled: existing?.enabled ?? true,
      report_name_template: existing?.report_name_template || `{cadence} Report - {account}`,
      date_range_days: existing?.date_range_days || (cadence === "weekly" ? 7 : 30),
      deliver_to_app: existing?.deliver_to_app ?? true,
      deliver_to_slack: existing?.deliver_to_slack ?? false,
      [field]: value,
    });
  };

  const handleGenerate = () => {
    generateMut.mutate(
      {
        report_name: reportName || `Report ${new Date().toLocaleDateString()}`,
        account_id: accountId || undefined,
        date_start: format(dateStart, "yyyy-MM-dd"),
        date_end: format(dateEnd, "yyyy-MM-dd"),
      },
      {
        onSuccess: (data: any) => {
          setShowGenerate(false);
          setReportName("");
          setAccountId("");
          setDateStart(subDays(new Date(), 7));
          setDateEnd(subDays(new Date(), 1));
          if (data?.id) {
            navigate(`/reports/${data.id}/build`);
          }
        },
      }
    );
  };

  const fmt = fmtMetric;

  return (
    <>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-heading text-[32px] text-forest">Reports</h1>
          <p className="font-body text-[13px] text-slate font-light mt-1">
            Generate and view snapshot reports of your creative performance.
          </p>
        </div>
        {!isClient && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setShowSchedule(true)}>
              <CalendarClock className="h-3.5 w-3.5 mr-1.5" />
              Schedules
            </Button>
            {isBuilder && (
              <Button size="sm" variant="secondary" onClick={() => setShowRollup(true)}>
                <Files className="h-3.5 w-3.5 mr-1.5" />
                Monthly Rollup
              </Button>
            )}
            {!isClient && (
              <Button size="sm" variant="secondary" onClick={() => setShowPortfolio(true)}>
                <Layers className="h-3.5 w-3.5 mr-1.5" />
                Portfolio Report
              </Button>
            )}
            <Button size="sm" className="bg-verdant text-white hover:bg-verdant/90" onClick={() => setShowGenerate(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Generate Report
            </Button>
          </div>
        )}
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={8} />
      ) : !reports?.length ? (
        <div className="glass-panel flex flex-col items-center justify-center py-20 text-center">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <FileText className="h-6 w-6 text-sage" />
          </div>
          <h3 className="font-heading text-[20px] text-forest mb-1">No reports yet</h3>
          <p className="font-body text-[14px] text-slate max-w-[400px]">
            Generate a snapshot report to capture your current creative performance metrics.
          </p>
        </div>
      ) : (
        <div className="glass-panel overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-cream-dark">
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Report</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Date</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Creatives</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Spend</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">ROAS</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Win Rate</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">CPA</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.map((r: any) => (
                <TableRow key={r.id} className="cursor-pointer hover:bg-accent/50" onClick={() => navigate(`/reports/${r.id}`)}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-body text-[13px] font-semibold text-charcoal">{r.report_name}</span>
                      {r.report_type === "portfolio" && (
                        <Badge variant="secondary" className="text-[9px] px-1.5 py-0">Portfolio</Badge>
                      )}
                    </div>
                    <div className="font-data text-[11px] text-slate">{r.date_range_days ? `${r.date_range_days} days` : "—"}</div>
                  </TableCell>
                  <TableCell className="font-data text-[17px] text-slate">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="font-data text-[17px] text-right tabular-nums">{r.creative_count}</TableCell>
                  <TableCell className="font-data text-[17px] text-right tabular-nums">{fmt(r.total_spend, "$")}</TableCell>
                  <TableCell className="font-data text-[17px] text-right tabular-nums">{fmt(r.blended_roas, "", "x")}</TableCell>
                  <TableCell className="font-data text-[17px] text-right tabular-nums">{fmt(r.win_rate, "", "%")}</TableCell>
                  <TableCell className="font-data text-[17px] text-right tabular-nums">{fmt(r.average_cpa, "$")}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {!isClient && (
                        <Button variant="ghost" size="sm" className="h-7 px-2" title="Copy public link" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(`${window.location.origin}/public/reports/${r.id}`); import("sonner").then(m => m.toast.success("Public link copied!")); }}>
                          <Link2 className="h-3 w-3" />
                        </Button>
                      )}
                      {!isClient && (
                        <Button variant="ghost" size="sm" className="h-7 px-2" title="Send to Slack" onClick={(e) => { e.stopPropagation(); slackMut.mutate(r.id); }} disabled={slackMut.isPending}>
                          <Send className="h-3 w-3" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={(e) => { e.stopPropagation(); exportReportCSV(r); }}>
                        <Download className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={(e) => { e.stopPropagation(); navigate(`/reports/${r.id}`); }}>
                        <Eye className="h-3 w-3" />
                      </Button>
                      {!isClient && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive" onClick={(e) => { e.stopPropagation(); deleteMut.mutate(r.id); }} disabled={deleteMut.isPending}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Generate Dialog */}
      <Dialog open={showGenerate} onOpenChange={setShowGenerate}>
        <DialogContent className="max-w-md bg-card rounded-[8px] shadow-modal p-7">
          <DialogHeader>
            <DialogTitle className="font-heading text-[22px] text-forest">Generate Report</DialogTitle>
            <DialogDescription className="font-body text-[13px] text-slate font-light">Create a new snapshot report of your creative performance.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="font-body text-[14px] font-medium text-charcoal">Report Name</Label>
              <Input className="bg-background font-body text-[14px] text-charcoal border-border-light rounded-[4px] focus:border-verdant" value={reportName} onChange={(e) => setReportName(e.target.value)} placeholder={`Report ${new Date().toLocaleDateString()}`} />
            </div>
            <div className="space-y-1.5">
              <Label className="font-body text-[14px] font-medium text-charcoal">Account (optional)</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger className="bg-background font-body text-[14px] text-charcoal border-border-light rounded-[4px]"><SelectValue placeholder="All accounts" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All accounts</SelectItem>
                  {(accounts || []).map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="font-body text-[14px] font-medium text-charcoal">Date Range</Label>
              <div className="flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("h-9 flex-1 justify-start border-border-light rounded-[4px]", !dateStart ? "font-body text-[14px] text-muted-foreground" : "font-data text-[17px] font-medium text-charcoal")}>
                      <CalendarIcon className="h-3.5 w-3.5 mr-1.5 text-sage" />
                      {dateStart ? format(dateStart, "MMM d, yyyy") : "Start"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={dateStart} onSelect={(d) => d && setDateStart(d)} disabled={(d) => d > new Date()} className={cn("p-3 pointer-events-auto")} />
                  </PopoverContent>
                </Popover>
                <span className="font-body text-[13px] text-sage">to</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("h-9 flex-1 justify-start border-border-light rounded-[4px]", !dateEnd ? "font-body text-[14px] text-muted-foreground" : "font-data text-[17px] font-medium text-charcoal")}>
                      <CalendarIcon className="h-3.5 w-3.5 mr-1.5 text-sage" />
                      {dateEnd ? format(dateEnd, "MMM d, yyyy") : "End"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={dateEnd} onSelect={(d) => d && setDateEnd(d)} disabled={(d) => d > new Date()} className={cn("p-3 pointer-events-auto")} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" onClick={handleGenerate} disabled={generateMut.isPending} className="bg-verdant text-white hover:bg-verdant/90 font-body text-[13px] font-semibold rounded-[6px]">
              {generateMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Schedule Dialog */}
      <Dialog open={showSchedule} onOpenChange={setShowSchedule}>
        <DialogContent className="max-w-lg bg-card rounded-[8px] shadow-modal p-7">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-heading text-[22px] text-forest">
              <CalendarClock className="h-5 w-5 text-sage" />
              Report Schedules
            </DialogTitle>
            <DialogDescription className="font-body text-[13px] text-slate font-light">
              Configure automatic report generation per account. Use templates: <span className="font-data text-[17px] font-medium text-verdant">{"{account}"}</span>, <span className="font-data text-[17px] font-medium text-verdant">{"{cadence}"}</span>, <span className="font-data text-[17px] font-medium text-verdant">{"{date}"}</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            {(accounts || []).map((a: any) => (
              <div key={a.id} className="rounded-card border border-border-light bg-card p-5 space-y-4">
                <div className="font-body text-[16px] font-semibold text-charcoal">{a.name}</div>
                {CADENCES.map(({ key, label, defaultDays, description }, idx) => {
                  const schedule = getSchedule(a.id, key);
                  const enabled = schedule?.enabled ?? false;
                  return (
                    <div key={key}>
                      {idx > 0 && <div className="border-t border-border-light my-4" />}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-body text-[14px] font-semibold text-forest">{label}</span>
                            <span className="font-body text-[12px] text-sage font-normal ml-2">{description}</span>
                          </div>
                          <Switch
                            checked={enabled}
                            onCheckedChange={(checked) => handleToggleSchedule(a.id, key, checked)}
                          />
                        </div>
                        {enabled && (
                          <div className="space-y-3 pt-3 border-t border-border-light">
                            <div className="space-y-1">
                              <Label className="font-label text-[10px] uppercase tracking-[0.06em] text-sage font-medium">Report Name Template</Label>
                              <Input
                                className="font-body text-[14px] text-charcoal border-border-light rounded-[4px] bg-background"
                                value={schedule?.report_name_template || `{cadence} Report - {account}`}
                                onChange={(e) => handleUpdateSchedule(a.id, key, "report_name_template", e.target.value)}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="font-label text-[10px] uppercase tracking-[0.06em] text-sage font-medium">Date Range (days)</Label>
                              <Input
                                type="number"
                                className="font-data text-[17px] font-medium text-charcoal border-border-light rounded-[4px] bg-background w-24"
                                value={schedule?.date_range_days ?? defaultDays}
                                onChange={(e) => handleUpdateSchedule(a.id, key, "date_range_days", parseInt(e.target.value) || defaultDays)}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="font-label text-[10px] uppercase tracking-[0.06em] text-sage font-medium">Delivery</Label>
                              <div className="flex items-center gap-4">
                                <label className="flex items-center gap-1.5 cursor-pointer">
                                  <Checkbox
                                    checked={schedule?.deliver_to_app ?? true}
                                    onCheckedChange={(checked) => handleUpdateSchedule(a.id, key, "deliver_to_app", !!checked)}
                                  />
                                  <span className="font-body text-[13px] text-charcoal font-normal">Save in app</span>
                                </label>
                                <label className="flex items-center gap-1.5 cursor-pointer">
                                  <Checkbox
                                    checked={schedule?.deliver_to_slack ?? false}
                                    onCheckedChange={(checked) => handleUpdateSchedule(a.id, key, "deliver_to_slack", !!checked)}
                                  />
                                  <span className="font-body text-[13px] text-charcoal font-normal">Send to Slack</span>
                                </label>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            {!(accounts || []).length && (
              <p className="font-body text-[13px] text-sage text-center py-4">No accounts found.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Monthly Rollup Modal */}
      <MonthlyRollupModal open={showRollup} onOpenChange={setShowRollup} accounts={accounts || []} />
      <PortfolioReportModal open={showPortfolio} onOpenChange={setShowPortfolio} accounts={accounts || []} />
    </>
  );
};

export default ReportsPage;
