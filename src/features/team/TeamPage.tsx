// Team and settings: staff page (consolidation step 5d, the old dashboard Settings team half,
// merged with Verdanote's user management). One place to manage staff: the team list
// (app_users), the role mapping as data, the reconciliation of the team list with Verdanote
// logins and roles, prepared invites and the record of changes. Every write goes through a
// checked database function (migration 20261111040001). Employees see the team list and the
// mapping; the reconciliation, invites, edits and the record are builder only. Client logins
// and their ad accounts stay in Settings > Admin. Nothing here sends an invite or an email.
// The old Settings "Active clients" half is the Clients section (ClientsSettings.tsx).
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useRolePrefix } from "@/hooks/useRolePath";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClientPreview } from "@/hooks/useClientPreviewMode";
import { ErrorState, LoadingState, PageHeader, PageShell, SelectField, TextareaField, TextField, useConfirm } from "@/components/page-kit";
import { fmtDateTime } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ConfirmCopy } from "@/components/page-kit/ConfirmAction";
import { ClientsSettings } from "./ClientsSettings";
import { InviteSection, type InvitePrefill } from "./InviteSection";
import { ClientInvitesSection } from "./ClientInvitesSection";
import {
  canAddToTeam,
  canPrepareInvite,
  cancelReasonProblem,
  DASHBOARD_ROLES,
  errorText,
  EVENT_LABEL,
  EVENT_SELECT,
  INVITE_SELECT,
  ISSUE_INFO,
  ISSUE_ORDER,
  MAPPING_SELECT,
  mappingFormProblem,
  memberFormProblem,
  NO_SEND_NOTE,
  proposedChange,
  type ReconRow,
  type RoleMapping,
  roleActionFor,
  roleLabel,
  sortPeople,
  sortTeam,
  STAFF_ROLES,
  type StaffEvent,
  type StaffInvite,
  summarize,
  TEAM_SELECT,
  type TeamMember,
} from "./model";

// The staff tables are not in the generated types.
interface DbResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}
interface Query extends PromiseLike<DbResult> {
  order(column: string, options?: { ascending: boolean }): Query;
  limit(n: number): Query;
}
interface Untyped {
  from(table: string): { select(columns: string): Query };
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<DbResult>;
}
const db = supabase as unknown as Untyped;

function PersonRow({ row, onChanged }: { row: ReconRow; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();
  const prefix = useRolePrefix();
  const role = roleActionFor(row);
  const proposal = proposedChange(row);
  const name = row.team_name ?? row.login_name ?? row.email;

  const act = async (fn: string, args: Record<string, unknown>, confirmCopy?: ConfirmCopy) => {
    if (confirmCopy && !(await confirm(confirmCopy))) return;
    setBusy(true);
    setError(null);
    const { error: e } = await db.rpc(fn, args);
    setBusy(false);
    if (e) return setError(errorText(e));
    onChanged();
  };

  return (
    <li className="rounded border border-input p-3 text-sm" data-testid="recon-row">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-medium">{name}</span> <span className="text-muted-foreground">{row.email}</span>
        </div>
        <div className="text-[12px] text-muted-foreground">
          Team list: {row.team_member_id ? `${roleLabel(row.team_role)}${row.team_active ? "" : " (deactivated)"}` : "not on it"} · Login:{" "}
          {row.user_id ? (row.staff_roles.length ? row.staff_roles.map(roleLabel).join(", ") : row.has_client_role ? "Client" : "no role") : "none"}
          {row.mapped_role ? ` · Mapped: ${roleLabel(row.mapped_role)}` : ""}
        </div>
      </div>
      {row.issues.length ? (
        <ul className="mt-1 list-disc pl-5">
          {row.issues.map((i) => (
            <li key={i}>
              <span className="font-medium">{ISSUE_INFO[i]?.label ?? i}.</span> {ISSUE_INFO[i]?.effect}
              {i === "possible_name_match" && row.possible_match ? ` Possible match: ${row.possible_match}.` : ""}
              {i === "no_client_linked" ? (
                <>
                  {" "}
                  <Link to={`${prefix}/clients`} className="underline" data-testid="no-client-linked-link">
                    Open Clients, pick the client and use its Setup tab
                  </Link>
                  .
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {proposal ? <p className="mt-1">Proposed: {proposal}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {canPrepareInvite(row) ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void act("prepare_staff_invite", { p_team_member_id: row.team_member_id })}>
            Prepare invite (not sent)
          </Button>
        ) : null}
        {canAddToTeam(row) ? (
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => void act("add_login_to_team_list", { p_user_id: row.user_id, p_name: row.login_name }, { title: `Add ${name} to the team list?`, description: "They will be listed on the team and offered in owner dropdowns.", actionLabel: "Add to team list", tone: "default" })}>
            Add to team list
          </Button>
        ) : null}
        {role ? (
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => void act("set_staff_role", { p_user_id: row.user_id, p_role: role }, { title: `Set ${name}'s Verdanote role to ${roleLabel(role)}?`, description: "This changes what they can open.", actionLabel: "Set role", tone: "default" })}>
            Set role to {roleLabel(role)}
          </Button>
        ) : null}
      </div>
      {error ? <p role="alert" className="mt-1 text-destructive">{error}</p> : null}
      {dialog}
    </li>
  );
}

function Reconciliation({ rows, onChanged }: { rows: ReconRow[]; onChanged: () => void }) {
  const summary = summarize(rows);
  const people = sortPeople(rows);
  const withIssues = people.filter((r) => r.issues.length > 0);
  return (
    <section aria-label="Reconciliation" className="space-y-2">
      <h2 className="text-lg font-semibold">Staff list check</h2>
      <p className="text-sm text-muted-foreground">
        The team list, Verdanote logins and Verdanote roles, matched by exact email (case and spaces ignored). Nobody is merged by name;
        each change below happens only when a builder presses its button.
      </p>
      <p className="text-sm" data-testid="recon-summary">
        {summary.people} people, {summary.clean} lined up, {summary.people - summary.clean} with something to settle.
      </p>
      <ul className="grid gap-1 text-[13px] sm:grid-cols-2">
        {ISSUE_ORDER.filter((i) => summary.counts[i] > 0).map((i) => (
          <li key={i}>{ISSUE_INFO[i].label}: {summary.counts[i]}</li>
        ))}
      </ul>
      <ul className="space-y-2">
        {withIssues.map((r) => <PersonRow key={`${r.email}:${r.issues.join(",")}`} row={r} onChanged={onChanged} />)}
      </ul>
    </section>
  );
}

function MemberEditor({ member, onChanged }: { member: TeamMember; onChanged: () => void }) {
  const [form, setForm] = useState({ name: member.name, role: member.role as string, active: member.active });
  const [error, setError] = useState<string | null>(null);
  const problem = memberFormProblem(form);
  const { confirm, dialog } = useConfirm();
  const changed = form.name.trim() !== member.name || form.role !== member.role || form.active !== member.active;
  const save = async () => {
    if (form.active !== member.active && !form.active && !(await confirm({ title: `Deactivate ${member.name} on the team list?`, description: "Their Verdanote login is not changed.", actionLabel: "Deactivate" }))) return;
    setError(null);
    const { error: e } = await db.rpc("update_team_member", { p_team_member_id: member.id, p_name: form.name.trim(), p_dashboard_role: form.role, p_active: form.active });
    if (e) return setError(errorText(e));
    onChanged();
  };
  return (
    <div role="group" aria-label={`Edit ${member.name}`} className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <TextField label="Name" hideLabel value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <SelectField label="Dashboard role" hideLabel value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} options={DASHBOARD_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active
      </label>
      <Button size="sm" disabled={!!problem || !changed} onClick={() => void save()}>Save</Button>
      {problem ? <p className="text-[12px] text-muted-foreground sm:col-span-2 lg:col-span-4">{problem}</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive sm:col-span-2 lg:col-span-4">{error}</p> : null}
      {dialog}
    </div>
  );
}

function TeamList({ members, builder, onChanged }: { members: TeamMember[]; builder: boolean; onChanged: () => void }) {
  return (
    <section aria-label="Team list" className="space-y-2">
      <h2 className="text-lg font-semibold">Team list</h2>
      <p className="text-sm text-muted-foreground">
        The old dashboard team list. Owner dropdowns list these people, and Follow-ups finds you here by your login email. The
        dashboard role turns into a Verdanote role through the mapping below. Emails are not edited here.
      </p>
      {members.length === 0 ? <p className="text-sm text-muted-foreground">Nobody is on the team list.</p> : null}
      <ul className="space-y-2">
        {sortTeam(members).map((m) => (
          <li key={m.id} className="rounded border border-input p-3 text-sm" data-testid="team-member">
            <span className="font-medium">{m.name}</span> <span className="text-muted-foreground">{m.email}</span> · {roleLabel(m.role)}
            {m.active ? "" : " · Deactivated"}
            {builder ? (
              <details>
                <summary className="cursor-pointer text-[12px] text-muted-foreground">Edit</summary>
                <MemberEditor member={m} onChanged={onChanged} />
              </details>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function MappingRow({ mapping, builder, onChanged }: { mapping: RoleMapping; builder: boolean; onChanged: () => void }) {
  const [form, setForm] = useState({ dashboardRole: mapping.dashboard_role as string, verdanoteRole: mapping.verdanote_role as string, note: mapping.note });
  const [error, setError] = useState<string | null>(null);
  const problem = mappingFormProblem(form);
  const save = async () => {
    setError(null);
    const { error: e } = await db.rpc("set_staff_role_mapping", {
      p_dashboard_role: mapping.dashboard_role,
      p_verdanote_role: form.verdanoteRole,
      p_note: form.note.trim(),
    });
    if (e) return setError(errorText(e));
    onChanged();
  };
  return (
    <TableRow className="align-top" data-testid="mapping-row">
      <TableCell>{roleLabel(mapping.dashboard_role)}</TableCell>
      <TableCell>{roleLabel(mapping.verdanote_role)}</TableCell>
      <TableCell>Applied</TableCell>
      <TableCell>
        {mapping.note}
        {builder ? (
          <details>
            <summary className="cursor-pointer text-[12px] text-muted-foreground">Change</summary>
            <div role="group" aria-label={`Change the ${mapping.dashboard_role} mapping`} className="mt-2 space-y-2">
              <SelectField label="Verdanote role" hideLabel value={form.verdanoteRole} onChange={(e) => setForm({ ...form, verdanoteRole: e.target.value })} options={(mapping.dashboard_role === "viewer" ? ["client"] : [...STAFF_ROLES]).map((r) => ({ value: r, label: roleLabel(r) }))} />
              <TextareaField label="Mapping note" hideLabel value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              <Button size="sm" disabled={!!problem} onClick={() => void save()}>Save mapping</Button>
              {problem ? <p className="text-[12px] text-muted-foreground">{problem}</p> : null}
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            </div>
          </details>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

function Mappings({ mappings, builder, onChanged }: { mappings: RoleMapping[]; builder: boolean; onChanged: () => void }) {
  return (
    <section aria-label="Role mapping" className="space-y-2">
      <h2 className="text-lg font-semibold">Role mapping</h2>
      <p className="text-sm text-muted-foreground">
        How a dashboard role becomes a Verdanote role. There are two kinds of people: anyone who works at Goodo Studios is an
        employee (producer, editor and any other staff role), and anyone who is a client is the viewer, which is the client role.
        Admin stays builder.
      </p>
      <Table aria-label="Role mapping table" className="min-w-[40rem]">
        <TableHeader>
          <TableRow>
            <TableHead>Dashboard role</TableHead><TableHead>Verdanote role</TableHead><TableHead>Status</TableHead><TableHead>Note</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mappings.map((m) => <MappingRow key={`${m.dashboard_role}:${m.updated_at}`} mapping={m} builder={builder} onChanged={onChanged} />)}
        </TableBody>
      </Table>
    </section>
  );
}

function InviteRow({ invite, onChanged, onSend }: { invite: StaffInvite; onChanged: () => void; onSend: (invite: StaffInvite) => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const problem = cancelReasonProblem(reason);
  const cancel = async () => {
    setError(null);
    const { error: e } = await db.rpc("cancel_staff_invite", { p_invite_id: invite.id, p_reason: reason.trim() });
    if (e) return setError(errorText(e));
    onChanged();
  };
  return (
    <li className="rounded border border-input p-3 text-sm" data-testid="invite-row">
      <span className="font-medium">{invite.name}</span> <span className="text-muted-foreground">{invite.email}</span> · as {roleLabel(invite.proposed_role)}
 · {invite.status === "prepared" ? "Prepared, not sent" : `Cancelled: ${invite.cancel_reason ?? ""}`}
      {invite.status === "prepared" ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onSend(invite)} aria-label={`Send the invite to ${invite.name}`}>Send invite by email</Button>
          <TextField label={`Reason to cancel the invite for ${invite.name}`} hideLabel placeholder="Reason to cancel" value={reason} onChange={(e) => setReason(e.target.value)} className="min-w-[12rem] flex-1" />
          <Button size="sm" variant="outline" disabled={!!problem} onClick={() => void cancel()}>Cancel invite</Button>
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-1 text-destructive">{error}</p> : null}
    </li>
  );
}

export default function TeamPage() {
  const { isBuilder } = useAuth();
  const { isClientPreview, isEmployeePreview } = useClientPreview();
  const builder = isBuilder && !isClientPreview && !isEmployeePreview;
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [mappings, setMappings] = useState<RoleMapping[]>([]);
  const [recon, setRecon] = useState<ReconRow[] | null>(null);
  const [invites, setInvites] = useState<StaffInvite[]>([]);
  const [events, setEvents] = useState<StaffEvent[]>([]);
  const [prefill, setPrefill] = useState<InvitePrefill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    const [team, map] = await Promise.all([
      db.from("app_users").select(TEAM_SELECT).order("name"),
      db.from("staff_role_mappings").select(MAPPING_SELECT).order("dashboard_role"),
    ]);
    if (team.error || map.error) {
      setError("The team list could not load.");
      setLoadFailed(true);
      setMembers([]);
      return;
    }
    setError(null);
    setLoadFailed(false);
    setMembers((team.data ?? []) as TeamMember[]);
    setMappings((map.data ?? []) as RoleMapping[]);
    if (!builder) return;
    const [r, inv, ev] = await Promise.all([
      db.rpc("staff_reconciliation"),
      db.from("staff_invites").select(INVITE_SELECT).order("prepared_at", { ascending: false }).limit(200),
      db.from("staff_admin_events").select(EVENT_SELECT).order("created_at", { ascending: false }).limit(20),
    ]);
    if (r.error) setError(`The staff list check could not load: ${errorText(r.error)}`);
    setRecon(((r.data ?? []) as ReconRow[]).map((row) => ({ ...row, issues: row.issues ?? [], staff_roles: row.staff_roles ?? [] })));
    setInvites((inv.data ?? []) as StaffInvite[]);
    setEvents((ev.data ?? []) as StaffEvent[]);
  }, [builder]);
  useEffect(() => void load(), [load]);

  const reload = () => void load();
  const openInvite = (i: StaffInvite) => setPrefill({ preparedId: i.id, name: i.name, email: i.email, role: i.proposed_role });
  // A prepared invite that was sent by email is closed, so the list does not offer to send it twice.
  const invitedByEmail = async (preparedId: string | null) => {
    if (preparedId) await db.rpc("cancel_staff_invite", { p_invite_id: preparedId, p_reason: "Sent by email" });
    reload();
  };

  return (
    <PageShell className="space-y-6" data-testid="team-page">
      <PageHeader
        title="Team and settings"
        description="One place to manage staff: the team list, the role mapping, the check of the team list against Verdanote logins and roles, and invites by email. Linking a client login to its client is on the client's Setup tab."
      />
      {error ? (loadFailed ? <ErrorState message={error} onRetry={reload} /> : <p role="alert" className="text-sm text-destructive">{error}</p>) : null}
      {members === null ? <LoadingState label="Loading the team" /> : null}
      {builder ? null : (
        <p className="rounded border border-input bg-muted/40 p-3 text-sm">
          Builders change the team list, the role mapping and staff roles here. You can see the team list and the mapping.
        </p>
      )}
      {builder && recon ? <Reconciliation rows={recon} onChanged={reload} /> : null}
      {members ? <TeamList members={members} builder={builder} onChanged={reload} /> : null}
      <Mappings mappings={mappings} builder={builder} onChanged={reload} />
      <ClientsSettings builder={builder} />
      {builder ? <InviteSection prefill={prefill} onSent={(id) => void invitedByEmail(id)} /> : null}
      {builder ? <ClientInvitesSection /> : null}
      {builder ? (
        <section aria-label="Invites" className="space-y-2">
          <h2 className="text-lg font-semibold">Prepared invites</h2>
          <p className="rounded border border-input bg-muted/40 p-3 text-sm">{NO_SEND_NOTE}</p>
          {invites.length === 0 ? <p className="text-sm text-muted-foreground">No invites prepared.</p> : null}
          <ul className="space-y-2">{invites.map((i) => <InviteRow key={`${i.id}:${i.status}`} invite={i} onChanged={reload} onSend={openInvite} />)}</ul>
        </section>
      ) : null}
      {builder ? (
        <section aria-label="Recent changes" className="space-y-1">
          <h2 className="text-lg font-semibold">Recent changes</h2>
          {events.length === 0 ? <p className="text-sm text-muted-foreground">No changes recorded yet.</p> : null}
          <ul className="text-[13px]">
            {events.map((e) => (
              <li key={e.id}>{fmtDateTime(e.created_at)}: {EVENT_LABEL[e.kind] ?? e.kind}, {e.subject}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </PageShell>
  );
}
