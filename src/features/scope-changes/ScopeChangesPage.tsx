// Scope changes: staff page (consolidation step 4c, port of the Goodo OS scope lock
// view and scope change evaluation). The client's approval of a published shot list
// version locks the engagement scope (recorded on the Deliverables page; a database
// trigger writes the lock). Staff record a client's change request against the locked
// version with the channel it came through; staff mark it "needs review", and a builder
// accepts or declines it once. An accepted change does not edit the shot list: publish a
// new version on the Deliverables page for the client to approve. Every write goes
// through a checked database function (migration 20261110200002); clients see none of
// it, and nothing is sent to ClickUp.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  type ChangeRequest,
  errorText,
  type EvaluationStatus,
  isDecided,
  LOCK_LABEL,
  lockedVersion,
  lockStatus,
  requestStatus,
  type ShotList,
  STATUS_LABEL,
} from "./model";

// The scope tables and functions are not in the generated types yet.
interface DbResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}
interface Query extends PromiseLike<DbResult> {
  eq(column: string, value: unknown): Query;
  order(column: string): Query;
}
interface Untyped {
  from(table: string): { select(columns: string): Query };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<DbResult>;
}
const db = supabase as unknown as Untyped;
const field = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

interface ClientOption {
  slug: string;
  name: string;
}
interface EngagementOption {
  id: string;
  cycle_number: number;
  status: string;
}

function RequestRow({ request, onChanged }: { request: ChangeRequest; onChanged: () => void }) {
  const { isBuilder } = useAuth();
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  const status = requestStatus(request);
  const evaluate = async (s: EvaluationStatus) => {
    if (!rationale.trim()) return setError("Write a rationale first.");
    setError(null);
    const { error: e } = await db.rpc("evaluate_scope_change", { p_request_id: request.id, p_status: s, p_rationale: rationale.trim() });
    if (e) return setError(errorText(e.code, "The evaluation could not be saved."));
    onChanged();
  };
  return (
    <li aria-label={`Scope change ${request.requested_change}`} className="space-y-1 rounded border border-input p-3">
      <p className="font-medium">{request.requested_change}</p>
      <p className="text-[12px] text-muted-foreground" data-testid={`request-${request.id}`}>
        {STATUS_LABEL[status]} · against version {request.base_version} · via {request.channel}: {request.source_note}
      </p>
      {request.scope_change_evaluations.slice().sort((a, b) => a.created_at.localeCompare(b.created_at)).map((e) => (
        <p key={e.id} className="text-muted-foreground">{STATUS_LABEL[e.status]}: {e.rationale}</p>
      ))}
      {!isDecided(request) ? (
        <div className="space-y-2">
          <input aria-label="Rationale" className={field} placeholder="Rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void evaluate("needs_review")}>Needs review</Button>
            {isBuilder ? <Button size="sm" onClick={() => void evaluate("accepted")}>Accept</Button> : null}
            {isBuilder ? <Button size="sm" variant="outline" onClick={() => void evaluate("declined")}>Decline</Button> : null}
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-red-700">{error}</p> : null}
    </li>
  );
}

function ShotListCard({ shotList, requests, onChanged }: { shotList: ShotList; requests: ChangeRequest[]; onChanged: () => void }) {
  const locked = lockedVersion(shotList);
  const status = lockStatus(shotList);
  const [form, setForm] = useState({ change: "", channel: "call", note: "" });
  const [error, setError] = useState<string | null>(null);
  const record = async () => {
    setError(null);
    const { error: e } = await db.rpc("request_scope_change", {
      p_subject_id: shotList.id, p_base_version: locked, p_requested_change: form.change.trim(), p_channel: form.channel, p_source_note: form.note.trim(),
    });
    if (e) return setError(errorText(e.code, "The request could not be recorded."));
    setForm({ change: "", channel: "call", note: "" });
    onChanged();
  };
  return (
    <section aria-label={`Shot list ${shotList.title}`} className="space-y-2 rounded-lg border border-input bg-background p-4 text-sm">
      <h3 className="text-base font-semibold">{shotList.title}</h3>
      <p className="text-[12px] text-muted-foreground" data-testid={`lock-${shotList.id}`}>
        {LOCK_LABEL[status]}{locked !== null ? ` · locked version ${locked}` : ""}{shotList.published_version !== null ? ` · published version ${shotList.published_version}` : ""}
      </p>
      {requests.length ? <ul className="space-y-2">{requests.map((r) => <RequestRow key={`${r.id}:${r.scope_change_evaluations.length}`} request={r} onChanged={onChanged} />)}</ul> : null}
      {locked !== null ? (
        <details>
          <summary className="cursor-pointer font-medium">Record a change request</summary>
          <div className="mt-2 space-y-2">
            <textarea aria-label="Requested change" className={field} placeholder="What the client wants changed" value={form.change} onChange={(e) => setForm({ ...form, change: e.target.value })} />
            <div className="grid gap-2 sm:grid-cols-3">
              <select aria-label="Channel" className={field} value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                <option value="call">Call</option>
                <option value="slack">Slack</option>
                <option value="email">Email</option>
              </select>
              <input aria-label="Source note" className={`${field} sm:col-span-2`} placeholder="Where it came from (call, thread, email)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
            <Button size="sm" disabled={!form.change.trim() || !form.note.trim()} onClick={() => void record()}>Record against version {locked}</Button>
          </div>
        </details>
      ) : null}
      {error ? <p role="alert" className="text-red-700">{error}</p> : null}
    </section>
  );
}

export default function ScopeChangesPage() {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientSlug, setClientSlug] = useState("");
  const [engagements, setEngagements] = useState<EngagementOption[]>([]);
  const [engagementId, setEngagementId] = useState("");
  const [shotLists, setShotLists] = useState<ShotList[] | null>(null);
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void db.from("clients").select("slug, name").order("name").then(({ data }) => setClients((data ?? []) as ClientOption[]));
  }, []);
  useEffect(() => {
    setEngagementId("");
    if (!clientSlug) return setEngagements([]);
    void db.from("engagements").select("id, cycle_number, status").eq("client_slug", clientSlug).order("cycle_number")
      .then(({ data }) => setEngagements(((data ?? []) as EngagementOption[]).slice().reverse()));
  }, [clientSlug]);

  const load = useCallback(async () => {
    if (!engagementId) return setShotLists(null);
    const [s, r] = await Promise.all([
      db.from("approval_subjects").select("id, title, published_version, scope_locks(version, locked_at)").eq("engagement_id", engagementId).eq("subject_kind", "shot_list").order("created_at"),
      db.from("scope_change_requests").select("*, scope_change_evaluations(*)").eq("engagement_id", engagementId).order("created_at"),
    ]);
    if (s.error || r.error) {
      setError("Scope changes could not load.");
      setShotLists([]);
      return;
    }
    setError(null);
    setShotLists(((s.data ?? []) as ShotList[]).map((x) => ({ ...x, scope_locks: x.scope_locks ?? [] })));
    setRequests(((r.data ?? []) as ChangeRequest[]).map((x) => ({ ...x, scope_change_evaluations: x.scope_change_evaluations ?? [] })));
  }, [engagementId]);
  useEffect(() => void load(), [load]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4" data-testid="scope-changes">
      <PageHeader title="Scope changes" description="The client's approved shot list is the locked scope. Record change requests against it; a builder accepts or declines each one." />
      <div className="grid gap-2 sm:grid-cols-2">
        <select aria-label="Client" className={field} value={clientSlug} onChange={(e) => setClientSlug(e.target.value)}>
          <option value="">Select a client</option>
          {clients.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
        <select aria-label="Engagement" className={field} value={engagementId} onChange={(e) => setEngagementId(e.target.value)} disabled={!clientSlug}>
          <option value="">Select an engagement</option>
          {engagements.map((e) => <option key={e.id} value={e.id}>Cycle {e.cycle_number} ({e.status})</option>)}
        </select>
      </div>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {shotLists && shotLists.length === 0 ? <p className="text-sm text-muted-foreground">No shot lists for this engagement yet. Add one on the Deliverables page.</p> : null}
      {(shotLists ?? []).map((s) => (
        <ShotListCard key={s.id} shotList={s} requests={requests.filter((r) => r.subject_id === s.id)} onChanged={() => void load()} />
      ))}
      <p className="text-[12px] text-muted-foreground">An accepted change does not edit the shot list. Publish a new version on the Deliverables page; the client's approval of it locks the new scope.</p>
    </div>
  );
}
