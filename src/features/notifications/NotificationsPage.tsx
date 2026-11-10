// Notifications (phase 4, PR 4): the Admin page for Slack. Builders add Slack destinations, confirm
// them, pause them and turn Slack sending on or off (default off). Any staff member can create a
// reminder for themselves or a teammate and see the reminder list. The page only writes rows
// (slack_destinations, outbound_switches, reminders, all under their existing row rules); it never
// posts to Slack. run-slack-jobs does that, from production only, with the switch on and the key set.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClientPreview } from "@/hooks/useClientPreviewMode";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { CLIENT_SWITCHER_COLUMNS } from "@/lib/pageQueries";
import { TEAM_SELECT, type TeamMember } from "@/features/team/model";
import {
  CHANNEL_ID_HELP,
  DESTINATION_COLUMNS,
  destinationProblem,
  destinationState,
  EMPTY_DESTINATION,
  errorText,
  normalizeChannelId,
  PURPOSE_OPTIONS,
  purposeLabel,
  REMINDER_COLUMNS,
  REMINDER_STATE_LABEL,
  reminderBody,
  reminderProblem,
  SEND_SWITCH,
  SENDING_EXPLANATION,
  sendingText,
  slackKeyState,
  slackKeyText,
  SWITCH_COLUMNS,
  type Destination,
  type DestinationForm,
  type Purpose,
  type Reminder,
  type ReminderForm,
  type SendSwitch,
  type SlackKeyState,
} from "./model";

interface DbResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}
interface Query extends PromiseLike<DbResult> {
  eq(column: string, value: unknown): Query;
  order(column: string, options?: { ascending: boolean }): Query;
  limit(n: number): Query;
}
interface Table {
  select(columns: string): Query;
  insert(row: Record<string, unknown>): PromiseLike<DbResult>;
  upsert(row: Record<string, unknown>): PromiseLike<DbResult>;
  update(row: Record<string, unknown>): { eq(column: string, value: unknown): PromiseLike<DbResult> };
}
interface Untyped {
  from(table: string): Table;
  functions: { invoke(name: string, options: { method: "GET" }): Promise<{ data: unknown; error: unknown }> };
}
const db = supabase as unknown as Untyped;
const field = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const CARD = "rounded-lg border border-border bg-card p-4 space-y-2";

interface ClientOption { slug: string; name: string }
interface Loaded {
  destinations: Destination[];
  send: SendSwitch | null;
  reminders: Reminder[];
  members: TeamMember[];
  clients: ClientOption[];
}

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

function SendingSection({ send, builder, keyState, onChanged }: { send: SendSwitch | null; builder: boolean; keyState: SlackKeyState; onChanged: () => void }) {
  const enabled = send?.enabled === true;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = async (next: boolean) => {
    if (next && !window.confirm("Turn Slack sending on? Confirmed channels will get reminders and owner alerts, from production.")) return;
    setBusy(true);
    setError(null);
    const { error: e } = await db.from("outbound_switches").upsert({ name: SEND_SWITCH, enabled: next, note: next ? "Turned on from the Notifications page" : "Turned off from the Notifications page" });
    setBusy(false);
    if (e) return setError(errorText(e));
    onChanged();
  };
  return (
    <section aria-label="Slack sending" className={CARD} data-testid="slack-sending">
      <h2 className="text-sm font-semibold">Slack sending</h2>
      <p className="text-sm" data-testid="sending-state">{sendingText(enabled)}</p>
      <p className="text-xs text-muted-foreground">{SENDING_EXPLANATION}</p>
      <p className="text-xs" data-testid="slack-key-state">{slackKeyText(keyState)}</p>
      {builder ? (
        <Button size="sm" variant={enabled ? "outline" : "default"} disabled={busy} onClick={() => void set(!enabled)}>
          {enabled ? "Turn Slack sending off" : "Turn Slack sending on"}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">Only a builder can turn sending on or off.</p>
      )}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}

function DestinationRow({ d, builder, clientName, onChanged }: { d: Destination; builder: boolean; clientName: string | null; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const change = async (patch: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    const { error: e } = await db.from("slack_destinations").update(patch).eq("id", d.id);
    setBusy(false);
    if (e) return setError(errorText(e));
    onChanged();
  };
  return (
    <li className="rounded border border-input p-3 text-sm" data-testid="destination-row">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span><span className="font-medium">{d.label}</span> <span className="text-muted-foreground">{d.channel_id}</span></span>
        <span className="text-[12px] font-medium" data-testid="destination-state">{destinationState(d)}</span>
      </div>
      <div className="text-[12px] text-muted-foreground">{purposeLabel(d.purpose)}{clientName ? ` for ${clientName}` : ""}</div>
      {builder ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {!d.owner_confirmed ? (
            <Button size="sm" disabled={busy} onClick={() => void change({ owner_confirmed: true }, `Confirm ${d.label}? Once sending is on, reminders and alerts can be posted there.`)}>Confirm channel</Button>
          ) : null}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void change({ active: !d.active }, d.active ? `Pause ${d.label}? Nothing is posted there until it is resumed.` : undefined)}>
            {d.active ? "Pause" : "Resume"}
          </Button>
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-1 text-destructive">{error}</p> : null}
    </li>
  );
}

function DestinationsSection({ data, builder, onChanged }: { data: Loaded; builder: boolean; onChanged: () => void }) {
  const [form, setForm] = useState<DestinationForm>(EMPTY_DESTINATION);
  const [error, setError] = useState<string | null>(null);
  const problem = destinationProblem(form, data.destinations);
  const add = async () => {
    setError(null);
    const { error: e } = await db.from("slack_destinations").insert({
      label: form.label.trim(), channel_id: normalizeChannelId(form.channelId), purpose: form.purpose,
      client_slug: form.purpose === "client_reminders" ? form.clientSlug : null,
    });
    if (e) return setError(errorText(e));
    setForm(EMPTY_DESTINATION);
    onChanged();
  };
  const clientName = (slug: string | null) => (slug ? data.clients.find((c) => c.slug === slug)?.name ?? slug : null);
  return (
    <section aria-label="Slack destinations" className={CARD}>
      <h2 className="text-sm font-semibold">Slack destinations</h2>
      <p className="text-xs text-muted-foreground">The channels reminders and owner alerts may go to. A new channel starts unconfirmed: a builder confirms it before anything can be posted there.</p>
      {data.destinations.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="no-destinations">No Slack channel is added yet.</p> : null}
      <ul className="space-y-2">
        {data.destinations.map((d) => <DestinationRow key={`${d.id}:${d.owner_confirmed}:${d.active}`} d={d} builder={builder} clientName={clientName(d.client_slug)} onChanged={onChanged} />)}
      </ul>
      {builder ? (
        <div role="group" aria-label="Add a Slack channel" className="grid gap-2 sm:grid-cols-2">
          <input aria-label="Channel name" className={field} placeholder="#team-reminders" value={form.label} maxLength={120} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <input aria-label="Channel id" className={field} placeholder="C0123ABCD" value={form.channelId} onChange={(e) => setForm({ ...form, channelId: e.target.value })} />
          <select aria-label="What it is for" className={field} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value as Purpose, clientSlug: "" })}>
            {PURPOSE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {form.purpose === "client_reminders" ? (
            <select aria-label="Client for this channel" className={field} value={form.clientSlug} onChange={(e) => setForm({ ...form, clientSlug: e.target.value })}>
              <option value="">Choose a client</option>
              {data.clients.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          ) : <div />}
          {problem && (form.label || form.channelId) ? <p className="text-xs text-muted-foreground sm:col-span-2">{problem}</p> : <p className="text-xs text-muted-foreground sm:col-span-2">{CHANNEL_ID_HELP}</p>}
          <div className="sm:col-span-2"><Button size="sm" disabled={!!problem} onClick={() => void add()}>Add channel</Button></div>
          {error ? <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p> : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Only a builder adds or confirms channels.</p>
      )}
    </section>
  );
}

function RemindersSection({ data, selfMember, selfName, onChanged }: { data: Loaded; selfMember: TeamMember | null; selfName: string; onChanged: () => void }) {
  const usable = data.destinations.filter((d) => d.purpose === "internal" && d.active && d.owner_confirmed);
  const [form, setForm] = useState<ReminderForm>({ what: "", when: "", who: "self", destinationId: "" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const now = new Date();
  const destinationId = form.destinationId || (usable.length === 1 ? usable[0].id : "");
  const problem = reminderProblem({ ...form, destinationId }, now);
  const memberName = (id: string | null) => (id ? data.members.find((m) => m.id === id)?.name ?? null : null);
  const destLabel = (id: string) => data.destinations.find((d) => d.id === id)?.label ?? "a removed channel";

  const create = async () => {
    setError(null);
    setNotice(null);
    const member = form.who === "self" ? selfMember : data.members.find((m) => m.id === form.who) ?? null;
    const name = member?.name ?? (form.who === "self" ? selfName : "the team");
    const { error: e } = await db.from("reminders").insert({
      kind: "custom", destination_id: destinationId, body: reminderBody(name, form.what), due_at: new Date(form.when).toISOString(), for_member_id: member?.id ?? null,
    });
    if (e) return setError(errorText(e));
    setForm({ what: "", when: "", who: "self", destinationId: "" });
    setNotice("Reminder saved. It goes out at that time only if Slack sending is on and the channel is confirmed.");
    onChanged();
  };
  const cancel = async (r: Reminder) => {
    if (!window.confirm("Cancel this reminder? It will not be sent.")) return;
    const { error: e } = await db.from("reminders").update({ state: "canceled", cancel_reason: "Canceled on the Notifications page" }).eq("id", r.id);
    if (e) return setError(errorText(e));
    onChanged();
  };

  return (
    <section aria-label="Reminders" className={CARD}>
      <h2 className="text-sm font-semibold">Reminders</h2>
      {usable.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="no-usable-destination">
          No confirmed internal Slack channel is available yet, so a reminder has nowhere to go. A builder adds one under Slack destinations and confirms it.
        </p>
      ) : (
        <div role="group" aria-label="New reminder" className="grid gap-2 sm:grid-cols-2">
          <textarea aria-label="What" className={`${field} sm:col-span-2`} placeholder="What should the reminder say?" value={form.what} onChange={(e) => setForm({ ...form, what: e.target.value })} />
          <input aria-label="When" type="datetime-local" className={field} value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} />
          <select aria-label="Who" className={field} value={form.who} onChange={(e) => setForm({ ...form, who: e.target.value })}>
            <option value="self">Me</option>
            {data.members.filter((m) => m.active && m.id !== selfMember?.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select aria-label="Where" className={field} value={destinationId} onChange={(e) => setForm({ ...form, destinationId: e.target.value })}>
            <option value="">Choose a channel</option>
            {usable.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!!problem} onClick={() => void create()}>Save reminder</Button>
          </div>
          {problem && (form.what || form.when) ? <p className="text-xs text-muted-foreground sm:col-span-2">{problem}</p> : null}
        </div>
      )}
      {notice ? <p role="status" className="text-sm">{notice}</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {data.reminders.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="no-reminders">No reminders yet.</p> : null}
      <ul className="space-y-2">
        {data.reminders.map((r) => (
          <li key={`${r.id}:${r.state}`} className="rounded border border-input p-3 text-sm" data-testid="reminder-row">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{memberName(r.for_member_id) ? `For ${memberName(r.for_member_id)}` : "Reminder"}</span>
              <span className="text-[12px] font-medium" data-testid="reminder-state">{REMINDER_STATE_LABEL[r.state] ?? r.state}</span>
            </div>
            <p className="whitespace-pre-wrap">{r.body}</p>
            <p className="text-[12px] text-muted-foreground">Due {when(r.due_at)} · {destLabel(r.destination_id)}</p>
            {r.state === "scheduled" ? <Button size="sm" variant="outline" className="mt-2" aria-label={`Cancel the reminder due ${when(r.due_at)}`} onClick={() => void cancel(r)}>Cancel</Button> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function NotificationsPage() {
  const { isBuilder, user } = useAuth();
  const { isClientPreview, isEmployeePreview } = useClientPreview();
  const builder = isBuilder && !isClientPreview && !isEmployeePreview;
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyState, setKeyState] = useState<SlackKeyState>("unknown");

  const load = useCallback(async () => {
    try {
      const [dest, sw, rem, team, clients] = await Promise.all([
        db.from("slack_destinations").select(DESTINATION_COLUMNS).order("label"),
        db.from("outbound_switches").select(SWITCH_COLUMNS),
        db.from("reminders").select(REMINDER_COLUMNS).order("due_at", { ascending: false }).limit(100),
        db.from("app_users").select(TEAM_SELECT).order("name"),
        db.from("clients").select(CLIENT_SWITCHER_COLUMNS).order("name"),
      ]);
      if (dest.error || sw.error || rem.error || team.error) throw new Error("load");
      const list = <T,>(r: DbResult) => (Array.isArray(r.data) ? (r.data as T[]) : []);
      setError(null);
      setData({
        destinations: list<Destination>(dest),
        send: list<SendSwitch>(sw).find((s) => s.name === SEND_SWITCH) ?? null,
        reminders: list<Reminder>(rem),
        members: list<TeamMember>(team),
        clients: clients.error ? [] : list<{ slug: string; name: string; active: boolean }>(clients).filter((c) => c.active).map((c) => ({ slug: c.slug, name: c.name })),
      });
    } catch {
      setError("Notifications could not load, so this is not the same as nothing being set up.");
    }
  }, []);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    void (async () => {
      try {
        const { data: body, error: e } = await db.functions.invoke("integration-health", { method: "GET" });
        setKeyState(e ? "unknown" : slackKeyState(body));
      } catch {
        setKeyState("unknown");
      }
    })();
  }, []);

  const email = (user?.email ?? "").trim().toLowerCase();
  const selfMember = data?.members.find((m) => m.email.trim().toLowerCase() === email) ?? null;
  const selfName = selfMember?.name ?? (email.split("@")[0] || "me");

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6" data-testid="notifications-page">
      <PageHeader title="Notifications" description="Slack channels, the switch that lets Verdanote post to Slack, and reminders for you or a teammate." />
      {error ? (
        <div role="alert" className="rounded-lg border border-destructive/40 p-4 text-sm">
          {error} <button type="button" className="underline" onClick={() => void load()}>Try again</button>
        </div>
      ) : !data ? (
        <p role="status" className="text-sm text-muted-foreground">Loading notifications...</p>
      ) : (
        <>
          <SendingSection send={data.send} builder={builder} keyState={keyState} onChanged={() => void load()} />
          <DestinationsSection data={data} builder={builder} onChanged={() => void load()} />
          <RemindersSection data={data} selfMember={selfMember} selfName={selfName} onChanged={() => void load()} />
        </>
      )}
    </div>
  );
}
