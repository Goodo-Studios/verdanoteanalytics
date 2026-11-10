// Operations: staff page (consolidation step 4d, port of the Goodo OS operator recovery
// page src/pages/staff/Operations.tsx). Lists the durable job queue (reminders, owner
// alerts and any later job kind) with each job's history and next step. Staff replay a
// job in recovery or resolve it by hand with an outcome and a note, and cancel a queued
// job that was never claimed. Every write goes through a checked database function
// (replay_job, resolve_job_manually, cancel_queued_job); clients read no jobs. The page
// never reads a job's payload. Integration health shows the queue summary and links here.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRolePrefix } from "@/hooks/useRolePath";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  actionLabel,
  actorLabel,
  auditDetail,
  boundedCause,
  boundedReceipt,
  errorText,
  formatWhen,
  type Job,
  JOB_LIMIT,
  JOB_SELECT,
  type JobRow,
  kindLabel,
  NEXT_STEP_LABEL,
  noteError,
  OUTCOME_LABEL,
  reasonError,
  STATE_FILTERS,
  STATE_LABEL,
  type StateFilter,
  toJob,
} from "./model";

// durable_jobs is read through a small untyped surface so the page selects only the
// columns it needs (never payload).
interface DbResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}
interface Query extends PromiseLike<DbResult> {
  eq(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  order(column: string, options?: { ascending: boolean }): Query;
  limit(n: number): Query;
}
interface Untyped {
  from(table: string): { select(columns: string): Query };
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<DbResult>;
}
const db = supabase as unknown as Untyped;
const field = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

interface ClientOption {
  slug: string;
  name: string;
}

function JobActions({ job, onChanged }: { job: Job; onChanged: () => void }) {
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (name: string, args: Record<string, unknown>, fallback: string) => {
    setBusy(true);
    setError(null);
    const { error: e } = await db.rpc(name, args);
    setBusy(false);
    if (e) return setError(errorText(e.code, fallback));
    onChanged();
  };

  if (job.nextStep === "replay") {
    const resolveProblem = outcome ? noteError(note) : "Choose what happened.";
    return (
      <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3">
        <Button size="sm" disabled={busy} onClick={() => void run("replay_job", { p_job_id: job.id }, "The job could not be replayed.")}>
          Replay
        </Button>
        {job.canResolve ? (
          <details>
            <summary className="cursor-pointer font-medium">Resolve by hand</summary>
            <div className="mt-2 space-y-2">
              <select aria-label="Outcome" className={field} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                <option value="">What happened?</option>
                {Object.entries(OUTCOME_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <textarea aria-label="Resolution note" className={field} placeholder="What you checked in the outside service" value={note} onChange={(e) => setNote(e.target.value)} />
              {note && resolveProblem ? <p className="text-[12px] text-muted-foreground">{resolveProblem}</p> : null}
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !!resolveProblem}
                onClick={() => void run("resolve_job_manually", { p_job_id: job.id, p_outcome: outcome, p_note: note.trim() }, "The job could not be resolved.")}
              >
                Resolve
              </Button>
            </div>
          </details>
        ) : null}
        {error ? <p role="alert" className="text-red-700">{error}</p> : null}
      </div>
    );
  }

  if (job.nextStep === "cancel") {
    const problem = reasonError(reason);
    return (
      <details>
        <summary className="cursor-pointer font-medium">Cancel this job</summary>
        <div className="mt-2 space-y-2">
          <input aria-label="Cancel reason" className={field} placeholder="Why it should not run" value={reason} onChange={(e) => setReason(e.target.value)} />
          {reason && problem ? <p className="text-[12px] text-muted-foreground">{problem}</p> : null}
          <Button size="sm" variant="outline" disabled={busy || !!problem}
            onClick={() => void run("cancel_queued_job", { p_job_id: job.id, p_reason: reason.trim() }, "The job could not be canceled.")}>
            Cancel job
          </Button>
          {error ? <p role="alert" className="text-red-700">{error}</p> : null}
        </div>
      </details>
    );
  }
  return null;
}

function JobCard({ job, names, clientName, onChanged }: { job: Job; names: Record<string, string>; clientName: string | null; onChanged: () => void }) {
  const cause = boundedCause(job.last_error);
  const receipt = boundedReceipt(job.receipt);
  return (
    <li aria-label={`Job ${kindLabel(job.kind)} ${job.id.slice(0, 8)}`} className="space-y-2 rounded-lg border border-input bg-background p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">{kindLabel(job.kind)}</p>
        <span data-testid={`job-state-${job.id}`} className="rounded border px-2 py-0.5 text-[12px]">{STATE_LABEL[job.state]}</span>
      </div>
      <p className="text-[12px] text-muted-foreground">
        {clientName ? `${clientName} · ` : ""}attempt {job.attempts} of {job.max_attempts} · queued {formatWhen(job.created_at)} · updated {formatWhen(job.updated_at)}
        {job.state === "queued" ? ` · due ${formatWhen(job.available_at)}` : ""}
        {job.state === "leased" ? ` · lease until ${formatWhen(job.lease_until)}` : ""}
      </p>
      {cause ? <p className="text-amber-900">Cause: {cause}</p> : null}
      {receipt ? <p className="text-muted-foreground">Receipt: {Object.entries(receipt).map(([k, v]) => `${k} ${v}`).join(" · ")}</p> : null}
      {job.manualResolution ? (
        <p className="text-muted-foreground">
          {OUTCOME_LABEL[job.manualResolution.outcome] ?? job.manualResolution.outcome} · {actorLabel(job.manualResolution.actor, names)}, {formatWhen(job.manualResolution.at)}: {job.manualResolution.note}
        </p>
      ) : null}
      <p className="text-muted-foreground" data-testid={`job-next-${job.id}`}>{NEXT_STEP_LABEL[job.nextStep]}</p>
      <JobActions job={job} onChanged={onChanged} />
      {job.history.length ? (
        <details>
          <summary className="cursor-pointer text-[12px] text-muted-foreground">History ({job.history.length})</summary>
          <ol className="mt-1 space-y-1 text-[12px]">
            {job.history.map((a) => {
              const d = auditDetail(a);
              return (
                <li key={a.id}>
                  {formatWhen(a.created_at)} · {actionLabel(a.action)} · {actorLabel(a.actor, names)}{d ? ` · ${d}` : ""}
                </li>
              );
            })}
          </ol>
        </details>
      ) : null}
    </li>
  );
}

export default function OperationsPage() {
  const [filter, setFilter] = useState<StateFilter>("attention");
  const [clientSlug, setClientSlug] = useState("");
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const prefix = useRolePrefix();

  useEffect(() => {
    void db.from("clients").select("slug, name").order("name").then(({ data }) => setClients((data ?? []) as ClientOption[]));
    void db.rpc("handoff_staff_options").then(({ data }) => {
      const map: Record<string, string> = {};
      for (const r of (data ?? []) as Array<{ user_id: string; display_name: string | null; email: string | null }>) {
        map[r.user_id] = r.display_name || r.email || "A staff member";
      }
      setNames(map);
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const states = STATE_FILTERS.find((f) => f.value === filter)?.states ?? null;
    let q = db.from("durable_jobs").select(JOB_SELECT);
    if (states) q = q.in("state", states);
    if (clientSlug) q = q.eq("client_slug", clientSlug);
    const { data, error: e } = await q.order("updated_at", { ascending: false }).limit(JOB_LIMIT);
    setLoading(false);
    if (e) {
      setError("The job queue could not load.");
      setJobs([]);
      return;
    }
    setError(null);
    setJobs(((data ?? []) as JobRow[]).map(toJob));
  }, [filter, clientSlug]);
  useEffect(() => void load(), [load]);

  const clientName = (slug: string | null) => (slug ? clients.find((c) => c.slug === slug)?.name ?? slug : null);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4" data-testid="operations">
      <PageHeader
        title="Operations"
        description="The work queue: reminders, owner alerts and other outside work. Replay or resolve a job that needs recovery, or cancel a queued job that never ran."
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="mr-1 h-4 w-4" /> Reload
          </Button>
        }
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <select aria-label="Jobs to show" className={field} value={filter} onChange={(e) => setFilter(e.target.value as StateFilter)}>
          {STATE_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <select aria-label="Client" className={field} value={clientSlug} onChange={(e) => setClientSlug(e.target.value)}>
          <option value="">All clients and company-wide jobs</option>
          {clients.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
      </div>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {jobs && jobs.length === 0 ? <p className="text-sm text-muted-foreground">No jobs match.</p> : null}
      {jobs && jobs.length === JOB_LIMIT ? <p className="text-[12px] text-muted-foreground">Showing the {JOB_LIMIT} most recently updated jobs.</p> : null}
      <ul className="space-y-3">
        {(jobs ?? []).map((j) => (
          <JobCard key={`${j.id}:${j.state}:${j.history.length}`} job={j} names={names} clientName={clientName(j.client_slug)} onChanged={() => void load()} />
        ))}
      </ul>
      <p className="text-[12px] text-muted-foreground">
        Replaying sends the job again on the next worker pass, so first check the outside service for the earlier attempt. Nothing is sent from staging.
        Connector and queue status is on <Link className="underline" to={`${prefix}/integration-health`}>Integration health</Link>.
      </p>
    </div>
  );
}
