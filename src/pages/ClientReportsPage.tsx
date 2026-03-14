import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Eye, Download } from "lucide-react";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import { useMemo } from "react";
import { useRoleNavigate } from "@/hooks/useRolePath";
import { useReports } from "@/hooks/useReportsApi";
import { useAccountContext } from "@/contexts/AccountContext";
import { exportReportCSV } from "@/lib/csv";

const ClientReportsPage = () => {
  const { selectedAccountId } = useAccountContext();
  const navigate = useRoleNavigate();
  const { data: rawReports, isLoading } = useReports();

  const reports = useMemo(() => {
    if (!rawReports) return [];
    if (!selectedAccountId || selectedAccountId === "all") return rawReports;
    return rawReports.filter((r: any) => r.account_id === selectedAccountId);
  }, [rawReports, selectedAccountId]);

  const fmt = fmtMetric;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-[32px] text-forest">Reports</h1>
          <p className="font-body text-[13px] text-slate font-light mt-1">Performance reports from your creative team</p>
        </div>

        {isLoading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : !reports?.length ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <FileText className="h-6 w-6 text-sage" />
            </div>
            <h3 className="font-heading text-[22px] text-forest mb-1">No reports yet</h3>
            <p className="font-body text-[14px] text-slate max-w-[400px]">
              Your team will share performance reports here. Check back soon.
            </p>
          </div>
        ) : (
          <div className="glass-panel overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-cream-dark">
                  <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Report</TableHead>
                  <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Date Range</TableHead>
                  <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Generated</TableHead>
                  <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Spend</TableHead>
                  <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">ROAS</TableHead>
                  <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((r: any) => (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-accent/50 border-b border-border-light" onClick={() => navigate(`/reports/${r.id}`)}>
                    <TableCell>
                      <div className="font-body text-[15px] font-semibold text-charcoal">{r.report_name}</div>
                      {r.date_range_days && <div className="font-data text-[13px] text-slate">{r.date_range_days} days</div>}
                    </TableCell>
                    <TableCell className="font-data text-[13px] text-slate">
                      {r.date_range_start && r.date_range_end ? `${r.date_range_start} → ${r.date_range_end}` : "—"}
                    </TableCell>
                    <TableCell className="font-data text-[13px] text-slate">
                      {new Date(r.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="font-data text-[13px] text-right tabular-nums">{fmt(r.total_spend, "$")}</TableCell>
                    <TableCell className="font-data text-[13px] text-right tabular-nums">{fmt(r.blended_roas, "", "x")}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end">
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={(e) => { e.stopPropagation(); exportReportCSV(r); }}>
                          <Download className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={(e) => { e.stopPropagation(); navigate(`/reports/${r.id}`); }}>
                          <Eye className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default ClientReportsPage;
