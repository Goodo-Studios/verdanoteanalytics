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
import { useSelectedClientSlug } from "@/contexts/ClientSelectionContext";
import { PickClientPrompt } from "@/components/PickClientPrompt";
import { useAuth } from "@/contexts/AuthContext";
import { ConfirmDialog, EmptyState, ErrorState, LoadingState, PageHeader, PageShell, SelectField, TextField, TextareaField } from "@/components/page-kit";
import { Button } from "@/components/ui/button";
import { STATUS_LABEL, type EngagementStatus } from "@/features/engagements/model";
import {
  type ApprovalSubject,
  ASSET_KIND_LABEL,
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

interface ClientOption {
  slug: string;
  name: string;
}
interface EngagementOption {
  id: string;
  cycle_number: number;
  status: EngagementStatus;
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
        <SelectField
          label="Where the decision came from"
          hideLabel
          value={channel}
          onChange={(e) => setChannel(e.target.value as Channel)}
          options={(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))}
        />
        <TextField label="Decision note" hideLabel className="sm:col-span-2" placeholder="What the client said, or a link to it" value={note} onChange={(e) => setNote(e.target.value)} />
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
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
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
              <TextField label="Exception reason" hideLabel placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button size="sm" disabled={!reason.trim()} onClick={() => void call("decide_deliverable_round_exception", { p_exception_id: exception.id, p_approve: true, p_reason: reason.trim() }, "The exception could not be decided.")}>Approve one extra round</Button>
              <Button size="sm" variant="outline" disabled={!reason.trim()} onClick={() => void call("decide_deliverable_round_exception", { p_exception_id: exception.id, p_approve: false, p_reason: reason.trim() }, "The exception could not be decided.")}>Deny</Button>
            </div>
          ) : <p className="text-muted-foreground">Waiting for a builder.</p>}
        </div>
      ) : null}
      {canAddRevision(d) ? (
        <div className="grid items-end gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <TextField label="Review link" hideLabel className="sm:col-span-2" placeholder="Air review link (https://...)" value={link} onChange={(e) => setLink(e.target.value)} />
          <TextField label="Air version" hideLabel placeholder="Air version (optional)" value={airId} onChange={(e) => setAirId(e.target.value)} />
          <Button size="sm" disabled={!link.trim().startsWith("https://")} onClick={() => void addRevision()}>Add revision {d.current_revision + 1}</Button>
        </div>
      ) : null}
      {canAddRevision(d) ? <Button size="sm" variant="ghost" onClick={() => setConfirmWithdraw(true)}>Withdraw</Button> : null}
      <ConfirmDialog
        open={confirmWithdraw}
        onOpenChange={setConfirmWithdraw}
        title="Withdraw this deliverable?"
        description={`"${d.title}" will be withdrawn and you will not be able to add revisions to it again.`}
        actionLabel="Withdraw"
        onConfirm={() => {
          setConfirmWithdraw(false);
          void call("withdraw_engagement_deliverable", { p_deliverable_id: d.id }, "The deliverable could not be withdrawn.");
        }}
      />
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
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
      <TextareaField label="Draft text" hideLabel inputClassName="min-h-[80px]" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" disabled={!draft.trim() || draft === latest?.body} onClick={() => void call("save_approval_draft", { p_subject_id: s.id, p_expected_version: s.current_version, p_body: draft }, "The draft could not be saved.")}>
          Save as draft version {s.current_version + 1}
        </Button>
        {canPublish(s) ? <Button size="sm" variant="outline" onClick={() => void call("publish_approval_version", { p_subject_id: s.id, p_version: s.current_version }, "The version could not be published.")}>Publish version {s.current_version}</Button> : null}
      </div>
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    </section>
  );
}

export default function DeliverablesPage() {
  // The client comes from the one switcher at the top of the app (or the client hub address).
  const clientSlug = useSelectedClientSlug();
  const [engagements, setEngagements] = useState<EngagementOption[]>([]);
  const [engagementId, setEngagementId] = useState("");
  const [deliverables, setDeliverables] = useState<Deliverable[] | null>(null);
  const [subjects, setSubjects] = useState<ApprovalSubject[]>([]);
  const [newDeliverable, setNewDeliverable] = useState({ title: "", kind: "video", agreed: "" });
  const [newSubject, setNewSubject] = useState({ title: "", kind: "idea" });
  const [loadError, setLoadError] = useState<string | null>(null);

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
    <PageShell data-testid="deliverables">
      <PageHeader title="Deliverables and approvals" description="Each revision, the client's decision on it, and approvals of ideas and shot lists." />
      <div className="grid gap-2 sm:grid-cols-2">
        {!clientSlug ? <div className="sm:col-span-2"><PickClientPrompt what="deliverables and approvals" /></div> : null}
        <SelectField
          label="Engagement"
          hideLabel
          value={engagementId}
          onChange={(e) => setEngagementId(e.target.value)}
          disabled={!clientSlug}
          placeholder="Select an engagement"
          options={engagements.map((e) => ({ value: e.id, label: `Cycle ${e.cycle_number} (${STATUS_LABEL[e.status] ?? e.status})` }))}
        />
      </div>
      {loadError ? <ErrorState message={loadError} onRetry={() => void load()} /> : null}
      {engagementId ? (
        <>
          <div className="grid items-end gap-2 rounded-lg border border-input bg-background p-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <TextField label="Deliverable title" hideLabel className="sm:col-span-2" placeholder="Deliverable title" value={newDeliverable.title} onChange={(e) => setNewDeliverable({ ...newDeliverable, title: e.target.value })} />
            <SelectField
              label="Deliverable kind"
              hideLabel
              value={newDeliverable.kind}
              onChange={(e) => setNewDeliverable({ ...newDeliverable, kind: e.target.value })}
              options={(Object.keys(ASSET_KIND_LABEL) as Deliverable["asset_kind"][]).map((k) => ({ value: k, label: ASSET_KIND_LABEL[k] }))}
            />
            <TextField label="Agreed deliverable" hideLabel placeholder="Agreed deliverable (optional)" value={newDeliverable.agreed} onChange={(e) => setNewDeliverable({ ...newDeliverable, agreed: e.target.value })} />
            <Button size="sm" disabled={!newDeliverable.title.trim()} onClick={() => void call("add_engagement_deliverable", { p_engagement_id: engagementId, p_title: newDeliverable.title.trim(), p_asset_kind: newDeliverable.kind, p_agreed_item: newDeliverable.agreed.trim() || null }, "The deliverable could not be added.").then((ok) => ok && setNewDeliverable({ title: "", kind: "video", agreed: "" }))}>Add deliverable</Button>
          </div>
          {deliverables === null ? <LoadingState label="Loading deliverables" /> : null}
          {deliverables && deliverables.length === 0 ? <EmptyState title="No deliverables for this engagement yet" /> : null}
          {(deliverables ?? []).map((d) => <DeliverableCard key={`${d.id}:${d.current_revision}:${d.stage}`} d={d} onChanged={() => void load()} />)}
          <h2 className="pt-2 text-base font-semibold">Ideas and shot lists</h2>
          <div className="grid items-end gap-2 rounded-lg border border-input bg-background p-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <SelectField
              label="Approval kind"
              hideLabel
              value={newSubject.kind}
              onChange={(e) => setNewSubject({ ...newSubject, kind: e.target.value })}
              options={[{ value: "idea", label: "Idea" }, { value: "shot_list", label: "Shot list" }]}
            />
            <TextField label="Approval title" hideLabel className="sm:col-span-2" placeholder="Title" value={newSubject.title} onChange={(e) => setNewSubject({ ...newSubject, title: e.target.value })} />
            <Button size="sm" disabled={!newSubject.title.trim()} onClick={() => void call("create_approval_subject", { p_engagement_id: engagementId, p_subject_kind: newSubject.kind, p_title: newSubject.title.trim() }, "It could not be added.").then((ok) => ok && setNewSubject({ title: "", kind: "idea" }))}>Add</Button>
          </div>
          {subjects.map((s) => <SubjectCard key={`${s.id}:${s.current_version}:${s.published_version}`} s={s} onChanged={() => void load()} />)}
          {error ? <ErrorState message={error} /> : null}
        </>
      ) : null}
    </PageShell>
  );
}
