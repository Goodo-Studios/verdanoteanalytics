// Crew: staff page (consolidation step 5c, port of the old dashboard's /crew
// page). The people Goodo books for shoots, with role, rate notes, phone and
// email. Search, role filter and sort, add and edit, archive and restore, all
// through the checked crew functions. Each row shows how many call sheets the
// person is on; call sheets themselves are on the Call sheets page.
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { DashboardError } from "./api";
import { createCrewMember, loadCrew, setCrewActive, updateCrewMember, type CrewData } from "./crewApi";
import {
  DEFAULT_CREW_FILTERS,
  EMPTY_CREW_FORM,
  SUGGESTED_CREW_ROLES,
  crewToForm,
  filterCrew,
  formToCrewArgs,
  mailHref,
  roleOptions,
  telHref,
  type CrewFilters,
  type CrewForm,
  type CrewMember,
} from "./crewModel";
import { errorText } from "./model";

const CTRL = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof DashboardError) return e.code === "P0002" ? "That crew member no longer exists." : errorText(e.code, e.message || fallback);
  return e instanceof Error ? e.message : fallback;
}

const FIELDS: { key: keyof CrewForm; label: string; type?: string }[] = [
  { key: "name", label: "Name" },
  { key: "role", label: "Role" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "email", label: "Email", type: "email" },
  { key: "rate_notes", label: "Rate notes" },
  { key: "notes", label: "Notes" },
];

function CrewEditor({ initial, title, busy, onSave, onCancel }: { initial: CrewForm; title: string; busy: boolean; onSave: (f: CrewForm) => void; onCancel: () => void }) {
  const [form, setForm] = useState(initial);
  return (
    <form aria-label={title} className="space-y-2 rounded-lg border p-3" onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="grid gap-2 sm:grid-cols-3">
        {FIELDS.map((f) => (
          <label key={f.key} className="text-xs">
            {f.label}
            <input aria-label={f.label} type={f.type ?? "text"} list={f.key === "role" ? "crew-role-suggestions" : undefined} className={`${CTRL} mt-0.5 w-full`} value={form[f.key]} onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))} />
          </label>
        ))}
        <datalist id="crew-role-suggestions">{SUGGESTED_CREW_ROLES.map((r) => <option key={r} value={r} />)}</datalist>
      </div>
      <div className="flex gap-2">
        <button type="submit" className={CTRL} disabled={busy}>{busy ? "Saving..." : "Save"}</button>
        <button type="button" className={CTRL} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function CrewPage() {
  const [data, setData] = useState<CrewData | null>(null);
  const [filters, setFilters] = useState<CrewFilters>(DEFAULT_CREW_FILTERS);
  const [editing, setEditing] = useState<CrewMember | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await loadCrew());
    } catch (e) {
      setError(messageOf(e, "Could not load crew."));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const crew = useMemo(() => data?.crew ?? [], [data]);
  const roles = useMemo(() => roleOptions(crew), [crew]);
  const shown = useMemo(() => filterCrew(crew, filters), [crew, filters]);
  const activeCount = crew.filter((c) => c.active).length;
  const set = (patch: Partial<CrewFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const run = async (fn: () => Promise<string>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    let ok = true;
    try {
      setNotice(await fn());
    } catch (e) {
      setError(messageOf(e, "The change could not be saved."));
      ok = false;
    }
    setBusy(false);
    await load();
    return ok;
  };

  const save = (form: CrewForm) => {
    let args;
    try {
      args = formToCrewArgs(form);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check the form.");
      return;
    }
    const target = editing;
    void run(async () => {
      if (target === "new") {
        await createCrewMember(args);
        return `Added ${args.p_name}.`;
      }
      if (target) await updateCrewMember(target.id, args);
      return `Saved ${args.p_name}.`;
    }).then((ok) => { if (ok) setEditing(null); });
  };

  const toggleActive = (c: CrewMember) => {
    if (c.active && !window.confirm(`Archive ${c.name}? They stay on past call sheets but are not offered for new ones.`)) return;
    void run(async () => {
      await setCrewActive(c.id, !c.active);
      return c.active ? `Archived ${c.name}.` : `Restored ${c.name}.`;
    });
  };

  return (
    <div className="p-6 space-y-4" data-testid="crew-page">
      <PageHeader title="Crew" description="The people Goodo books for shoots: role, rates and how to reach them." />
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {editing ? (
        <CrewEditor
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? EMPTY_CREW_FORM : crewToForm(editing)}
          title={editing === "new" ? "Add a crew member" : `Edit ${editing.name}`}
          busy={busy}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button type="button" className={CTRL} onClick={() => { setEditing("new"); setError(null); setNotice(null); }}>Add crew member</button>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Search crew" placeholder="Search name, role, phone, email, notes" className={`${CTRL} min-w-[16rem]`} value={filters.search} onChange={(e) => set({ search: e.target.value })} />
        <select aria-label="Role filter" className={CTRL} value={filters.role} onChange={(e) => set({ role: e.target.value })}>
          <option value="">Any role</option>
          {roles.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select aria-label="Sort" className={CTRL} value={filters.sort} onChange={(e) => set({ sort: e.target.value as CrewFilters["sort"] })}>
          <option value="name">Name</option>
          <option value="role">Role</option>
        </select>
        <label className="text-sm"><input type="checkbox" checked={filters.showArchived} onChange={(e) => set({ showArchived: e.target.checked })} /> Show archived</label>
      </div>

      {!data ? (
        error ? null : <p role="status" className="text-sm text-muted-foreground">Loading crew...</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="crew-count">
            {shown.length} shown · {activeCount} active, {crew.length - activeCount} archived
          </p>
          {shown.length === 0 ? <p className="text-sm text-muted-foreground">No crew match these filters.</p> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground"><th>Name</th><th>Role</th><th>Phone</th><th>Email</th><th>Rate notes</th><th>Call sheets</th><th /></tr>
              </thead>
              <tbody>
                {shown.map((c) => {
                  const tel = telHref(c.phone);
                  const mail = mailHref(c.email);
                  return (
                    <tr key={c.id} className="border-t align-top" data-testid={`crew-row-${c.id}`}>
                      <td className="py-1.5">
                        <div className="font-medium">{c.name}</div>
                        {!c.active && <span className="rounded bg-muted px-1 text-xs">Archived</span>}
                        {c.notes && <div className="text-xs text-muted-foreground">{c.notes}</div>}
                      </td>
                      <td className="text-xs">{c.role}</td>
                      <td className="text-xs">{tel ? <a href={tel} className="underline">{c.phone}</a> : c.phone ?? ""}</td>
                      <td className="text-xs">{mail ? <a href={mail} className="underline">{c.email}</a> : c.email ?? ""}</td>
                      <td className="text-xs">{c.rate_notes ?? ""}</td>
                      <td className="text-xs">{data.sheets.get(c.id) ?? 0}</td>
                      <td className="space-x-2 text-xs">
                        <button type="button" className="underline" onClick={() => { setEditing(c); setError(null); setNotice(null); }}>Edit</button>
                        <button type="button" className="underline" disabled={busy} onClick={() => toggleActive(c)}>{c.active ? "Archive" : "Restore"}</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
