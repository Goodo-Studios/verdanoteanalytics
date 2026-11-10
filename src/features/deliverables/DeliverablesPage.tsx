// Deliverables and approvals: staff page (consolidation step 4b, port of the Goodo
// OS page DeliverablesReview.tsx and the exact-version approvals of ideas and shot
// lists). Staff pick a client and an engagement, add deliverables and their
// revisions (the Air review link), and record the client's decision on the exact
// current revision with where it came from (call, Slack or email). A changes
// request beyond the included rounds opens an exception a builder decides. Ideas
// and shot lists get numbered drafts, a published version and the client's
// decision. Every write goes through a checked database function (migration
// 20261110120002); clients see none of it.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  type ApprovalSubject,
  canAddRevision,
  canDecideApproval,
  canPublish,
  canRecordDecision,
  type Channel,
  CHANNEL_LABEL,
  currentRevision,
  type Decision,
  type Deliverable,
  errorText,
  KIND_LABEL,
  latestVersion,
  pendingException,
  publishedVersion,
  roundsUsed,
  STAGE_LABEL,
  toDeliverables,
  toSubjects,
} from "./model";

// The deliverable and approval tables and functions are not in the generated types yet.
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
const DELIVERABLES = "*, engagement_deliverable_revisions(*), engagement_deliverable_decisions(*), engagement_deliverable_round_exceptions(*)";
const SUBJECTS = "*, approval_subject_versions(*), approval_subject_decisions(*)";
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

function useCall(onDone: () => void) {
  const [error, setError] = useState<string | null>(null);
  const call = async (name: string, args: Record<string, unknown>, fallback: string): Promise<unknown> => {
    setError(null);
    const { data, error: e } = await db.rpc(name, args);
    if (e) {
      setError(errorText(e.code, fallback));
      return undefined;
    }
    onDone();
    return data ?? true;
  };
  return { error, setError, call };
}

function DecisionForm({ label, onSubmit }: { label: string; onSubmit: (decision: Decision, channel: Channel, note: string) => void }) {
  const [channel, setChannel] = useState<Channel>("call");
  const [note, setNote] = useState("");
  return (
    <div className="space-y-2" aria-label={label} role="group">
      <div className="grid gap-2 sm:grid-cols-3">
        <select aria-label="Where the decision came from" className={field} value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
          {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
        </select>
        <input aria-label="Decision note" className={`${field} sm:col-span-2`} placeholder="What the client said, or a link to it" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={!note.trim()} onClick={() => onSubmit("approved", channel, note.trim())}>Client approved</Button>
        <Button size="sm" variant="outline" disabled={!note.trim()} onClick={() => onSubmit("changes_requested", channel, note.trim())}>Client asked for changes</Button>
      </div>
    </div>
  );
}

function DeliverableCard({ d, onChanged }: { d: Deliverable; onChanged: () => void }) {
  const { isBuilder } = useAuth();
  const { error, call } = useCall(onChanged);
  const [link, setLink] = useState("");
  const [airId, setAirId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const current = currentRevision(d);
  const exception = pendingException(d);
  const addRevision = async () => {
    const ok = await call("add_deliverable_revision", { p_deliverable_id: d.id, p_expected_revision: d.current_revision, p_review_url: link.trim(), p_air_revision_id: airId.trim() || null }, "The revision could not be added.");
    if (ok) {
      setLink("");
      setAirId("");
    }
  };
  const decide = async (decision: Decision, channel: Channel, note: string) => {
    setMessage(null);
    const result = await call("record_deliverable_client_decision", { p_deliverable_id: d.id, p_revision: d.current_revision, p_decision: decision, p_channel: channel, p_source_note: note }, "The decision could not be recorded.");
    if (result === "exception_pending") setMessage("That is beyond the included client rounds. A builder has to approve an extra round first.");
  };
  return (
    <section aria-label={d.title} className="space-y-2 rounded-lg border border-input bg-background p-4 text-sm">
      <h3 className="text-base font-semibold">{d.title}</h3>
      <p className="text-[12px] text-muted-foreground" data-testid={`stage-${d.id}`}>
        {STAGE_LABEL[d.stage]} · revision {d.current_revision} · {roundsUsed(d)} client round{roundsUsed(d) === 1 ? "" : "s"} used{d.agreed_item ? ` · counts against ${d.agreed_item}` : ""}
      </p>
      {current ? <p>Current: <a className="underline" href={current.review_url} target="_blank" rel="noopener noreferrer">open revision {current.revision}</a>{current.air_revision_id ? ` (${current.air_revision_id})` : ""}</p> : null}
      {d.final_download_url ? <p>Final: <a className="underline" href={d.final_download_url} target="_blank" rel="noopener noreferrer">download</a></p> : null}
      {d.decisions.length ? (
        <ul className="space-y-1">
          {d.decisions.map((x) => (
            <li key={x.id}>Revision {x.revision}: {x.decision === "approved" ? "approved" : `changes requested (round ${x.client_round})`} by {CHANNEL_LABEL[x.channel].toLowerCase()}: {x.source_note}</li>
          ))}
        </ul>
      ) : null}
      {canRecordDecision(d) && !exception ? <DecisionForm label={`Client decision on revision ${d.current_revision}`} onSubmit={(a, b, c) => void decide(a, b, c)} /> : null}
      {exception ? (
        <div className="space-y-2 rounded border border-amber-300 p-2">
          <p>Extra client round requested on revision {exception.revision}: {exception.reason}</p>
          {isBuilder ? (
            <div className="flex flex-wrap gap-2">
              <input aria-label="Exception reason" className={field} placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button size="sm" disabled={!reason.trim()} onClick={() => void call("decide_deliverable_round_exception", { p_exception_id: exception.id, p_approve: true, p_reason: reason.trim() }, "The exception could not be decided.")}>Approve one extra round</Button>
              <Button size="sm" variant="outline" disabled={!reason.trim()} onClick={() => void call("decide_deliverable_round_exception", { p_exception_id: exception.id, p_approve: false, p_reason: reason.trim() }, "The exception could not be decided.")}>Deny</Button>
            </div>
          ) : <p className="text-muted-foreground">Waiting for a builder.</p>}
        </div>
      ) : null}
      {canAddRevision(d) ? (
        <div className="grid gap-2 sm:grid-cols-4">
          <input aria-label="Review link" className={`${field} sm:col-span-2`} placeholder="Air review link (https://...)" value={link} onChange={(e) => setLink(e.target.value)} />
          <input aria-label="Air revision id" className={field} placeholder="Air revision id (optional)" value={airId} onChange={(e) => setAirId(e.target.value)} />
          <Button size="sm" disabled={!link.trim().startsWith("https://")} onClick={() => void addRevision()}>Add revision {d.current_revision + 1}</Button>
        </div>
      ) : null}
      {canAddRevision(d) ? <Button size="sm" variant="ghost" onClick={() => void call("withdraw_engagement_deliverable", { p_deliverable_id: d.id }, "The deliverable could not be withdrawn.")}>Withdraw</Button> : null}
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert" className="text-red-700">{error}</p> : null}
    </section>
  );
}

function SubjectCard({ s, onChanged }: { s: ApprovalSubject; onChanged: () => void }) {
  const latest = latestVersion(s);
  const published = publishedVersion(s);
  const [draft, setDraft] = useState(latest?.body ?? "");
  const { error, call } = useCall(onChanged);
  return (
    <section aria-label={s.title} className="space-y-2 rounded-lg border border-input bg-background p-4 text-sm">
      <h3 className="text-base font-semibold">{KIND_LABEL[s.subject_kind]}: {s.title}</h3>
      <p className="text-[12px] text-muted-foreground" data-testid={`subject-${s.id}`}>
        {s.current_version ? `Latest version ${s.current_version} (${latest?.state})` : "No version yet"}{published ? ` · client sees version ${published.version}` : ""}
      </p>
      {published ? <p className="whitespace-pre-wrap rounded bg-muted/40 p-2">{published.body}</p> : null}
      {s.decisions.map((x) => <p key={x.version}>Version {x.version}: {x.decision === "approved" ? "approved" : "changes requested"} by {CHANNEL_LABEL[x.channel].toLowerCase()}: {x.source_note}</p>)}
      {canDecideApproval(s) && published ? (
        <DecisionForm label={`Client decision on version ${published.version}`} onSubmit={(decision, channel, note) => void call("record_approval_decision", { p_subject_id: s.id, p_version: published.version, p_decision: decision, p_channel: channel, p_source_note: note }, "The decision could not be recorded.")} />
      ) : null}
      <textarea aria-label="Draft text" className={`${field} min-h-[80px]`} value={draft} onChange={(e) => setDraft(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" disabled={!draft.trim() || draft === latest?.body} onClick={() => void call("save_approval_draft", { p_subject_id: s.id, p_expected_version: s.current_version, p_body: draft }, "The draft could not be saved.")}>
          Save as draft version {s.current_version + 1}
        </Button>
        {canPublish(s) ? <Button size="sm" variant="outline" onClick={() => void call("publish_approval_version", { p_subject_id: s.id, p_version: s.current_version }, "The version could not be published.")}>Publish version {s.current_version}</Button> : null}
      </div>
      {error ? <p role="alert" className="text-red-700">{error}</p> : null}
    </section>
  );
}

export default function DeliverablesPage() {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientSlug, setClientSlug] = useState("");
  const [engagements, setEngagements] = useState<EngagementOption[]>([]);
  const [engagementId, setEngagementId] = useState("");
  const [deliverables, setDeliverables] = useState<Deliverable[] | null>(null);
  const [subjects, setSubjects] = useState<ApprovalSubject[]>([]);
  const [newDeliverable, setNewDeliverable] = useState({ title: "", kind: "video", agreed: "" });
  const [newSubject, setNewSubject] = useState({ title: "", kind: "idea" });
  const [loadError, setLoadError] = useState<string | null>(null);

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
    if (!engagementId) return setDeliverables(null);
    const [d, s] = await Promise.all([
      db.from("engagement_deliverables").select(DELIVERABLES).eq("engagement_id", engagementId).order("created_at"),
      db.from("approval_subjects").select(SUBJECTS).eq("engagement_id", engagementId).order("created_at"),
    ]);
    setLoadError(d.error || s.error ? "Deliverables could not load." : null);
    setDeliverables(toDeliverables(d.data));
    setSubjects(toSubjects(s.data));
  }, [engagementId]);
  useEffect(() => void load(), [load]);

  const { error, call } = useCall(() => void load());

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4" data-testid="deliverables">
      <PageHeader title="Deliverables and approvals" description="Each revision, the client's decision on it, and approvals of ideas and shot lists." />
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
      {loadError ? <p role="alert" className="text-sm text-red-700">{loadError}</p> : null}
      {engagementId ? (
        <>
          <div className="grid gap-2 rounded-lg border border-input bg-background p-4 sm:grid-cols-4">
            <input aria-label="Deliverable title" className={`${field} sm:col-span-2`} placeholder="Deliverable title" value={newDeliverable.title} onChange={(e) => setNewDeliverable({ ...newDeliverable, title: e.target.value })} />
            <select aria-label="Deliverable kind" className={field} value={newDeliverable.kind} onChange={(e) => setNewDeliverable({ ...newDeliverable, kind: e.target.value })}>
              {["video", "image", "design", "document", "other"].map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <input aria-label="Agreed deliverable" className={field} placeholder="Agreed deliverable (optional)" value={newDeliverable.agreed} onChange={(e) => setNewDeliverable({ ...newDeliverable, agreed: e.target.value })} />
            <Button size="sm" disabled={!newDeliverable.title.trim()} onClick={() => void call("add_engagement_deliverable", { p_engagement_id: engagementId, p_title: newDeliverable.title.trim(), p_asset_kind: newDeliverable.kind, p_agreed_item: newDeliverable.agreed.trim() || null }, "The deliverable could not be added.").then((ok) => ok && setNewDeliverable({ title: "", kind: "video", agreed: "" }))}>Add deliverable</Button>
          </div>
          {deliverables === null ? <p role="status" className="text-sm text-muted-foreground">Loading deliverables...</p> : null}
          {deliverables && deliverables.length === 0 ? <p className="text-sm text-muted-foreground">No deliverables for this engagement yet.</p> : null}
          {(deliverables ?? []).map((d) => <DeliverableCard key={`${d.id}:${d.current_revision}:${d.stage}`} d={d} onChanged={() => void load()} />)}
          <h2 className="pt-2 text-base font-semibold">Ideas and shot lists</h2>
          <div className="grid gap-2 rounded-lg border border-input bg-background p-4 sm:grid-cols-4">
            <select aria-label="Approval kind" className={field} value={newSubject.kind} onChange={(e) => setNewSubject({ ...newSubject, kind: e.target.value })}>
              <option value="idea">Idea</option>
              <option value="shot_list">Shot list</option>
            </select>
            <input aria-label="Approval title" className={`${field} sm:col-span-2`} placeholder="Title" value={newSubject.title} onChange={(e) => setNewSubject({ ...newSubject, title: e.target.value })} />
            <Button size="sm" disabled={!newSubject.title.trim()} onClick={() => void call("create_approval_subject", { p_engagement_id: engagementId, p_subject_kind: newSubject.kind, p_title: newSubject.title.trim() }, "It could not be added.").then((ok) => ok && setNewSubject({ title: "", kind: "idea" }))}>Add</Button>
          </div>
          {subjects.map((s) => <SubjectCard key={`${s.id}:${s.current_version}:${s.published_version}`} s={s} onChanged={() => void load()} />)}
          {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
        </>
      ) : null}
    </div>
  );
}
