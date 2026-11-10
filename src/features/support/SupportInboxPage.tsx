// Support inbox: staff page (consolidation step 4d, port of the Goodo OS staff page
// src/pages/staff/SupportInbox.tsx). Staff record a client's question with the channel it
// came in on, an accountable owner and the date the next update is owed; give staff updates,
// resolve and reopen against the revision on screen; and name the accountable owner or a
// backup. Every write goes through a checked database function (migration 20261111000004).
// Clients read none of it, and nothing is sent to a client from here.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useClientSelection } from "@/contexts/ClientSelectionContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, FilterBar, LoadingState, PageHeader, PageShell, SelectField, StatusBadge, TextField, TextareaField } from "@/components/page-kit";
import { fmtDate } from "@/lib/formatters";
import {
  CHANNELS,
  channelLabel,
  errorText,
  EVENT_LABEL,
  isOverdue,
  NO_SEND_NOTE,
  type NewRequestForm,
  newRequestProblem,
  personLabel,
  REQUEST_SELECT,
  type RequestRow,
  sortRequests,
  type StatusFilter,
  type SupportRequest,
  today,
  toRequest,
  validDate,
} from "./model";

// The support tables are not in the generated types.
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
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<DbResult>;
}
const db = supabase as unknown as Untyped;

interface ClientOption {
  slug: string;
  name: string;
}
interface EngagementOption {
  id: string;
  cycle_number: number;
  status: string;
}
interface StaffOption {
  user_id: string;
  label: string;
}

function RequestCard({ request, names, staff, clientName, onChanged }: {
  request: SupportRequest;
  names: Record<string, string>;
  staff: StaffOption[];
  clientName: string;
  onChanged: () => void;
}) {
  const [body, setBody] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [assignee, setAssignee] = useState("");
  const [kind, setKind] = useState<"accountable" | "backup">("accountable");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const overdue = isOverdue(request);

  const event = async (eventKind: "response" | "resolution" | "reopen") => {
    setBusy(true);
    setError(null);
    const { error: e } = await db.rpc("record_support_event", {
      p_request_id: request.id,
      p_expected_revision: request.revision,
      p_event_kind: eventKind,
      p_body: body.trim(),
      p_next_update_target: nextDate && validDate(nextDate) ? nextDate : null,
    });
    setBusy(false);
    if (e) return setError(errorText(e.code, "The update could not be recorded."));
    onChanged();
  };
  const assign = async () => {
    setBusy(true);
    setError(null);
    const { error: e } = await db.rpc("assign_support_request", {
      p_request_id: request.id, p_expected_revision: request.revision, p_assigned_to: assignee, p_assignment_kind: kind,
    });
    setBusy(false);
    if (e) return setError(errorText(e.code, "The assignment could not be saved."));
    onChanged();
  };

  return (
    <li aria-label={`Support request ${request.subject}`} className="space-y-2 rounded-lg border border-input bg-background p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">{request.subject}</p>
        <span data-testid={`support-status-${request.id}`}>
          {request.status === "resolved" ? (
            <StatusBadge status="done" label="Resolved" />
          ) : overdue ? (
            <StatusBadge status="late" label="Update overdue" />
          ) : (
            <StatusBadge status="in_progress" label="Open" />
          )}
        </span>
      </div>
      <p className="text-[12px] text-muted-foreground">
        {clientName} · via {channelLabel(request.channel)} · next update by {fmtDate(request.next_update_target)} · owner {personLabel(request.accountable_user_id, names)}
        {request.backup_user_id ? ` · backup ${personLabel(request.backup_user_id, names)}` : ""}
      </p>
      <ol className="space-y-1">
        {request.history.map((h) => (
          <li key={h.id} className="rounded bg-muted/40 p-2">
            <p className="text-[12px] text-muted-foreground">{EVENT_LABEL[h.event_kind]} · {personLabel(h.actor_id, names)} · {new Date(h.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</p>
            <p className="whitespace-pre-wrap">{h.body}</p>
          </li>
        ))}
      </ol>
      <details>
        <summary className="cursor-pointer font-medium">Record an update</summary>
        <div className="mt-2 space-y-2">
          <TextareaField label="Update" hideLabel placeholder="What you told the client, or why it is resolved or reopened" value={body} onChange={(e) => setBody(e.target.value)} />
          <TextField label="Next update by" hint="Optional" type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || !body.trim()} onClick={() => void event("response")}>Record staff update</Button>
            {request.status === "open" ? (
              <Button size="sm" variant="outline" disabled={busy || !body.trim()} onClick={() => void event("resolution")}>Resolve</Button>
            ) : (
              <Button size="sm" variant="outline" disabled={busy || !body.trim()} onClick={() => void event("reopen")}>Reopen</Button>
            )}
          </div>
        </div>
      </details>
      <details>
        <summary className="cursor-pointer font-medium">Assign</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <SelectField label="Role" hideLabel value={kind} onChange={(e) => setKind(e.target.value as "accountable" | "backup")} options={[{ value: "accountable", label: "Accountable owner" }, { value: "backup", label: "Backup" }]} />
          <SelectField label="Person" hideLabel value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="Choose a staff member" options={staff.map((s) => ({ value: s.user_id, label: s.label }))} />
          <div><Button size="sm" variant="outline" disabled={busy || !assignee} onClick={() => void assign()}>Assign</Button></div>
        </div>
        {request.assignments.length ? (
          <ol className="mt-2 space-y-1 text-[12px] text-muted-foreground">
            {request.assignments.map((a) => (
              <li key={a.id}>{a.assignment_kind === "accountable" ? "Owner" : "Backup"}: {personLabel(a.assigned_to, names)} (by {personLabel(a.assigned_by, names)}, revision {a.revision})</li>
            ))}
          </ol>
        ) : null}
      </details>
      {error ? <p role="alert" className="text-red-700">{error}</p> : null}
    </li>
  );
}

function NewRequest({ clients, defaultClientSlug, staff, me, onCreated }: { clients: ClientOption[]; defaultClientSlug: string; staff: StaffOption[]; me: string; onCreated: () => void }) {
  const empty: NewRequestForm = { clientSlug: defaultClientSlug, engagementId: "", subject: "", question: "", channel: "slack", nextUpdateTarget: today(), accountableUserId: me };
  const [form, setForm] = useState<NewRequestForm>(empty);
  const [engagements, setEngagements] = useState<EngagementOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!form.clientSlug) return setEngagements([]);
    void db.from("engagements").select("id, cycle_number, status").eq("client_slug", form.clientSlug).order("cycle_number")
      .then(({ data }) => setEngagements(((data ?? []) as EngagementOption[]).slice().reverse()));
  }, [form.clientSlug]);
  const problem = newRequestProblem(form);
  const save = async () => {
    setError(null);
    const { error: e } = await db.rpc("create_support_request", {
      p_client_slug: form.clientSlug,
      p_engagement_id: form.engagementId || null,
      p_subject: form.subject.trim(),
      p_question: form.question.trim(),
      p_channel: form.channel,
      p_next_update_target: form.nextUpdateTarget,
      p_accountable_user_id: form.accountableUserId || null,
    });
    if (e) return setError(errorText(e.code, "The request could not be recorded."));
    setForm(empty);
    onCreated();
  };
  return (
    <div role="group" aria-label="New support request" className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <SelectField label="Client for the request" value={form.clientSlug} onChange={(e) => setForm({ ...form, clientSlug: e.target.value, engagementId: "" })} placeholder="Select a client" options={clients.map((c) => ({ value: c.slug, label: c.name }))} />
        <SelectField label="Engagement (optional)" value={form.engagementId} disabled={!form.clientSlug} onChange={(e) => setForm({ ...form, engagementId: e.target.value })} placeholder="No engagement" options={engagements.map((e) => ({ value: e.id, label: `Cycle ${e.cycle_number} (${e.status})` }))} />
        <TextField label="Subject" placeholder="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        <SelectField label="Came in by" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value as NewRequestForm["channel"] })} options={CHANNELS.map((c) => ({ value: c.value, label: c.label }))} />
      </div>
      <TextareaField label="Client question" placeholder="The client's question, as they asked it" value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} />
      <div className="grid gap-2 sm:grid-cols-2">
        <TextField label="Next update owed by" type="date" value={form.nextUpdateTarget} onChange={(e) => setForm({ ...form, nextUpdateTarget: e.target.value })} />
        <SelectField label="Accountable owner" value={form.accountableUserId} onChange={(e) => setForm({ ...form, accountableUserId: e.target.value })} options={staff.map((s) => ({ value: s.user_id, label: s.user_id === me ? `${s.label} (me)` : s.label }))} />
      </div>
      {problem && (form.subject || form.question) ? <p className="text-[12px] text-muted-foreground">{problem}</p> : null}
      <Button size="sm" disabled={!!problem} onClick={() => void save()}>Record question</Button>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}

export default function SupportInboxPage() {
  const { user } = useAuth();
  const me = user?.id ?? "";
  // The client comes from the one switcher at the top of the app. "All clients" shows every request.
  const { clients, selectedSlug: clientSlug } = useClientSelection();
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [status, setStatus] = useState<StatusFilter>("open");
  const [mine, setMine] = useState(false);
  const [requests, setRequests] = useState<SupportRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void db.rpc("handoff_staff_options").then(({ data }) =>
      setStaff(((data ?? []) as Array<{ user_id: string; display_name: string | null; email: string | null }>).map((r) => ({ user_id: r.user_id, label: r.display_name || r.email || "A staff member" }))),
    );
  }, []);

  const load = useCallback(async () => {
    let q = db.from("support_requests").select(REQUEST_SELECT);
    if (status !== "all") q = q.eq("status", status);
    if (clientSlug) q = q.eq("client_slug", clientSlug);
    const { data, error: e } = await q.order("updated_at", { ascending: false }).limit(200);
    if (e) {
      setError("The support inbox could not load.");
      setRequests([]);
      return;
    }
    setError(null);
    setRequests(sortRequests(((data ?? []) as RequestRow[]).map(toRequest)));
  }, [status, clientSlug]);
  useEffect(() => void load(), [load]);

  const names = Object.fromEntries(staff.map((s) => [s.user_id, s.label]));
  const shown = (requests ?? []).filter((r) => !mine || r.accountable_user_id === me || r.backup_user_id === me);
  const clientName = (slug: string) => clients.find((c) => c.slug === slug)?.name ?? slug;

  return (
    <PageShell data-testid="support-inbox">
      <PageHeader title="Support inbox" description="Client questions with an accountable owner and the date the next update is owed. Staff only." />
      <p className="rounded border border-input bg-muted/40 p-3 text-sm">{NO_SEND_NOTE}</p>
      <FilterBar>
        <SelectField label="Status" hideLabel value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} options={[{ value: "open", label: "Open" }, { value: "resolved", label: "Resolved" }, { value: "all", label: "All" }]} className="min-w-[10rem]" />
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine (owner or backup)
        </label>
      </FilterBar>
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {requests === null && !error ? <LoadingState label="Loading support requests" /> : null}
      {requests && shown.length === 0 && !error ? <EmptyState title="No requests match." /> : null}
      <ul className="space-y-3">
        {shown.map((r) => (
          <RequestCard key={`${r.id}:${r.revision}`} request={r} names={names} staff={staff} clientName={clientName(r.client_slug)} onChanged={() => void load()} />
        ))}
      </ul>
      <details>
        <summary className="cursor-pointer text-sm font-medium">Record a client question</summary>
        <div className="mt-2"><NewRequest clients={clients} defaultClientSlug={clientSlug} staff={staff} me={me} onCreated={() => void load()} /></div>
      </details>
    </PageShell>
  );
}
