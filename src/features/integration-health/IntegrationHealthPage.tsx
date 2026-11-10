// Integration health: staff page (consolidation step 4a, port of the Goodo OS page
// src/pages/staff/IntegrationHealth.tsx). Shows what the integration-health server
// function finds: each connector's state, the work queue and the latest owner alert
// jobs. Switches and Slack destinations stay builder actions in the database.
//
// Alerts (step 4d, port of the Goodo OS alert commands): staff record an expected
// exception or a false positive for an open problem, for 1 to 24 hours, through the
// checked function record_alert_exception; covered problems show as suppressed. A
// builder's "Check and alert now" asks the function which owner alerts the open
// problems call for; they are queued only from production, never from staging.
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRolePrefix } from "@/hooks/useRolePath";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { edgeFunctionError } from "@/lib/edgeFunctionError";
import {
  ALERT_STATE,
  type AlertConnector,
  CONNECTOR_LABEL,
  type EvaluatedAlert,
  evaluatedText,
  exceptionTargets,
  type ExceptionKind,
  KIND_LABEL,
  kindsFor,
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
      {(c.suppressed ?? []).map((p) => (
        <p key={`s-${p}`} className="text-muted-foreground">Suppressed by an exception: {describePattern(p)}</p>
      ))}
      {c.notes.map((n) => (
        <p key={n} className="text-muted-foreground">{describeNote(n)}</p>
      ))}
    </li>
  );
}

const rpcDb = supabase as unknown as { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }> };
const field = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

function ExceptionForm({ overview, onSaved }: { overview: HealthOverview; onSaved: () => void }) {
  const targets = exceptionTargets(overview);
  const [target, setTarget] = useState("");
  const [kind, setKind] = useState<ExceptionKind>("false_positive");
  const [reason, setReason] = useState("");
  const [hours, setHours] = useState("4");
  const [error, setError] = useState<string | null>(null);
  if (targets.length === 0) return <p className="text-sm text-muted-foreground">No open problem to record an exception for.</p>;
  const [connector, pattern] = target ? (target.split("|") as [AlertConnector, string]) : [null, null];
  const kinds = pattern ? kindsFor(pattern) : [];
  const h = Number(hours);
  const ready = !!connector && kinds.includes(kind) && reason.trim().length > 0 && reason.length <= 500 && Number.isInteger(h) && h >= 1 && h <= 24;
  const save = async () => {
    setError(null);
    const { error: e } = await rpcDb.rpc("record_alert_exception", { p_connector: connector, p_pattern: pattern, p_kind: kind, p_reason: reason.trim(), p_hours: h });
    if (e) return setError(e.code === "42501" ? "Only staff can record an exception." : e.code === "22023" ? "That kind does not fit this problem, or the hours are outside 1 to 24." : "The exception could not be saved.");
    setTarget("");
    setReason("");
    onSaved();
  };
  return (
    <div role="group" aria-label="Record an exception" className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <select aria-label="Problem" className={field} value={target} onChange={(e) => { setTarget(e.target.value); setKind(kindsFor(e.target.value.split("|")[1] ?? "")[0] ?? "false_positive"); }}>
          <option value="">Choose an open problem</option>
          {targets.map((t) => <option key={`${t.connector}|${t.pattern}`} value={`${t.connector}|${t.pattern}`}>{CONNECTOR_LABEL[t.connector]}: {t.pattern}</option>)}
        </select>
        <select aria-label="Kind" className={field} value={kind} disabled={!pattern} onChange={(e) => setKind(e.target.value as ExceptionKind)}>
          {(kinds.length ? kinds : (["false_positive"] as ExceptionKind[])).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <input aria-label="Reason" className={field} placeholder="Why this is expected or wrong" value={reason} onChange={(e) => setReason(e.target.value)} />
        <input aria-label="Hours (1 to 24)" className={field} inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} />
      </div>
      <Button size="sm" variant="outline" disabled={!ready} onClick={() => void save()}>Record exception</Button>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}

export default function IntegrationHealthPage() {
  const { isBuilder } = useAuth();
  const [evaluated, setEvaluated] = useState<EvaluatedAlert[] | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [overview, setOverview] = useState<HealthOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const prefix = useRolePrefix();

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

  const evaluate = async () => {
    setEvalError(null);
    setEvaluated(null);
    const { data, error: invokeError } = await supabase.functions.invoke(FN, { method: "POST", body: { action: "evaluate" } });
    if (invokeError) return setEvalError(await edgeFunctionError(invokeError, "The check could not run."));
    setEvaluated(Array.isArray(data?.alerts) ? (data.alerts as EvaluatedAlert[]) : []);
    void load();
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6" data-testid="integration-health">
      <PageHeader
        title="Integration health"
        description="Connector status, the work queue and owner alerts, as of the last check. Expected problems can be marked so they do not alert."
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
            <p className="text-sm">
              <Link className="underline" to={`${prefix}/operations`}>Open Operations</Link> to replay, resolve or cancel jobs.
            </p>
          </section>
          <section aria-labelledby="ih-exceptions" className="space-y-2">
            <h2 id="ih-exceptions" className="text-base font-semibold">Alert exceptions</h2>
            {(overview.exceptions ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No active exceptions.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {(overview.exceptions ?? []).map((x) => (
                  <li key={x.id} className="rounded border border-input p-2">
                    {CONNECTOR_LABEL[x.connector]}: {x.pattern} · {KIND_LABEL[x.kind]} · until {formatWhen(x.expiresAt)} · {x.reason}
                  </li>
                ))}
              </ul>
            )}
            <ExceptionForm key={overview.checkedAt} overview={overview} onSaved={() => void load()} />
            {isBuilder ? (
              <div className="space-y-1">
                <Button size="sm" onClick={() => void evaluate()}>Check and alert now</Button>
                {evalError ? <p role="alert" className="text-sm text-red-700">{evalError}</p> : null}
                {evaluated ? (
                  <ul aria-label="Check result" className="space-y-1 text-sm">
                    {evaluated.length === 0 ? <li>No open problem calls for an owner alert.</li> : null}
                    {evaluated.map((a) => <li key={a.key}>{CONNECTOR_LABEL[a.connector]}: {describePattern(a.pattern)} · {evaluatedText(a)}</li>)}
                  </ul>
                ) : null}
              </div>
            ) : null}
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
