// Agent evaluations: staff page (consolidation step 4c, port of the Goodo OS evaluation
// runner and gate, US-058). Staff write test requests for a Verdanote agent across five
// dimensions, run them against the model with the agent's own instructions (the
// agent-evaluations function), record the human approval counts and business outcome
// of a run, and a builder approves the agent's model and prompt version from a passed
// run. A model answer counts only when its reason is an exact quote of the request; the
// database decides that. Clients see none of it, and nothing is sent outside Verdanote.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { edgeFunctionError } from "@/lib/edgeFunctionError";
import {
  AGENTS,
  type Approval,
  canApprove,
  currentApproval,
  type Decision,
  DECISION_LABEL,
  type Dimension,
  DIMENSION_LABEL,
  DIMENSIONS,
  errorText,
  missingDimensions,
  OUTCOME_LABEL,
  resultLine,
  type Run,
  RUN_SELECT,
  RUN_STATUS_LABEL,
  type Sample,
  toRuns,
} from "./model";

const FN = "agent-evaluations";

// The evaluation tables and functions are not in the generated types yet.
interface DbResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}
interface Query extends PromiseLike<DbResult> {
  eq(column: string, value: unknown): Query;
  order(column: string, options?: { ascending: boolean }): Query;
  limit(n: number): Query;
}
interface Untyped {
  from(table: string): { select(columns: string): Query };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<DbResult>;
}
const db = supabase as unknown as Untyped;
const field = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

function SampleForm({ agentKey, onAdded }: { agentKey: string; onAdded: () => void }) {
  const [sampleKey, setSampleKey] = useState("");
  const [dimension, setDimension] = useState<Dimension>("grounding");
  const [label, setLabel] = useState<"synthetic" | "authorized">("synthetic");
  const [prompt, setPrompt] = useState("");
  const [expected, setExpected] = useState<Decision>("deny");
  const [provenance, setProvenance] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = /^[a-z][a-z0-9_-]{2,99}$/.test(sampleKey.trim()) && prompt.trim() && provenance.trim();
  const add = async () => {
    setBusy(true);
    setError(null);
    const { error: e } = await db.rpc("add_agent_evaluation_sample", {
      p_agent_key: agentKey,
      p_sample_key: sampleKey.trim(),
      p_dimension: dimension,
      p_label: label,
      p_prompt: prompt,
      p_expected_decision: expected,
      p_source_provenance: provenance,
    });
    setBusy(false);
    if (e) return setError(errorText(e.code, "The sample could not be saved."));
    setSampleKey("");
    setPrompt("");
    setProvenance("");
    onAdded();
  };
  return (
    <section className="space-y-3 rounded-lg border border-input bg-background p-5" aria-label="Add a sample">
      <h2 className="text-sm font-semibold">Add a sample</h2>
      <input aria-label="Sample key" className={field} value={sampleKey} onChange={(e) => setSampleKey(e.target.value)} placeholder="for example invented_budget" />
      <div className="grid gap-2 sm:grid-cols-3">
        <select aria-label="Dimension" className={field} value={dimension} onChange={(e) => setDimension(e.target.value as Dimension)}>
          {DIMENSIONS.map((d) => <option key={d} value={d}>{DIMENSION_LABEL[d]}</option>)}
        </select>
        <select aria-label="Expected decision" className={field} value={expected} onChange={(e) => setExpected(e.target.value as Decision)}>
          {(["allow", "escalate", "deny"] as Decision[]).map((d) => <option key={d} value={d}>{DECISION_LABEL[d]}</option>)}
        </select>
        <select aria-label="Label" className={field} value={label} onChange={(e) => setLabel(e.target.value as "synthetic" | "authorized")}>
          <option value="synthetic">Made up</option>
          <option value="authorized">Real, with permission</option>
        </select>
      </div>
      <textarea aria-label="Request" className={`${field} h-24`} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="The request the agent receives" />
      <input aria-label="Where it came from" className={field} value={provenance} onChange={(e) => setProvenance(e.target.value)} placeholder="Where this sample came from" />
      <Button disabled={busy || !ready} onClick={() => void add()}>{busy ? "Saving..." : "Add sample"}</Button>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    </section>
  );
}

function OutcomeForm({ runId, onSaved }: { runId: string; onSaved: () => void }) {
  const [count, setCount] = useState("");
  const [total, setTotal] = useState("");
  const [status, setStatus] = useState("unrecorded");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const counts = (count === "" && total === "") || (/^\d+$/.test(count) && /^\d+$/.test(total) && Number(count) <= Number(total));
  const save = async () => {
    setBusy(true);
    setError(null);
    const { error: e } = await db.rpc("record_agent_evaluation_outcome", {
      p_run_id: runId,
      p_approval_count: count === "" ? null : Number(count),
      p_approval_total: total === "" ? null : Number(total),
      p_business_outcome_status: status,
      p_business_outcome_note: note,
      p_reason: reason,
    });
    setBusy(false);
    if (e) return setError(errorText(e.code, "The outcome could not be saved."));
    onSaved();
  };
  return (
    <div className="space-y-2 border-t border-input pt-2" aria-label="Record the outcome">
      <div className="grid gap-2 sm:grid-cols-3">
        <input aria-label="Approved without edits" className={field} value={count} onChange={(e) => setCount(e.target.value)} placeholder="Approved" />
        <input aria-label="Reviewed" className={field} value={total} onChange={(e) => setTotal(e.target.value)} placeholder="Reviewed" />
        <select aria-label="Business outcome" className={field} value={status} onChange={(e) => setStatus(e.target.value)}>
          {Object.entries(OUTCOME_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <input aria-label="Outcome note" className={field} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
      <input aria-label="Reason" className={field} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What the counts are based on" />
      <Button size="sm" disabled={busy || !counts || !reason.trim()} onClick={() => void save()}>Record outcome</Button>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}

function RunCard({ run, approved, onChanged }: { run: Run; approved: boolean; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const approve = async () => {
    setError(null);
    const { error: e } = await db.rpc("approve_agent_config", { p_run_id: run.id });
    if (e) return setError(errorText(e.code, "The configuration could not be approved."));
    onChanged();
  };
  return (
    <li className="space-y-2 rounded-lg border border-input bg-background p-4">
      <p className="text-sm font-semibold">
        {RUN_STATUS_LABEL[run.status]} · {run.passed_samples} of {run.total_samples} samples passed · {run.model} · {run.prompt_version}
      </p>
      <p className="text-[12px] text-muted-foreground">
        {new Date(run.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} · dimensions covered:{" "}
        {run.dimensions_covered.length ? run.dimensions_covered.map((d) => DIMENSION_LABEL[d as Dimension] ?? d).join(", ") : "none"}
      </p>
      {run.limitation ? <p className="text-sm text-muted-foreground">{run.limitation}</p> : null}
      {run.results.length ? (
        <ul className="space-y-1">
          {run.results.map((r) => (
            <li key={r.sample_id} className="text-sm">
              <span className="font-medium">{r.sample?.sample_key ?? r.sample_id}</span>: {resultLine(r)}
              {r.grounded && r.quote ? <span className="block text-[12px] text-muted-foreground">Quoted: "{r.quote}"</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {run.outcome ? (
        <p className="text-sm">
          {run.outcome.approval_total !== null ? `${run.outcome.approval_count} of ${run.outcome.approval_total} approved without edits. ` : "Approval counts not recorded. "}
          {OUTCOME_LABEL[run.outcome.business_outcome_status] ?? run.outcome.business_outcome_status}. {run.outcome.reason}
        </p>
      ) : run.status !== "failed" ? <OutcomeForm runId={run.id} onSaved={onChanged} /> : null}
      {approved ? <p className="text-sm font-medium">This run's configuration is the approved one.</p> : canApprove(run) ? (
        <Button size="sm" variant="outline" onClick={() => void approve()}>Approve this model and prompt version</Button>
      ) : null}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    </li>
  );
}

export default function AgentEvaluationsPage() {
  const [agentKey, setAgentKey] = useState<string>(AGENTS[0].key);
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (key: string) => {
    const [s, r, a] = await Promise.all([
      db.from("agent_evaluation_samples").select("*").eq("agent_key", key).order("sample_key"),
      db.from("agent_evaluation_runs").select(RUN_SELECT).eq("agent_key", key).order("created_at", { ascending: false }).limit(20),
      db.from("agent_config_approvals").select("*").eq("agent_key", key).order("created_at", { ascending: false }),
    ]);
    if (s.error || r.error || a.error) {
      setError("Evaluations could not load.");
      setSamples([]);
      setRuns([]);
      return;
    }
    setSamples((s.data ?? []) as Sample[]);
    setRuns(toRuns(r.data));
    setApprovals((a.data ?? []) as Approval[]);
  }, []);

  useEffect(() => {
    void load(agentKey);
  }, [agentKey, load]);

  const run = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const { data, error: invokeError } = await supabase.functions.invoke(FN, { body: { agent_key: agentKey } });
    setBusy(false);
    if (invokeError) {
      setError(await edgeFunctionError(invokeError, "The evaluation could not run."));
      return;
    }
    setMessage(`Run recorded: ${RUN_STATUS_LABEL[data?.status as Run["status"]] ?? "recorded"}, ${data?.passed ?? 0} of ${data?.total ?? 0} samples passed.`);
    await load(agentKey);
  };

  const approval = currentApproval(approvals, agentKey);
  const missing = samples ? missingDimensions(samples) : [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6" data-testid="agent-evaluations">
      <PageHeader title="Agent evaluations" description="Test requests for each AI agent, run against the model with the agent's own instructions. An answer counts only when its reason quotes the request exactly." />
      <section className="space-y-3 rounded-lg border border-input bg-background p-5">
        <label className="block space-y-1 text-sm">
          <span>Agent</span>
          <select aria-label="Agent" className={field} value={agentKey} onChange={(e) => setAgentKey(e.target.value)}>
            {AGENTS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </label>
        <p className="text-sm">
          {approval ? `Approved configuration: ${approval.model}, prompt ${approval.prompt_version}, since ${new Date(approval.created_at).toLocaleDateString("en-US", { dateStyle: "medium" })}.` : "No approved configuration yet."}
        </p>
        <p className="text-[12px] text-muted-foreground">The approval is recorded here; it does not yet stop the agent from running.</p>
        {missing.length ? <p className="text-sm text-muted-foreground">No sample yet for: {missing.map((d) => DIMENSION_LABEL[d]).join(", ")}. A run cannot pass until every dimension has one.</p> : null}
        <Button disabled={busy || !samples?.length} onClick={() => void run()}>{busy ? "Running..." : "Run evaluation"}</Button>
        {message ? <p role="status" className="text-sm">{message}</p> : null}
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      </section>

      <SampleForm agentKey={agentKey} onAdded={() => void load(agentKey)} />

      <section className="space-y-2" aria-label="Samples">
        <h2 className="text-sm font-semibold">Samples</h2>
        {samples === null ? null : samples.length === 0 ? <p className="text-sm text-muted-foreground">No samples for this agent yet.</p> : (
          <ul className="space-y-2">
            {samples.map((s) => (
              <li key={s.id} className="rounded-md border border-input p-3 text-sm">
                <span className="font-medium">{s.sample_key}</span> · {DIMENSION_LABEL[s.dimension]} · expected {DECISION_LABEL[s.expected_decision]} · {s.label === "synthetic" ? "made up" : "real, with permission"}
                <span className="block whitespace-pre-wrap text-muted-foreground">{s.prompt}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2" aria-label="Runs">
        <h2 className="text-sm font-semibold">Runs</h2>
        {runs === null ? null : runs.length === 0 ? <p className="text-sm text-muted-foreground">No runs yet.</p> : (
          <ul className="space-y-4">
            {runs.map((r) => <RunCard key={r.id} run={r} approved={approval?.run_id === r.id} onChanged={() => void load(agentKey)} />)}
          </ul>
        )}
      </section>
    </div>
  );
}
