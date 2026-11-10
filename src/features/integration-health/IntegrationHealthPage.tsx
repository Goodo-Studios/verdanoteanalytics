// Integration health: staff page (consolidation step 4a, port of the Goodo OS page
// src/pages/staff/IntegrationHealth.tsx). Read-only. Shows what the
// integration-health server function finds: each connector's state, the work
// queue and the latest owner alert jobs. It never changes anything; switches and
// Slack destinations stay builder actions in the database.
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { edgeFunctionError } from "@/lib/edgeFunctionError";
import {
  ALERT_STATE,
  type ConnectorHealth,
  describeNote,
  describePattern,
  formatWhen,
  type HealthOverview,
  STATE_LABEL,
} from "./model";

const FN = "integration-health";

const STATE_STYLE: Record<ConnectorHealth["state"], string> = {
  healthy: "bg-emerald-50 text-emerald-800 border-emerald-200",
  needs_attention: "bg-amber-50 text-amber-900 border-amber-200",
  not_connected: "bg-muted text-muted-foreground border-border",
};

function ConnectorCard({ c }: { c: ConnectorHealth }) {
  return (
    <li aria-label={`${c.label} health`} className="space-y-2 rounded-lg border border-input bg-background p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">{c.label}</p>
        <span data-testid={`integration-health-state-${c.key}`} className={`rounded border px-2 py-0.5 text-[12px] ${STATE_STYLE[c.state]}`}>
          {STATE_LABEL[c.state]}
        </span>
      </div>
      {c.key === "clickup" || c.key === "verdanote_data" ? (
        <p className="text-muted-foreground">Last completed sync: {formatWhen(c.lastConfirmedAt)}</p>
      ) : null}
      {c.key === "clickup" && typeof c.details.boardRows === "number" ? (
        <p className="text-muted-foreground">{c.details.boardRows} card{c.details.boardRows === 1 ? "" : "s"} on the content board</p>
      ) : null}
      {c.key === "verdanote_data" && typeof c.details.activeAccounts === "number" ? (
        <p className="text-muted-foreground">{c.details.activeAccounts} active ad account{c.details.activeAccounts === 1 ? "" : "s"}</p>
      ) : null}
      {c.patterns.map((p) => (
        <p key={p} className="text-amber-900">{describePattern(p)}</p>
      ))}
      {c.notes.map((n) => (
        <p key={n} className="text-muted-foreground">{describeNote(n)}</p>
      ))}
    </li>
  );
}

export default function IntegrationHealthPage() {
  const [overview, setOverview] = useState<HealthOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    const { data, error: invokeError } = await supabase.functions.invoke(FN, { method: "GET" });
    if (current !== generation.current) return;
    if (invokeError) {
      setError(await edgeFunctionError(invokeError, "Integration health could not load."));
      setOverview(null);
    } else if (!data || !Array.isArray(data.connectors)) {
      setError("Integration health could not load.");
      setOverview(null);
    } else {
      setOverview(data as HealthOverview);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6" data-testid="integration-health">
      <PageHeader
        title="Integration health"
        description="Connector status, the work queue and owner alerts, as of the last check. This page is read-only."
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="mr-1 h-4 w-4" /> Check again
          </Button>
        }
      />
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {loading && !overview ? <p role="status" className="text-sm text-muted-foreground">Loading integration health...</p> : null}
      {overview ? (
        <>
          <p className="text-[12px] text-muted-foreground">
            Checked {formatWhen(overview.checkedAt)}
            {overview.environment === "production" ? "" : " · staging, where outside services are not connected"}
          </p>
          <section aria-labelledby="ih-connectors" className="space-y-3">
            <h2 id="ih-connectors" className="text-base font-semibold">Connectors</h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {overview.connectors.map((c) => <ConnectorCard key={c.key} c={c} />)}
            </ul>
          </section>
          <section aria-labelledby="ih-queue" className="space-y-2">
            <h2 id="ih-queue" className="text-base font-semibold">Work queue</h2>
            <p className="text-sm" data-testid="integration-health-queue">
              {overview.queue.state === "healthy" ? "Healthy" : "Needs attention"} · {overview.queue.pending} pending job{overview.queue.pending === 1 ? "" : "s"}
            </p>
            {overview.queue.patterns.map((p) => (
              <p key={p} className="text-sm text-amber-900">{describePattern(p)}</p>
            ))}
          </section>
          <section aria-labelledby="ih-alerts" className="space-y-2">
            <h2 id="ih-alerts" className="text-base font-semibold">Owner alerts</h2>
            {overview.ownerAlerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No owner alerts have been queued.</p>
            ) : (
              <ul className="space-y-2">
                {overview.ownerAlerts.map((a) => (
                  <li key={a.id} className="rounded border border-input p-3 text-sm">
                    <p className="font-medium">{ALERT_STATE[a.state] ?? a.state}</p>
                    <p className="text-muted-foreground">Queued {formatWhen(a.createdAt)} · updated {formatWhen(a.updatedAt)}</p>
                    {a.text ? <p className="mt-1 whitespace-pre-wrap">{a.text}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
