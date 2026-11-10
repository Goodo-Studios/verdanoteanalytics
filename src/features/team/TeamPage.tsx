// Team and settings: staff page (consolidation step 5d, the old dashboard Settings team half,
// merged with Verdanote's user management). One place to manage staff: the team list
// (app_users), the role mapping as data, the reconciliation of the team list with Verdanote
// logins and roles, prepared invites and the record of changes. Every write goes through a
// checked database function (migration 20261111040001). Employees see the team list and the
// mapping; the reconciliation, invites, edits and the record are builder only. Client logins
// and their ad accounts stay in Settings > Admin. Nothing here sends an invite or an email.
// The old Settings "Active clients" half is the Clients section (ClientsSettings.tsx).
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClientPreview } from "@/hooks/useClientPreviewMode";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { ClientsSettings } from "./ClientsSettings";
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
const field = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

function PersonRow({ row, onChanged }: { row: ReconRow; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const role = roleActionFor(row);
  const proposal = proposedChange(row);
  const name = row.team_name ?? row.login_name ?? row.email;

  const act = async (fn: string, args: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
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
          {row.mapped_role ? ` · Mapped: ${roleLabel(row.mapped_role)}${row.mapping_flagged ? " (waits on the owner)" : ""}` : ""}
        </div>
      </div>
      {row.issues.length ? (
        <ul className="mt-1 list-disc pl-5">
          {row.issues.map((i) => (
            <li key={i}>
              <span className="font-medium">{ISSUE_INFO[i]?.label ?? i}.</span> {ISSUE_INFO[i]?.effect}
              {i === "possible_name_match" && row.possible_match ? ` Possible match: ${row.possible_match}.` : ""}
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
            onClick={() => void act("add_login_to_team_list", { p_user_id: row.user_id, p_name: row.login_name }, `Add ${name} to the team list?`)}>
            Add to team list
          </Button>
        ) : null}
        {role ? (
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => void act("set_staff_role", { p_user_id: row.user_id, p_role: role }, `Set ${name}'s Verdanote role to ${roleLabel(role)}? This changes what they can open.`)}>
            Set role to {roleLabel(role)}
          </Button>
        ) : null}
      </div>
      {error ? <p role="alert" className="mt-1 text-red-700">{error}</p> : null}
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
  const changed = form.name.trim() !== member.name || form.role !== member.role || form.active !== member.active;
  const save = async () => {
    if (form.active !== member.active && !form.active && !window.confirm(`Deactivate ${member.name} on the team list? Their Verdanote login is not changed.`)) return;
    setError(null);
    const { error: e } = await db.rpc("update_team_member", { p_team_member_id: member.id, p_name: form.name.trim(), p_dashboard_role: form.role, p_active: form.active });
    if (e) return setError(errorText(e));
    onChanged();
  };
  return (
    <div role="group" aria-label={`Edit ${member.name}`} className="mt-2 grid gap-2 sm:grid-cols-4">
      <input aria-label="Name" className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <select aria-label="Dashboard role" className={field} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
        {DASHBOARD_ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
      </select>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active
      </label>
      <Button size="sm" disabled={!!problem || !changed} onClick={() => void save()}>Save</Button>
      {problem ? <p className="text-[12px] text-muted-foreground sm:col-span-4">{problem}</p> : null}
      {error ? <p role="alert" className="text-sm text-red-700 sm:col-span-4">{error}</p> : null}
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
  const [form, setForm] = useState({ verdanoteRole: mapping.verdanote_role as string, needsOwnerDecision: mapping.needs_owner_decision, note: mapping.note });
  const [error, setError] = useState<string | null>(null);
  const problem = mappingFormProblem(form);
  const save = async () => {
    const decides = mapping.needs_owner_decision && !form.needsOwnerDecision;
    if (decides && !window.confirm(`Clear the owner flag on ${mapping.dashboard_role}? From then on ${mapping.dashboard_role} becomes ${form.verdanoteRole} when roles are applied. Only do this with the owner's decision.`)) return;
    setError(null);
    const { error: e } = await db.rpc("set_staff_role_mapping", {
      p_dashboard_role: mapping.dashboard_role,
      p_verdanote_role: form.verdanoteRole,
      p_needs_owner_decision: form.needsOwnerDecision,
      p_note: form.note.trim(),
    });
    if (e) return setError(errorText(e));
    onChanged();
  };
  return (
    <tr className="border-t border-input align-top" data-testid="mapping-row">
      <td className="py-2 pr-2">{roleLabel(mapping.dashboard_role)}</td>
      <td className="py-2 pr-2">{roleLabel(mapping.verdanote_role)}</td>
      <td className="py-2 pr-2">{mapping.needs_owner_decision ? <span className="font-medium text-amber-800">Waits on the owner (not applied)</span> : "Applied"}</td>
      <td className="py-2">
        {mapping.note}
        {builder ? (
          <details>
            <summary className="cursor-pointer text-[12px] text-muted-foreground">Change</summary>
            <div role="group" aria-label={`Change the ${mapping.dashboard_role} mapping`} className="mt-2 space-y-2">
              <select aria-label="Verdanote role" className={field} value={form.verdanoteRole} onChange={(e) => setForm({ ...form, verdanoteRole: e.target.value })}>
                {STAFF_ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.needsOwnerDecision} onChange={(e) => setForm({ ...form, needsOwnerDecision: e.target.checked })} /> Still waits on the owner
              </label>
              <textarea aria-label="Mapping note" className={field} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              <Button size="sm" disabled={!!problem} onClick={() => void save()}>Save mapping</Button>
              {problem ? <p className="text-[12px] text-muted-foreground">{problem}</p> : null}
              {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
            </div>
          </details>
        ) : null}
      </td>
    </tr>
  );
}

function Mappings({ mappings, builder, onChanged }: { mappings: RoleMapping[]; builder: boolean; onChanged: () => void }) {
  return (
    <section aria-label="Role mapping" className="space-y-2">
      <h2 className="text-lg font-semibold">Role mapping</h2>
      <p className="text-sm text-muted-foreground">
        How a dashboard role becomes a Verdanote role. This is the owner's open decision on roles: until it is made, admin becomes
        builder, producer becomes employee, and viewer is proposed as employee but never applied.
      </p>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-[12px] uppercase text-muted-foreground">
            <th className="pr-2">Dashboard role</th><th className="pr-2">Verdanote role</th><th className="pr-2">Status</th><th>Note</th>
          </tr>
        </thead>
        <tbody>
          {mappings.map((m) => <MappingRow key={`${m.dashboard_role}:${m.updated_at}`} mapping={m} builder={builder} onChanged={onChanged} />)}
        </tbody>
      </table>
    </section>
  );
}

function InviteRow({ invite, onChanged }: { invite: StaffInvite; onChanged: () => void }) {
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
      {invite.mapping_flagged ? " (mapping waits on the owner)" : ""} · {invite.status === "prepared" ? "Prepared, not sent" : `Cancelled: ${invite.cancel_reason ?? ""}`}
      {invite.status === "prepared" ? (
        <div className="mt-2 flex gap-2">
          <input aria-label={`Reason to cancel the invite for ${invite.name}`} className={field} placeholder="Reason to cancel" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="sm" variant="outline" disabled={!!problem} onClick={() => void cancel()}>Cancel invite</Button>
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-1 text-red-700">{error}</p> : null}
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
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [team, map] = await Promise.all([
      db.from("app_users").select(TEAM_SELECT).order("name"),
      db.from("staff_role_mappings").select(MAPPING_SELECT).order("dashboard_role"),
    ]);
    if (team.error || map.error) {
      setError("The team list could not load.");
      setMembers([]);
      return;
    }
    setError(null);
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

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6" data-testid="team-page">
      <PageHeader
        title="Team and settings"
        description="One place to manage staff: the team list, the role mapping, the check of the team list against Verdanote logins and roles, and prepared invites. Client logins and their ad accounts stay in Settings > Admin."
      />
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {builder ? null : (
        <p className="rounded border border-input bg-muted/40 p-3 text-sm">
          Builders change the team list, the role mapping and staff roles here. You can see the team list and the mapping.
        </p>
      )}
      {builder && recon ? <Reconciliation rows={recon} onChanged={reload} /> : null}
      {members ? <TeamList members={members} builder={builder} onChanged={reload} /> : null}
      <Mappings mappings={mappings} builder={builder} onChanged={reload} />
      <ClientsSettings builder={builder} />
      {builder ? (
        <section aria-label="Invites" className="space-y-2">
          <h2 className="text-lg font-semibold">Invites</h2>
          <p className="rounded border border-input bg-muted/40 p-3 text-sm">{NO_SEND_NOTE}</p>
          {invites.length === 0 ? <p className="text-sm text-muted-foreground">No invites prepared.</p> : null}
          <ul className="space-y-2">{invites.map((i) => <InviteRow key={`${i.id}:${i.status}`} invite={i} onChanged={reload} />)}</ul>
        </section>
      ) : null}
      {builder ? (
        <section aria-label="Recent changes" className="space-y-1">
          <h2 className="text-lg font-semibold">Recent changes</h2>
          {events.length === 0 ? <p className="text-sm text-muted-foreground">No changes recorded yet.</p> : null}
          <ul className="text-[13px]">
            {events.map((e) => (
              <li key={e.id}>{new Date(e.created_at).toLocaleString()}: {EVENT_LABEL[e.kind] ?? e.kind}, {e.subject}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
