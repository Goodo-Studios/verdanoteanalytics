import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, AlertTriangle, Clock, RefreshCw, History, ChevronLeft, ChevronRight, Ban } from "lucide-react";
import { useState, useMemo, useEffect, useRef } from "react";
import { useSyncHistory, useSync, useCancelSync } from "@/hooks/useSyncApi";
import { useAccounts } from "@/hooks/useAccountsApi";
import { useIsSyncing } from "@/hooks/useIsSyncing";
import { toast } from "sonner";

const PAGE_SIZE = 10;

const statusConfig: Record<string, { label: string; icon: typeof CheckCircle2; className: string }> = {
  completed: { label: "Completed", icon: CheckCircle2, className: "text-verdant" },
  completed_with_errors: { label: "Partial", icon: AlertTriangle, className: "text-gold" },
  failed: { label: "Failed", icon: XCircle, className: "text-red-600" },
  running: { label: "Running", icon: Clock, className: "text-primary" },
  cancelled: { label: "Cancelled", icon: Ban, className: "text-muted-foreground" },
};

function SyncProgressBanner({ logs, onCancel, cancelPending }: { logs: any[]; onCancel: () => void; cancelPending: boolean }) {
  const runningLog = logs?.find((l: any) => l.status === "running");
  const [elapsed, setElapsed] = useState(0);

  // Calculate average duration from completed syncs
  const avgDuration = useMemo(() => {
    const completed = (logs || []).filter((l: any) => l.status === "completed" && l.duration_ms);
    if (completed.length === 0) return null;
    const total = completed.reduce((sum: number, l: any) => sum + l.duration_ms, 0);
    return total / completed.length;
  }, [logs]);

  useEffect(() => {
    if (!runningLog) { setElapsed(0); return; }
    const start = new Date(runningLog.started_at).getTime();
    const tick = () => setElapsed(Date.now() - start);
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [runningLog?.id]);

  if (!runningLog) return null;

  const elapsedSec = Math.floor(elapsed / 1000);
  const elapsedMin = Math.floor(elapsedSec / 60);
  const elapsedRemSec = elapsedSec % 60;
  const progress = avgDuration ? Math.min(95, (elapsed / avgDuration) * 100) : null;

  const estRemaining = avgDuration ? Math.max(0, Math.ceil((avgDuration - elapsed) / 1000)) : null;
  const estMin = estRemaining != null ? Math.floor(estRemaining / 60) : null;
  const estSec = estRemaining != null ? estRemaining % 60 : null;

  return (
    <div className="glass-panel p-3 border border-primary/30 bg-primary/5 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span className="text-xs font-medium">Sync in progress…</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground font-mono">
            <span>Elapsed: {elapsedMin}:{String(elapsedRemSec).padStart(2, "0")}</span>
            {estMin != null && estSec != null && (
              <span>Est. remaining: ~{estMin}:{String(estSec).padStart(2, "0")}</span>
            )}
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive" onClick={onCancel} disabled={cancelPending}>
            {cancelPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Ban className="h-3 w-3 mr-1" />}
            Cancel
          </Button>
        </div>
      </div>
      {progress != null && (
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-progress"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span>Type: <Badge variant="outline" className="text-[9px] ml-0.5">{runningLog.sync_type}</Badge></span>
        {runningLog.creatives_fetched > 0 && (
          <span>Fetched: {runningLog.creatives_fetched}</span>
        )}
        {avgDuration && <span>Avg sync: {(avgDuration / 1000).toFixed(0)}s</span>}
      </div>
    </div>
  );
}

function RunningDuration({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = new Date(startedAt).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return <span>{mins}:{String(secs).padStart(2, "0")}</span>;
}

export function SyncHistorySection({ accountId }: { accountId?: string }) {
  const [selectedLog, setSelectedLog] = useState<any>(null);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { data: accounts } = useAccounts();
  const { data: logs, isLoading } = useSyncHistory(accountId);
  const syncMut = useSync();
  const cancelMut = useCancelSync();
  const isSyncing = useIsSyncing();
  const prevRunningIdsRef = useRef<Set<number>>(new Set());

  // Notify when a running sync completes or fails
  useEffect(() => {
    if (!logs) return;
    const currentRunning = new Set(
      logs.filter((l: any) => l.status === "running").map((l: any) => l.id)
    );
    const prev = prevRunningIdsRef.current;

    // Check if any previously-running sync has finished
    for (const id of prev) {
      if (!currentRunning.has(id)) {
        const log = logs.find((l: any) => l.id === id);
        if (log) {
          if (log.status === "completed") {
            toast.success("Sync completed", {
              description: `${log.creatives_upserted ?? 0} creatives synced in ${log.duration_ms ? (log.duration_ms / 1000).toFixed(1) + "s" : "—"}`,
            });
          } else if (log.status === "completed_with_errors") {
            toast.warning("Sync completed with errors", {
              description: `${log.creatives_upserted ?? 0} creatives synced — check details for errors.`,
            });
          } else if (log.status === "failed") {
            toast.error("Sync failed", {
              description: "Open sync details for more information.",
            });
          }
        }
      }
    }

    prevRunningIdsRef.current = currentRunning as Set<number>;
  }, [logs]);

  const filteredLogs = useMemo(() => {
    if (!logs) return [];
    if (statusFilter === "all") return logs;
    return logs.filter((l: any) => l.status === statusFilter);
  }, [logs, statusFilter]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE)), [filteredLogs]);
  const pagedLogs = useMemo(() => filteredLogs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filteredLogs, page]);

  // Reset page when filter changes
  const handleStatusChange = (v: string) => {
    setStatusFilter(v);
    setPage(0);
  };

  const getAccountName = (id: string) => {
    const a = (accounts || []).find((a: any) => a.id === id);
    return a?.name || id;
  };

  const fmtDuration = (ms: number | null) => {
    if (!ms) return "—";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="space-y-4">
      <SyncProgressBanner logs={logs || []} onCancel={() => cancelMut.mutate(undefined as any)} cancelPending={cancelMut.isPending} />

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-heading text-[22px] text-forest">Sync History</h3>
            <p className="font-body text-[13px] text-slate font-light">Recent sync operations for this account.</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={handleStatusChange}>
              <SelectTrigger className="w-32 h-8 font-body text-[13px] text-charcoal bg-background border-border-light rounded-[6px]">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="completed_with_errors">Partial</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="bg-card font-body text-[13px] font-medium"
              onClick={() => syncMut.mutate({ account_id: accountId || "all" })}
              disabled={syncMut.isPending || isSyncing}
            >
              {(syncMut.isPending || isSyncing) ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
              {(syncMut.isPending || isSyncing) ? "Syncing…" : "Resync"}
            </Button>
          </div>
        </div>
        {(syncMut.isPending || isSyncing) && (() => {
          const runningLog = (logs || []).find((l: any) => l.status === "running");
          const fetched = runningLog?.creatives_fetched ?? 0;
          const upserted = runningLog?.creatives_upserted ?? 0;
          const isDeterminate = runningLog && fetched > 0;
          const progressPct = isDeterminate
            ? Math.min(95, (upserted / fetched) * 100)
            : null;

          return (
            <div className="space-y-1">
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                {progressPct != null ? (
                  <div
                    className="h-full rounded-full bg-primary transition-progress"
                    style={{ width: `${progressPct}%` }}
                  />
                ) : (
                  <div className="h-full rounded-full bg-primary animate-progress-indeterminate" />
                )}
              </div>
              {isDeterminate && (
                <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                  <span>{upserted} / {fetched} creatives</span>
                  <span>{Math.round(progressPct!)}%</span>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : !filteredLogs.length ? (
        <div className="glass-panel flex flex-col items-center justify-center py-12 text-center">
          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-3">
            <History className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">
            {statusFilter !== "all" ? `No ${statusConfig[statusFilter]?.label.toLowerCase() || statusFilter} syncs found.` : "No sync history yet."}
          </p>
        </div>
      ) : (
        <div className="glass-panel overflow-hidden">
          <Table>
             <TableHeader>
              <TableRow className="bg-cream-dark">
                {!accountId && <TableHead className="font-label text-[10px] uppercase tracking-[0.04em] text-slate font-semibold">Account</TableHead>}
                <TableHead className="font-label text-[10px] uppercase tracking-[0.04em] text-slate font-semibold">Type</TableHead>
                <TableHead className="font-label text-[10px] uppercase tracking-[0.04em] text-slate font-semibold">Status</TableHead>
                <TableHead className="font-label text-[10px] uppercase tracking-[0.04em] text-slate font-semibold">Date Range</TableHead>
                <TableHead className="font-label text-[10px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Fetched</TableHead>
                <TableHead className="font-label text-[10px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Upserted</TableHead>
                <TableHead className="font-label text-[10px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Duration</TableHead>
                <TableHead className="font-label text-[10px] uppercase tracking-[0.04em] text-slate font-semibold">Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedLogs.map((log: any) => {
                const sc = statusConfig[log.status] || statusConfig.running;
                const StatusIcon = sc.icon;
                return (
                  <TableRow key={log.id} className="cursor-pointer hover:bg-accent/50 border-b border-border-light" style={{ verticalAlign: "middle" }} onClick={() => setSelectedLog(log)}>
                    {!accountId && <TableCell className="font-body text-[13px] font-medium text-charcoal py-3">{getAccountName(log.account_id)}</TableCell>}
                    <TableCell className="py-3"><Badge className="font-label text-[10px] font-medium bg-cream-dark text-slate rounded-[4px] tracking-wide border-0">{log.sync_type}</Badge></TableCell>
                    <TableCell className="py-3">
                      <div className="flex items-center gap-1.5">
                        <div className={`flex items-center gap-1.5 font-label text-[10px] font-semibold ${sc.className}`}>
                          <StatusIcon className="h-3 w-3" />
                          {sc.label}
                        </div>
                        {log.sync_state?.audit && (
                          log.sync_state.audit.drift_exceeded
                            ? <Badge variant="outline" className="text-[9px] border-gold/50 text-gold px-1 py-0">⚠ {log.sync_state.audit.spend_delta_pct}%</Badge>
                            : <Badge variant="outline" className="text-[9px] border-verdant/50 text-verdant px-1 py-0">✓</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-3">
                      {log.date_range_start && log.date_range_end ? (
                        <span className="font-data text-[12px] font-medium text-slate">
                          {log.date_range_start} <span className="text-sage">→</span> {log.date_range_end}
                        </span>
                      ) : <span className="text-sage">—</span>}
                    </TableCell>
                    <TableCell className="text-right py-3">
                      <span className="font-data text-[17px] font-medium text-charcoal tabular-nums">{log.creatives_fetched ?? <span className="text-sage">—</span>}</span>
                    </TableCell>
                    <TableCell className="text-right py-3">
                      <span className="font-data text-[17px] font-medium text-charcoal tabular-nums">{log.creatives_upserted ?? <span className="text-sage">—</span>}</span>
                    </TableCell>
                    <TableCell className="text-right py-3">
                      <span className="font-data text-[17px] font-medium text-charcoal">
                        {log.status === "running"
                          ? <span className="text-primary"><RunningDuration startedAt={log.started_at} /></span>
                          : fmtDuration(log.duration_ms) === "—" ? <span className="text-sage">—</span> : fmtDuration(log.duration_ms)}
                      </span>
                    </TableCell>
                    <TableCell className="py-3"><span className="font-data text-[12px] text-slate">{new Date(log.started_at).toLocaleString()}</span></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2 border-t border-border">
              <span className="text-[10px] text-muted-foreground">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filteredLogs.length)} of {filteredLogs.length}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="text-xs font-mono px-1">{page + 1}/{totalPages}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sync Detail Modal */}
      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          {selectedLog && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  Sync Details
                  <Badge variant="outline" className="text-xs">{selectedLog.sync_type}</Badge>
                  {(() => {
                    const sc = statusConfig[selectedLog.status] || statusConfig.running;
                    const StatusIcon = sc.icon;
                    return <span className={`flex items-center gap-1 text-xs ${sc.className}`}><StatusIcon className="h-3 w-3" />{sc.label}</span>;
                  })()}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div className="glass-panel p-2.5">
                    <div className="metric-label text-[10px]">Account</div>
                    <div className="font-medium mt-0.5">{getAccountName(selectedLog.account_id)}</div>
                  </div>
                  <div className="glass-panel p-2.5">
                    <div className="metric-label text-[10px]">Duration</div>
                    <div className="font-mono font-medium mt-0.5">{fmtDuration(selectedLog.duration_ms)}</div>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2">
                  <div className="glass-panel p-2.5 text-center">
                    <div className="metric-label text-[10px]">Fetched</div>
                    <div className="font-mono font-semibold mt-0.5">{selectedLog.creatives_fetched ?? 0}</div>
                  </div>
                  <div className="glass-panel p-2.5 text-center">
                    <div className="metric-label text-[10px]">Upserted</div>
                    <div className="font-mono font-semibold mt-0.5">{selectedLog.creatives_upserted ?? 0}</div>
                  </div>
                  <div className="glass-panel p-2.5 text-center">
                    <div className="metric-label text-[10px]">API Calls</div>
                    <div className="font-mono font-semibold mt-0.5">{selectedLog.meta_api_calls ?? 0}</div>
                  </div>
                  <div className="glass-panel p-2.5 text-center">
                    <div className="metric-label text-[10px]">Date Range</div>
                    <div className="font-mono font-semibold mt-0.5 text-[10px]">{selectedLog.date_range_start || "—"}</div>
                  </div>
                </div>

                {/* Tag Breakdown */}
                <div>
                  <p className="font-medium mb-1.5">Tag Breakdown</p>
                  <div className="grid grid-cols-4 gap-2">
                    <div className="glass-panel p-2 text-center">
                      <div className="text-[10px] text-tag-parsed">Parsed</div>
                      <div className="font-mono font-semibold">{selectedLog.tags_parsed ?? 0}</div>
                    </div>
                    <div className="glass-panel p-2 text-center">
                      <div className="text-[10px] text-tag-csv">CSV</div>
                      <div className="font-mono font-semibold">{selectedLog.tags_csv_matched ?? 0}</div>
                    </div>
                    <div className="glass-panel p-2 text-center">
                      <div className="text-[10px] text-tag-manual">Manual</div>
                      <div className="font-mono font-semibold">{selectedLog.tags_manual_preserved ?? 0}</div>
                    </div>
                    <div className="glass-panel p-2 text-center">
                      <div className="text-[10px] text-tag-untagged">Untagged</div>
                      <div className="font-mono font-semibold">{selectedLog.tags_untagged ?? 0}</div>
                    </div>
                  </div>
                </div>

                {/* Post-Sync Audit */}
                {(() => {
                  const audit = selectedLog.sync_state?.audit;
                  if (!audit) return null;
                  const isOk = !audit.drift_exceeded;
                  return (
                    <div>
                      <p className="font-medium mb-1.5 flex items-center gap-1.5">
                        {isOk ? <CheckCircle2 className="h-3 w-3 text-verdant" /> : <AlertTriangle className="h-3 w-3 text-gold" />}
                        Spend Audit
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="glass-panel p-2 text-center">
                          <div className="text-[10px] text-muted-foreground">Meta</div>
                          <div className="font-mono font-semibold mt-0.5">${audit.meta_spend?.toLocaleString()}</div>
                        </div>
                        <div className="glass-panel p-2 text-center">
                          <div className="text-[10px] text-muted-foreground">Local Daily</div>
                          <div className="font-mono font-semibold mt-0.5">${audit.local_spend?.toLocaleString()}</div>
                        </div>
                        <div className={`glass-panel p-2 text-center ${isOk ? "border-verdant/30" : "border-gold/30"}`}>
                          <div className="text-[10px] text-muted-foreground">Delta</div>
                          <div className={`font-mono font-semibold mt-0.5 ${isOk ? "text-verdant" : "text-gold"}`}>
                            {audit.spend_delta_pct >= 0 ? "+" : ""}{audit.spend_delta_pct}%
                          </div>
                        </div>
                      </div>
                      {audit.drift_exceeded && (
                        <p className="text-[10px] text-gold mt-1.5 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          Spend drift exceeds 2% threshold — consider a full re-sync
                        </p>
                      )}
                    </div>
                  );
                })()}

                {/* Errors */}
                {(() => {
                  try {
                    const errors = JSON.parse(selectedLog.api_errors || "[]");
                    if (errors.length === 0) return null;
                    return (
                      <div>
                        <p className="font-medium mb-1.5 text-kill">API Errors ({errors.length})</p>
                        <div className="space-y-1">
                          {errors.map((err: any, i: number) => (
                            <div key={i} className="glass-panel p-2 text-[10px]">
                              <span className="text-muted-foreground">{new Date(err.timestamp).toLocaleTimeString()}</span>
                              <span className="ml-2">{err.message}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  } catch { return null; }
                })()}

                {/* Resync this account button */}
                <div className="pt-2 border-t border-border">
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      syncMut.mutate({ account_id: selectedLog.account_id });
                      setSelectedLog(null);
                    }}
                    disabled={syncMut.isPending || isSyncing}
                  >
                    {(syncMut.isPending || isSyncing) ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                    Resync {getAccountName(selectedLog.account_id)}
                  </Button>
                </div>

                <div className="text-[10px] text-muted-foreground">
                  Started: {new Date(selectedLog.started_at).toLocaleString()}
                  {selectedLog.completed_at && <> · Completed: {new Date(selectedLog.completed_at).toLocaleString()}</>}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
