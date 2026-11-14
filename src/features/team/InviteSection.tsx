// Invite by email (phase 4, PR 2), builders only. The form asks for a name, an email, a role and, for a
// client login, the client. A confirmation step ("Send invite to name at email?") comes before anything
// is sent. The invite-user function creates the login with Supabase Auth's own invite (no typed
// password) and Supabase sends the standard invite email. Below the form, the log shows who invited
// whom, whether they accepted, and lets a builder resend or revoke a waiting invite.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CLIENT_SWITCHER_COLUMNS } from "@/lib/pageQueries";
import { Button } from "@/components/ui/button";
import { ErrorState, SelectField, TextField, useConfirm } from "@/components/page-kit";
import { fmtDate } from "@/lib/formatters";
import {
  canActOnInvite,
  confirmationText,
  EMPTY_INVITE_FORM,
  INVITE_GENERIC_ERROR,
  INVITE_NOTE,
  INVITE_ROLE_OPTIONS,
  inviteErrorText,
  inviteFormProblem,
  inviteStateLabel,
  roleText,
  type InviteForm,
  type InviteLogRow,
  type InviteRole,
} from "./inviteModel";

interface DbResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}
interface Query extends PromiseLike<DbResult> {
  order(column: string, options?: { ascending: boolean }): Query;
}
interface Untyped {
  from(table: string): { select(columns: string): Query };
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<DbResult>;
  functions: { invoke(name: string, options: { body: Record<string, unknown> }): Promise<{ data: unknown; error: unknown }> };
}
const db = supabase as unknown as Untyped;
const FN = "invite-user";

export interface InvitePrefill {
  /** The prepared invite this form was opened from, cancelled once the real invite goes out. */
  preparedId: string;
  name: string;
  email: string;
  role: InviteRole;
}

interface ClientOption {
  slug: string;
  name: string;
}

const dateText = (iso: string) => fmtDate(iso, "unknown");

function LogRow({ row, onChanged }: { row: InviteLogRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const act = async (action: "resend" | "revoke") => {
    if (
      action === "revoke" &&
      !(await confirm({
        title: `Revoke the invite for ${row.display_name} (${row.email})?`,
        description: "Their login is removed and the link in their email stops working.",
        actionLabel: "Revoke",
      }))
    ) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: e } = await db.functions.invoke(FN, { body: { action, invite_id: row.id, redirect_origin: window.location.origin } });
    setBusy(false);
    if (e) return setError(await inviteErrorText(e, INVITE_GENERIC_ERROR));
    if (action === "resend") setNotice(`The invite email was sent again to ${row.email}.`);
    onChanged();
  };

  return (
    <li className="rounded border border-input p-3 text-sm" data-testid="invite-log-row">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-medium">{row.display_name}</span> <span className="text-muted-foreground">{row.email}</span>
        </div>
        <span className="text-[12px] font-medium" data-testid="invite-state">{inviteStateLabel(row)}</span>
      </div>
      <div className="text-[12px] text-muted-foreground">
        As {roleText(row.role)}{row.client_slug ? ` for ${row.client_slug}` : ""} · invited by {row.invited_by_name} on {dateText(row.created_at)}
        {row.sent_count > 1 ? ` · last sent ${dateText(row.last_sent_at)}` : ""}
      </div>
      {canActOnInvite(row) ? (
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="outline" disabled={busy} aria-label={`Resend the invite to ${row.email}`} onClick={() => void act("resend")}>Resend</Button>
          <Button size="sm" variant="outline" disabled={busy} aria-label={`Revoke the invite for ${row.email}`} onClick={() => void act("revoke")}>Revoke</Button>
        </div>
      ) : null}
      {notice ? <p role="status" className="mt-1 text-[12px] text-muted-foreground">{notice}</p> : null}
      {error ? <p role="alert" className="mt-1 text-destructive">{error}</p> : null}
      {dialog}
    </li>
  );
}

export function InviteSection({ prefill, onSent }: { prefill: InvitePrefill | null; onSent: (preparedId: string | null) => void }) {
  const [form, setForm] = useState<InviteForm>(EMPTY_INVITE_FORM);
  const [preparedId, setPreparedId] = useState<string | null>(null);
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [log, setLog] = useState<InviteLogRow[] | null>(null);
  const [logError, setLogError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await db.rpc("list_user_invites");
    if (!r || r.error) {
      setLogError("The invite list could not load.");
      setLog([]);
      return;
    }
    setLogError(null);
    setLog(Array.isArray(r.data) ? (r.data as InviteLogRow[]) : []);
  }, []);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    void (async () => {
      const r = await db.from("clients").select(CLIENT_SWITCHER_COLUMNS).order("name");
      const rows = !r.error && Array.isArray(r.data) ? (r.data as { slug: string; name: string; active: boolean }[]) : [];
      setClients(rows.filter((c) => c.active).map((c) => ({ slug: c.slug, name: c.name })));
    })();
  }, []);
  useEffect(() => {
    if (!prefill) return;
    setForm({ name: prefill.name, email: prefill.email, role: prefill.role, clientSlug: "" });
    setPreparedId(prefill.preparedId);
    setStep("form");
    setError(null);
    setNotice(null);
  }, [prefill]);

  const problem = inviteFormProblem(form);
  const clientName = clients.find((c) => c.slug === form.clientSlug)?.name ?? null;

  const send = async () => {
    setBusy(true);
    setError(null);
    const { error: e } = await db.functions.invoke(FN, {
      body: {
        action: "invite",
        email: form.email.trim(),
        display_name: form.name.trim(),
        role: form.role,
        client_slug: form.role === "client" ? form.clientSlug : undefined,
        redirect_origin: window.location.origin,
      },
    });
    setBusy(false);
    if (e) {
      setStep("form");
      return setError(await inviteErrorText(e, INVITE_GENERIC_ERROR));
    }
    setNotice(`Invite sent to ${form.name.trim()} at ${form.email.trim()}.`);
    setForm(EMPTY_INVITE_FORM);
    setStep("form");
    onSent(preparedId);
    setPreparedId(null);
    void load();
  };

  return (
    <section aria-label="Invite by email" className="space-y-2" data-testid="invite-by-email">
      <h2 className="text-lg font-semibold">Invite by email</h2>
      <p className="rounded border border-input bg-muted/40 p-3 text-sm">{INVITE_NOTE}</p>
      {step === "form" ? (
        <div role="group" aria-label="Invite details" className="grid gap-2 sm:grid-cols-2">
          <TextField label="Invitee name" hideLabel placeholder="Name" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField label="Invitee email" hideLabel type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <SelectField label="Invitee role" hideLabel value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as InviteRole, clientSlug: "" })}
            options={INVITE_ROLE_OPTIONS.map((r) => ({ value: r.value, label: r.label }))} />
          {form.role === "client" ? (
            <SelectField label="Invitee client" hideLabel value={form.clientSlug} onChange={(e) => setForm({ ...form, clientSlug: e.target.value })}
              placeholder="Choose a client" options={clients.map((c) => ({ value: c.slug, label: c.name }))} />
          ) : <div />}
          {problem && (form.name || form.email) ? <p className="text-[12px] text-muted-foreground sm:col-span-2">{problem}</p> : null}
          <div className="sm:col-span-2">
            <Button size="sm" disabled={!!problem} onClick={() => { setError(null); setNotice(null); setStep("confirm"); }}>Review invite</Button>
          </div>
        </div>
      ) : (
        <div role="group" aria-label="Confirm invite" className="space-y-2 rounded border border-input p-3 text-sm">
          <p data-testid="invite-confirm-text">{confirmationText(form, clientName)}</p>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void send()}>{busy ? "Sending..." : "Send invite"}</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setStep("form")}>Back</Button>
          </div>
        </div>
      )}
      {notice ? <p role="status" className="text-sm">{notice}</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

      <h3 className="pt-2 text-sm font-semibold">Sent invites</h3>
      {logError ? <ErrorState message={logError} onRetry={() => void load()} /> : null}
      {log && log.length === 0 && !logError ? <p className="text-sm text-muted-foreground">No invites have been sent yet.</p> : null}
      <ul className="space-y-2">{(log ?? []).map((r) => <LogRow key={`${r.id}:${r.status}:${r.sent_count}:${r.accepted}`} row={r} onChanged={() => void load()} />)}</ul>
    </section>
  );
}
