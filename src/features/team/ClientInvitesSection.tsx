// Client invites and the two-client pilot (Goodo OS story OS-021), builders only.
//
// 1. Email text: edit the subject and body; Approve marks it approved. Any edit clears the approval.
// 2. Batches: a pilot of exactly two clients, then batches of up to five. Clients on the ending list
//    (Cattasaurus, Marek, Miracle, Royo) and ending or inactive clients are greyed out and cannot be
//    picked. Add contacts per client, approve the batch, then Send. With sending switched off the
//    client-invite function answers with a dry run and this page shows what would have been sent.
// 3. Status: per batch client, whether the invite was accepted, whether an invited person has
//    approved a task in the app, the guest access review date (sent + 14 days), and a button to
//    record Matthew's confirmation that the ClickUp guest views may be removed. The button only
//    records the confirmation; nothing here changes ClickUp.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ErrorState, TextareaField, TextField, useConfirm } from "@/components/page-kit";
import { fmtDate } from "@/lib/formatters";
import { inviteErrorText } from "./inviteModel";
import {
  batchProblem,
  blockedLabel,
  blockedReason,
  canPickMore,
  contactProblem,
  inviteDbError,
  reviewDue,
  type ClientInvite,
  type ExcludedClient,
  type InviteBatch,
  type InviteClient,
  type InviteTemplate,
  type PilotStatusRow,
} from "./clientInvitesModel";

interface DbResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}
interface Query extends PromiseLike<DbResult> {
  order(column: string, options?: { ascending: boolean }): Query;
  maybeSingle(): PromiseLike<DbResult>;
}
interface Untyped {
  from(table: string): { select(columns: string): Query };
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<DbResult>;
  functions: { invoke(name: string, options: { body: Record<string, unknown> }): Promise<{ data: unknown; error: unknown }> };
}
const db = supabase as unknown as Untyped;
const FN = "client-invite";

const list = <T,>(r: DbResult | undefined): T[] => (r && !r.error && Array.isArray(r.data) ? (r.data as T[]) : []);

interface SendResult {
  dry_run: boolean;
  would_send?: { email: string; client_slug: string }[];
  sent?: { email: string; client_slug: string }[];
  skipped?: { email: string; reason: string }[];
  failed?: { email: string; reason: string }[];
}

function TemplateEditor({ template, onChanged }: { template: InviteTemplate; onChanged: () => void }) {
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const edited = subject !== template.subject || body !== template.body;

  const run = async (fn: string, args?: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const { error: e } = await db.rpc(fn, args);
    setBusy(false);
    if (e) return setError(inviteDbError(e));
    onChanged();
  };

  return (
    <div role="group" aria-label="Invite email text" className="space-y-2 rounded border border-input p-3 text-sm">
      <p data-testid="template-state" className="font-medium">
        {template.approved_at ? `✓ Approved ${fmtDate(template.approved_at)}` : "○ Not approved. No invite can be sent until the text is approved."}
      </p>
      <TextField label="Email subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
      <TextareaField label="Email body" value={body} rows={5} maxLength={5000} onChange={(e) => setBody(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy || !edited || !subject.trim() || !body.trim()}
          onClick={() => void run("os_client_invite_save_template", { p_subject: subject, p_body: body })}>
          Save text
        </Button>
        <Button size="sm" disabled={busy || edited || !!template.approved_at} onClick={() => void run("os_client_invite_approve_template")}>
          Approve text
        </Button>
      </div>
      {edited ? <p className="text-[12px] text-muted-foreground">Saving the text clears its approval.</p> : null}
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    </div>
  );
}

function NewBatch({ clients, excluded, hasPilot, onChanged }: {
  clients: InviteClient[];
  excluded: ExcludedClient[];
  hasPilot: boolean;
  onChanged: () => void;
}) {
  const [kind, setKind] = useState<"pilot" | "batch">(hasPilot ? "batch" : "pilot");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setKind(hasPilot ? "batch" : "pilot"), [hasPilot]);
  const problem = batchProblem(kind, name, picked);

  const toggle = (slug: string) =>
    setPicked((p) => (p.includes(slug) ? p.filter((s) => s !== slug) : canPickMore(kind, p) ? [...p, slug] : p));

  const create = async () => {
    setError(null);
    const { error: e } = await db.rpc("os_client_invite_create_batch", { p_name: name.trim(), p_kind: kind, p_client_slugs: picked });
    if (e) return setError(inviteDbError(e));
    setName("");
    setPicked([]);
    onChanged();
  };

  return (
    <div role="group" aria-label="New batch" className="space-y-2 rounded border border-input p-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1">
          <input type="radio" name="batch-kind" checked={kind === "pilot"} onChange={() => { setKind("pilot"); setPicked([]); }} /> Pilot (2 clients)
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" name="batch-kind" checked={kind === "batch"} onChange={() => { setKind("batch"); setPicked([]); }} /> Batch (up to 5)
        </label>
      </div>
      <TextField label="Batch name" hideLabel placeholder="Batch name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      <ul className="grid gap-1 sm:grid-cols-2" aria-label="Clients">
        {clients.map((c) => {
          const reason = blockedReason(c, excluded);
          const on = picked.includes(c.slug);
          const full = !on && !canPickMore(kind, picked);
          return (
            <li key={c.slug} className={reason ? "text-muted-foreground opacity-60" : ""} data-testid="invite-client-option">
              <label className="flex items-center gap-2">
                <input type="checkbox" aria-label={c.name} disabled={!!reason || full} checked={on} onChange={() => toggle(c.slug)} />
                {c.name}
                {reason ? <span className="text-[12px]">· {blockedLabel(reason)}</span> : null}
              </label>
            </li>
          );
        })}
      </ul>
      {problem && (name || picked.length) ? <p className="text-[12px] text-muted-foreground">{problem}</p> : null}
      <Button size="sm" disabled={!!problem} onClick={() => void create()}>Create {kind === "pilot" ? "pilot" : "batch"}</Button>
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    </div>
  );
}

function BatchCard({ batch, invites, clientName, templateApproved, onChanged }: {
  batch: InviteBatch;
  invites: ClientInvite[];
  clientName: (slug: string) => string;
  templateApproved: boolean;
  onChanged: () => void;
}) {
  const [contact, setContact] = useState({ slug: batch.client_slugs[0] ?? "", email: "", name: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const { confirm, dialog } = useConfirm();
  const problem = contactProblem(contact.email, contact.name);
  const approved = !!batch.approved_at;
  const hasUnsent = invites.some((i) => i.status === "approved");

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const { error: e } = await db.rpc(fn, args);
    setBusy(false);
    if (e) {
      setError(inviteDbError(e));
      return false;
    }
    onChanged();
    return true;
  };

  const send = async () => {
    if (!(await confirm({
      title: `Send the invites for ${batch.name}?`,
      description: `${invites.filter((i) => i.status === "approved").length} contact(s). If sending is switched off you will see a dry run and nothing is sent.`,
      actionLabel: "Send",
    }))) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const { data, error: e } = await db.functions.invoke(FN, { body: { action: "send", batch_id: batch.id, redirect_origin: window.location.origin } });
    setBusy(false);
    if (e) return setError(await inviteErrorText(e, "The batch could not be sent. Try again."));
    setResult(data as SendResult);
    onChanged();
  };

  return (
    <li className="space-y-2 rounded border border-input p-3 text-sm" data-testid="invite-batch">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{batch.name} <span className="text-muted-foreground">({batch.kind === "pilot" ? "pilot" : "batch"})</span></span>
        <span className="text-[12px]" data-testid="batch-state">
          {batch.sent_at ? `✓ Sent ${fmtDate(batch.sent_at)}` : approved ? "✓ Approved, not sent" : "○ Draft"}
        </span>
      </div>
      <p className="text-[12px] text-muted-foreground">Clients: {batch.client_slugs.map(clientName).join(", ")}</p>
      <ul className="space-y-1">
        {invites.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2" data-testid="invite-contact">
            <span>{i.display_name} <span className="text-muted-foreground">{i.email}</span> · {clientName(i.client_slug)}</span>
            <span className="flex items-center gap-2 text-[12px]">
              {i.status}
              {i.status === "draft" ? (
                <Button size="sm" variant="outline" disabled={busy} aria-label={`Remove ${i.email}`}
                  onClick={() => void rpc("os_client_invite_remove_contact", { p_invite_id: i.id })}>Remove</Button>
              ) : null}
            </span>
          </li>
        ))}
        {invites.length === 0 ? <li className="text-muted-foreground">No contacts yet.</li> : null}
      </ul>
      {!approved ? (
        <div role="group" aria-label={`Add a contact to ${batch.name}`} className="grid gap-2 sm:grid-cols-4">
          <select aria-label="Contact client" className="rounded border border-input bg-background px-2 text-sm" value={contact.slug}
            onChange={(e) => setContact({ ...contact, slug: e.target.value })}>
            {batch.client_slugs.map((s) => <option key={s} value={s}>{clientName(s)}</option>)}
          </select>
          <TextField label="Contact name" hideLabel placeholder="Name" value={contact.name} maxLength={120} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
          <TextField label="Contact email" hideLabel type="email" placeholder="Email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
          <Button size="sm" variant="outline" disabled={busy || !!problem}
            onClick={() => void rpc("os_client_invite_add_contact", { p_batch_id: batch.id, p_client_slug: contact.slug, p_email: contact.email.trim(), p_display_name: contact.name.trim() })
              .then((ok) => { if (ok) setContact({ ...contact, email: "", name: "" }); })}>
            Add contact
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!approved ? (
          <Button size="sm" disabled={busy || invites.length === 0} onClick={() => void rpc("os_client_invite_approve_batch", { p_batch_id: batch.id })}>Approve batch</Button>
        ) : null}
        {approved && hasUnsent ? (
          <Button size="sm" disabled={busy || !templateApproved} onClick={() => void send()}>Send invites</Button>
        ) : null}
        {approved && hasUnsent && !templateApproved ? <span className="text-[12px] text-muted-foreground">Approve the email text first.</span> : null}
      </div>
      {result ? (
        <div role="status" className="rounded bg-muted/40 p-2 text-[12px]" data-testid="send-result">
          {result.dry_run ? (
            <p className="font-medium">Dry run: sending is switched off. Nothing was sent. These would be sent:</p>
          ) : (
            <p className="font-medium">Sent {result.sent?.length ?? 0} invite(s).</p>
          )}
          <ul>{(result.dry_run ? result.would_send : result.sent)?.map((p) => <li key={p.email}>→ {p.email}</li>)}</ul>
          {result.skipped?.length ? <ul>{result.skipped.map((p) => <li key={p.email}>– {p.email} skipped ({p.reason})</li>)}</ul> : null}
          {result.failed?.length ? <ul>{result.failed.map((p) => <li key={p.email}>× {p.email} failed ({p.reason})</li>)}</ul> : null}
        </div>
      ) : null}
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      {dialog}
    </li>
  );
}

function StatusTable({ rows, now, onChanged }: { rows: PilotStatusRow[]; now: Date; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const confirmed = new Set<string>();
  const record = async (row: PilotStatusRow) => {
    if (!(await confirm({
      title: `Record that Matthew confirmed the ClickUp guest access for ${row.batch_name} can be removed?`,
      description: "This only records the confirmation. Nothing is changed in ClickUp; remove the guest views there by hand.",
      actionLabel: "Record confirmation",
    }))) return;
    setError(null);
    const { error: e } = await db.rpc("os_client_invite_confirm_guest_removal", { p_batch_id: row.batch_id });
    if (e) return setError(inviteDbError(e));
    onChanged();
  };
  if (!rows.length) return <p className="text-sm text-muted-foreground">No batches yet.</p>;
  return (
    <div className="space-y-2">
      <table className="w-full text-sm" aria-label="Invite status">
        <thead>
          <tr className="text-left text-[12px] text-muted-foreground">
            <th>Batch</th><th>Client</th><th>Invite accepted</th><th>Client approval</th><th>Guest access review</th><th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const first = !confirmed.has(r.batch_id);
            confirmed.add(r.batch_id);
            const due = reviewDue(r.guest_access_review_after, now);
            return (
              <tr key={`${r.batch_id}:${r.client_slug}`} className="border-t border-input align-top" data-testid="invite-status-row">
                <td>{r.batch_name}</td>
                <td>{r.client_name}</td>
                <td>{r.accepted > 0 ? `✓ ${r.accepted} of ${r.sent}` : r.sent > 0 ? `○ 0 of ${r.sent}` : "– not sent"}</td>
                <td>{r.client_approval_done ? "✓ done" : "○ not yet"}</td>
                <td>{r.guest_access_review_after ? fmtDate(r.guest_access_review_after) : "– after sending"}</td>
                <td>
                  {first ? (
                    r.guest_access_removal_confirmed_at ? (
                      <span className="text-[12px]">✓ Confirmed {fmtDate(r.guest_access_removal_confirmed_at)}</span>
                    ) : (
                      <Button size="sm" variant="outline" disabled={!due} onClick={() => void record(r)}
                        aria-label={`Matthew confirms ClickUp guest access can be removed for ${r.batch_name}`}>
                        Matthew confirms ClickUp guest access can be removed
                      </Button>
                    )
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {dialog}
    </div>
  );
}

export function ClientInvitesSection({ now = () => new Date() }: { now?: () => Date }) {
  const [template, setTemplate] = useState<InviteTemplate | null>(null);
  const [clients, setClients] = useState<InviteClient[]>([]);
  const [excluded, setExcluded] = useState<ExcludedClient[]>([]);
  const [batches, setBatches] = useState<InviteBatch[]>([]);
  const [invites, setInvites] = useState<ClientInvite[]>([]);
  const [status, setStatus] = useState<PilotStatusRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [t, c, x, b, i, s] = await Promise.all([
      db.from("os_client_invite_template").select("subject, body, approved_at").maybeSingle(),
      db.from("clients").select("slug, name, status, active").order("name"),
      db.from("os_invite_excluded_clients").select("client_slug, name_prefix").order("client_slug"),
      db.from("os_client_invite_batches").select("id, name, kind, client_slugs, created_at, approved_at, sent_at, guest_access_review_after, guest_access_removal_confirmed_at").order("created_at"),
      db.from("os_client_invites").select("id, batch_id, client_slug, email, display_name, status, accepted_at").order("created_at"),
      db.rpc("os_client_invite_pilot_status"),
    ]);
    if (!t || t.error || !t.data) {
      setLoadError("The client invites could not load.");
      return;
    }
    setLoadError(null);
    setTemplate(t.data as InviteTemplate);
    setClients(list<InviteClient>(c));
    setExcluded(list<ExcludedClient>(x));
    setBatches(list<InviteBatch>(b));
    setInvites(list<ClientInvite>(i));
    setStatus(list<PilotStatusRow>(s));
  }, []);
  useEffect(() => void load(), [load]);

  const clientName = (slug: string) => clients.find((c) => c.slug === slug)?.name ?? slug;

  return (
    <section aria-label="Client invites" className="space-y-3" data-testid="client-invites">
      <h2 className="text-lg font-semibold">Client invites</h2>
      <p className="rounded border border-input bg-muted/40 p-3 text-sm">
        Pilot with two clients while their ClickUp guest views stay on for two weeks, then move the rest in batches of up to five.
        Cattasaurus, Marek, Miracle, Royo and other ending clients are never invited. Nothing here changes ClickUp.
      </p>
      {loadError ? <ErrorState message={loadError} onRetry={() => void load()} /> : null}
      {template ? (
        <>
          <h3 className="text-sm font-semibold">Email text</h3>
          <TemplateEditor key={`${template.subject}:${template.body}:${template.approved_at}`} template={template} onChanged={() => void load()} />
          <h3 className="text-sm font-semibold">New batch</h3>
          <NewBatch clients={clients} excluded={excluded} hasPilot={batches.some((b) => b.kind === "pilot")} onChanged={() => void load()} />
          <h3 className="text-sm font-semibold">Batches</h3>
          {batches.length === 0 ? <p className="text-sm text-muted-foreground">No batches yet.</p> : null}
          <ul className="space-y-2">
            {batches.map((b) => (
              <BatchCard key={b.id} batch={b} invites={invites.filter((i) => i.batch_id === b.id)}
                clientName={clientName} templateApproved={!!template.approved_at} onChanged={() => void load()} />
            ))}
          </ul>
          <h3 className="text-sm font-semibold">Pilot and batch status</h3>
          <StatusTable rows={status} now={now()} onChanged={() => void load()} />
        </>
      ) : null}
    </section>
  );
}
