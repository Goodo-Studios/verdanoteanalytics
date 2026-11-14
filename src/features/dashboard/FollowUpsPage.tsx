// Follow-ups: staff page (consolidation step 5a, port of the old dashboard's
// Follow-ups). The chase queue of creator assignments: overdue and due today,
// plus what is coming up. Staff snooze a follow-up by one or three days, move
// it to another date or clear it, and change the owner. An employee sees their
// own follow-ups; a builder starts on theirs and can switch to anyone. The
// signed-in person is matched to the dashboard team list (app_users) by email.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState, PageHeader, PageShell, SelectField, TextField } from "@/components/page-kit";
import { useAuth } from "@/contexts/AuthContext";
import { useRolePrefix } from "@/hooks/useRolePath";
import { DashboardError, loadBrandsAndTeam, loadFollowUps, updateAssignment, type AssignmentPatch, type BrandOption } from "./api";
import {
  creatorName,
  currentAppUser,
  daysOverdue,
  errorText,
  filterByOwner,
  formatDay,
  formatOverdue,
  groupFollowUps,
  ownerName,
  ownerOptions,
  ownerScope,
  snoozeDate,
  stageLabel,
  todayValue,
  type AppUser,
  type Assignment,
} from "./model";

function Row({ a, today, users, brand, prefix, onPatch }: {
  a: Assignment;
  today: string;
  users: AppUser[];
  brand: string;
  prefix: string;
  onPatch: (a: Assignment, p: AssignmentPatch) => void;
}) {
  const name = creatorName(a);
  const late = a.next_follow_up_at && a.next_follow_up_at <= today ? daysOverdue(a.next_follow_up_at, today) : null;
  return (
    <li className="flex flex-wrap items-center gap-2 border-t py-2 text-sm" data-testid={`follow-up-${a.id}`}>
      <div className="min-w-[12rem] flex-1">
        <div className="font-medium">{name}</div>
        <div className="text-xs text-muted-foreground">
          <Link to={`${prefix}/creator-pipeline?brand=${encodeURIComponent(a.client_slug)}`} className="underline">{brand}</Link> · {stageLabel(a.stage)}
          {late !== null ? ` · ${formatOverdue(late)}` : ` · ${formatDay(a.next_follow_up_at)}`}
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => onPatch(a, { next_follow_up_at: snoozeDate(today, 1) })}>Snooze 1 day</Button>
      <Button type="button" variant="outline" size="sm" onClick={() => onPatch(a, { next_follow_up_at: snoozeDate(today, 3) })}>Snooze 3 days</Button>
      <TextField label={`Follow-up date for ${name}`} hideLabel type="date" className="w-40" value={a.next_follow_up_at ?? ""} onChange={(e) => onPatch(a, { next_follow_up_at: e.target.value || null })} />
      <Button type="button" variant="outline" size="sm" onClick={() => onPatch(a, { next_follow_up_at: null })}>Clear</Button>
      <SelectField
        label={`Owner for ${name}`}
        hideLabel
        className="w-44"
        value={a.owner_id ?? ""}
        onChange={(e) => onPatch(a, { owner_id: e.target.value || null })}
        placeholder="No owner"
        options={ownerOptions(users, a.owner_id).map((u) => ({ value: u.id, label: `${u.name}${u.active ? "" : " (inactive)"}` }))}
      />
    </li>
  );
}

export default function FollowUpsPage() {
  const prefix = useRolePrefix();
  const { user, isBuilder } = useAuth();
  const [today] = useState(() => todayValue(new Date()));
  const [rows, setRows] = useState<Assignment[] | null>(null);
  const [base, setBase] = useState<{ brands: BrandOption[]; users: AppUser[] } | null>(null);
  const [override, setOverride] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, b] = await Promise.all([loadFollowUps(), loadBrandsAndTeam()]);
      setRows(r);
      setBase(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load follow-ups.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const users = useMemo(() => base?.users ?? [], [base]);
  const brandNames = useMemo(() => new Map((base?.brands ?? []).map((b) => [b.slug, b.name])), [base]);
  const me = currentAppUser(users, user?.email);
  const { owner, canPick } = ownerScope(me, isBuilder, override);
  const groups = useMemo(() => groupFollowUps(filterByOwner(rows ?? [], owner), today), [rows, owner, today]);

  const patch = async (a: Assignment, p: AssignmentPatch) => {
    setError(null);
    setNotice(null);
    try {
      await updateAssignment(a.id, p);
      setNotice(`${creatorName(a)} updated.`);
    } catch (e) {
      setError(e instanceof DashboardError ? errorText(e.code, e.message) : "The change could not be saved.");
    }
    await load();
  };
  const list = (items: Assignment[], label: string, empty: string) => (
    <section aria-label={label} className="rounded-lg border p-3">
      <h2 className="text-sm font-semibold">{label} ({items.length})</h2>
      {items.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">{empty}</p> : (
        <ul className="mt-1">
          {items.map((a) => <Row key={a.id} a={a} today={today} users={users} brand={brandNames.get(a.client_slug) ?? a.client_slug} prefix={prefix} onPatch={(x, p) => void patch(x, p)} />)}
        </ul>
      )}
    </section>
  );

  return (
    <PageShell data-testid="follow-ups-page">
      <PageHeader title="Follow-ups" description="Creators to chase today, oldest first." />
      {rows && base && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {canPick ? (
            <SelectField
              label="Whose follow-ups"
              hideLabel
              className="w-56"
              value={owner}
              onChange={(e) => setOverride(e.target.value)}
              options={[{ value: "all", label: "All owners" }, ...users.filter((u) => u.active || u.id === owner).map((u) => ({ value: u.id, label: u.id === me?.id ? `${u.name} (you)` : u.name }))]}
            />
          ) : (
            <span className="text-muted-foreground">Showing your follow-ups ({ownerName(users, owner)}).</span>
          )}
          {!me && <span className="text-xs text-muted-foreground">Your login is not on the dashboard team list, so every owner is shown.</span>}
        </div>
      )}
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {error && (!rows || !base ? <ErrorState message={error} onRetry={() => { setError(null); void load(); }} /> : <p role="alert" className="text-sm text-destructive">{error}</p>)}
      {!rows || !base ? (
        error ? null : <LoadingState label="Loading follow-ups" />
      ) : (
        <>
          {list(groups.overdue, "Overdue", "Nothing overdue.")}
          {list(groups.dueToday, "Due today", "Nothing due today.")}
          {list(groups.upcoming, "Coming up", "No later follow-ups set.")}
        </>
      )}
    </PageShell>
  );
}
