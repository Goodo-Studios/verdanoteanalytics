// Support inbox: staff page (consolidation step 4d, port of the Goodo OS staff page
// src/pages/staff/SupportInbox.tsx). Staff record a client's question with the channel it
// came in on, an accountable owner and the date the next update is owed; give staff updates,
// resolve and reopen against the revision on screen; and name the accountable owner or a
// backup. Every write goes through a checked database function (migration 20261111000004).
// Clients read none of it, and nothing is sent to a client from here.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
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
        <span data-testid={`support-status-${request.id}`} className={`rounded border px-2 py-0.5 text-[12px] ${overdue ? "border-amber-200 bg-amber-50 text-amber-900" : ""}`}>
          {request.status === "resolved" ? "Resolved" : overdue ? "Update overdue" : "Open"}
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
          <textarea aria-label="Update" className={field} placeholder="What you told the client, or why it is resolved or reopened" value={body} onChange={(e) => setBody(e.target.value)} />
          <label className="block text-[12px] text-muted-foreground">
            Next update by (optional)
            <input aria-label="Next update by" type="date" className={field} value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
          </label>
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
          <select aria-label="Role" className={field} value={kind} onChange={(e) => setKind(e.target.value as "accountable" | "backup")}>
            <option value="accountable">Accountable owner</option>
            <option value="backup">Backup</option>
          </select>
          <select aria-label="Person" className={field} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Choose a staff member</option>
            {staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.label}</option>)}
          </select>
          <Button size="sm" variant="outline" disabled={busy || !assignee} onClick={() => void assign()}>Assign</Button>
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

function NewRequest({ clients, staff, me, onCreated }: { clients: ClientOption[]; staff: StaffOption[]; me: string; onCreated: () => void }) {
  const empty: NewRequestForm = { clientSlug: "", engagementId: "", subject: "", question: "", channel: "slack", nextUpdateTarget: today(), accountableUserId: me };
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
        <select aria-label="Client for the request" className={field} value={form.clientSlug} onChange={(e) => setForm({ ...form, clientSlug: e.target.value, engagementId: "" })}>
          <option value="">Select a client</option>
          {clients.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
        <select aria-label="Engagement (optional)" className={field} value={form.engagementId} disabled={!form.clientSlug} onChange={(e) => setForm({ ...form, engagementId: e.target.value })}>
          <option value="">No engagement</option>
          {engagements.map((e) => <option key={e.id} value={e.id}>Cycle {e.cycle_number} ({e.status})</option>)}
        </select>
        <input aria-label="Subject" className={field} placeholder="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        <select aria-label="Came in by" className={field} value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value as NewRequestForm["channel"] })}>
          {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
      <textarea aria-label="Client question" className={field} placeholder="The client's question, as they asked it" value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} />
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-[12px] text-muted-foreground">
          Next update owed by
          <input aria-label="Next update owed by" type="date" className={field} value={form.nextUpdateTarget} onChange={(e) => setForm({ ...form, nextUpdateTarget: e.target.value })} />
        </label>
        <label className="block text-[12px] text-muted-foreground">
          Accountable owner
          <select aria-label="Accountable owner" className={field} value={form.accountableUserId} onChange={(e) => setForm({ ...form, accountableUserId: e.target.value })}>
            {staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.user_id === me ? `${s.label} (me)` : s.label}</option>)}
          </select>
        </label>
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
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [status, setStatus] = useState<StatusFilter>("open");
  const [clientSlug, setClientSlug] = useState("");
  const [mine, setMine] = useState(false);
  const [requests, setRequests] = useState<SupportRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void db.from("clients").select("slug, name").order("name").then(({ data }) => setClients((data ?? []) as ClientOption[]));
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
    <div className="mx-auto w-full max-w-4xl space-y-4" data-testid="support-inbox">
      <PageHeader title="Support inbox" description="Client questions with an accountable owner and the date the next update is owed. Staff only." />
      <p className="rounded border border-input bg-muted/40 p-3 text-sm">{NO_SEND_NOTE}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <select aria-label="Status" className={field} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="all">All</option>
        </select>
        <select aria-label="Client" className={field} value={clientSlug} onChange={(e) => setClientSlug(e.target.value)}>
          <option value="">All clients</option>
          {clients.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine (owner or backup)
        </label>
      </div>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {requests && shown.length === 0 ? <p className="text-sm text-muted-foreground">No requests match.</p> : null}
      <ul className="space-y-3">
        {shown.map((r) => (
          <RequestCard key={`${r.id}:${r.revision}`} request={r} names={names} staff={staff} clientName={clientName(r.client_slug)} onChanged={() => void load()} />
        ))}
      </ul>
      <details>
        <summary className="cursor-pointer text-sm font-medium">Record a client question</summary>
        <div className="mt-2"><NewRequest clients={clients} staff={staff} me={me} onCreated={() => void load()} /></div>
      </details>
    </div>
  );
}
