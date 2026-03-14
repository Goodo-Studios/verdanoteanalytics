import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, RefreshCw, CheckCircle, AlertTriangle, XCircle,
  Activity, Clock, Shield,
} from "lucide-react";
import { useState } from "react";

interface Finding {
  severity: "pass" | "warn" | "fail";
  category: string;
  message: string;
  details?: Record<string, unknown>;
}

interface HealthCheck {
  id: number;
  checked_at: string;
  status: string;
  findings: string | Finding[];
  summary: { total_checks: number; pass: number; warn: number; fail: number };
  duration_ms: number;
}

function useHealthChecks() {
  return useQuery<HealthCheck[]>({
    queryKey: ["health-checks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("health_checks")
        .select("*")
        .order("checked_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data || []) as unknown as HealthCheck[];
    },
  });
}

const severityIcon = {
  pass: <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />,
  warn: <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />,
  fail: <XCircle className="h-3.5 w-3.5 text-red-600" />,
};

const statusBadge: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  pass: { label: "Healthy", variant: "secondary" },
  warn: { label: "Warnings", variant: "outline" },
  fail: { label: "Issues", variant: "destructive" },
};

function formatAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function SystemHealthSection() {
  const { data: checks, isLoading } = useHealthChecks();
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const runCheck = async () => {
    setRunning(true);
    try {
      await apiFetch("system-health-check", "", { method: "POST" });
      queryClient.invalidateQueries({ queryKey: ["health-checks"] });
    } catch {
      // toast handled by apiFetch
    } finally {
      setRunning(false);
    }
  };

  const latest = checks?.[0];
  const latestFindings: Finding[] = latest
    ? (typeof latest.findings === "string" ? JSON.parse(latest.findings) : latest.findings)
    : [];

  return (
    <section className="glass-panel p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Activity className="h-4.5 w-4.5 text-primary" />
          </div>
          <div>
            <h2 className="font-heading text-[20px] text-forest">System Health</h2>
            <p className="font-body text-[13px] text-slate font-light mt-0.5">
              Automated data integrity and edge function monitoring — runs every 12 hours.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={runCheck}
          disabled={running}
          className="gap-1.5"
        >
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Run Now
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !latest ? (
        <div className="rounded-lg border border-border-light p-8 text-center">
          <Shield className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-body text-[13px] text-slate">
            No health checks recorded yet. Click <strong>Run Now</strong> to start the first scan.
          </p>
        </div>
      ) : (
        <>
          {/* Latest result summary */}
          <div className="rounded-lg border border-border-light p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {severityIcon[latest.status as keyof typeof severityIcon] || severityIcon.warn}
                <Badge variant={statusBadge[latest.status]?.variant || "outline"}>
                  {statusBadge[latest.status]?.label || latest.status}
                </Badge>
                <span className="font-body text-[12px] text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatAgo(latest.checked_at)}
                </span>
              </div>
              <span className="font-data text-[11px] text-muted-foreground">
                {latest.summary.total_checks} checks • {latest.duration_ms}ms
              </span>
            </div>

            {/* Summary pills */}
            <div className="flex gap-3">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/30">
                <CheckCircle className="h-3 w-3 text-emerald-600" />
                <span className="font-data text-[13px] text-emerald-700 dark:text-emerald-400">{latest.summary.pass} pass</span>
              </div>
              {latest.summary.warn > 0 && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 dark:bg-amber-950/30">
                  <AlertTriangle className="h-3 w-3 text-amber-600" />
                  <span className="font-data text-[13px] text-amber-700 dark:text-amber-400">{latest.summary.warn} warn</span>
                </div>
              )}
              {latest.summary.fail > 0 && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-50 dark:bg-red-950/30">
                  <XCircle className="h-3 w-3 text-red-600" />
                  <span className="font-data text-[13px] text-red-700 dark:text-red-400">{latest.summary.fail} fail</span>
                </div>
              )}
            </div>
          </div>

          {/* Findings list */}
          <div className="space-y-1.5">
            <h3 className="font-label text-[10px] font-semibold uppercase tracking-[0.08em] text-slate">Findings</h3>
            {latestFindings.map((f, i) => (
              <button
                key={i}
                onClick={() => setExpanded(expanded === i ? null : i)}
                className="w-full text-left rounded-md border border-border-light px-3 py-2 hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {severityIcon[f.severity]}
                  <span className="font-body text-[13px] text-charcoal flex-1">{f.message}</span>
                  <Badge variant="outline" className="font-label text-[9px] uppercase tracking-wider">
                    {f.category}
                  </Badge>
                </div>
                {expanded === i && f.details && (
                  <pre className="mt-2 p-2 rounded bg-muted/50 font-data text-[11px] text-muted-foreground overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(f.details, null, 2)}
                  </pre>
                )}
              </button>
            ))}
          </div>

          {/* History */}
          {checks && checks.length > 1 && (
            <div className="space-y-1.5">
              <h3 className="font-label text-[10px] font-semibold uppercase tracking-[0.08em] text-slate">History</h3>
              <div className="flex flex-wrap gap-2">
                {checks.slice(1).map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border-light"
                    title={new Date(c.checked_at).toLocaleString()}
                  >
                    {severityIcon[c.status as keyof typeof severityIcon] || severityIcon.warn}
                    <span className="font-data text-[11px] text-muted-foreground">
                      {formatAgo(c.checked_at)}
                    </span>
                    <span className="font-data text-[11px] text-muted-foreground">
                      {c.summary.pass}✓ {c.summary.warn}⚠ {c.summary.fail}✗
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
