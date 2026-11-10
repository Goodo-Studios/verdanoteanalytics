// Crew: staff page (consolidation step 5c, port of the old dashboard's /crew
// page). The people Goodo books for shoots, with role, rate notes, phone and
// email. Search, role filter and sort, add and edit, archive and restore, all
// through the checked crew functions. Each row shows how many call sheets the
// person is on; call sheets themselves are on the Call sheets page.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingState,
  PageHeader,
  PageShell,
  SelectField,
  TextField,
  useConfirm,
  type DataColumn,
} from "@/components/page-kit";
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
          <TextField
            key={f.key}
            label={f.label}
            type={f.type ?? "text"}
            list={f.key === "role" ? "crew-role-suggestions" : undefined}
            value={form[f.key]}
            onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))}
          />
        ))}
        <datalist id="crew-role-suggestions">{SUGGESTED_CREW_ROLES.map((r) => <option key={r} value={r} />)}</datalist>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy ? "Saving..." : "Save"}</Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(async () => {
    try {
      setData(await loadCrew());
      setLoadError(null);
    } catch (e) {
      setLoadError(messageOf(e, "Could not load crew."));
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

  const toggleActive = async (c: CrewMember) => {
    if (c.active && !(await confirm({ title: `Archive ${c.name}?`, description: `${c.name} stays on past call sheets but is not offered for new ones.`, actionLabel: "Archive" }))) return;
    void run(async () => {
      await setCrewActive(c.id, !c.active);
      return c.active ? `Archived ${c.name}.` : `Restored ${c.name}.`;
    });
  };

  const columns: DataColumn<CrewMember>[] = [
    {
      key: "name",
      header: "Name",
      cell: (c) => (
        <>
          <div className="font-medium">{c.name}</div>
          {!c.active && <span className="rounded bg-muted px-1 text-xs">Archived</span>}
          {c.notes && <div className="text-xs text-muted-foreground">{c.notes}</div>}
        </>
      ),
    },
    { key: "role", header: "Role", cell: (c) => c.role },
    {
      key: "phone",
      header: "Phone",
      cell: (c) => { const tel = telHref(c.phone); return tel ? <a href={tel} className="underline">{c.phone}</a> : c.phone ?? ""; },
    },
    {
      key: "email",
      header: "Email",
      cell: (c) => { const mail = mailHref(c.email); return mail ? <a href={mail} className="underline">{c.email}</a> : c.email ?? ""; },
    },
    { key: "rate", header: "Rate notes", cell: (c) => c.rate_notes ?? "" },
    { key: "sheets", header: "Call sheets", cell: (c) => data?.sheets.get(c.id) ?? 0 },
    {
      key: "actions",
      header: "Actions",
      srOnlyHeader: true,
      cell: (c) => (
        <div className="flex gap-1">
          <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => { setEditing(c); setError(null); setNotice(null); }}>Edit</Button>
          <Button type="button" variant="link" size="sm" className="h-auto p-0" disabled={busy} onClick={() => void toggleActive(c)}>{c.active ? "Archive" : "Restore"}</Button>
        </div>
      ),
    },
  ];

  return (
    <PageShell wide data-testid="crew-page">
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
        <Button type="button" size="sm" variant="outline" onClick={() => { setEditing("new"); setError(null); setNotice(null); }}>Add crew member</Button>
      )}

      <FilterBar search={{ value: filters.search, onChange: (v) => set({ search: v }), label: "Search crew", placeholder: "Search name, role, phone, email, notes" }}>
        <SelectField label="Role filter" hideLabel value={filters.role} onChange={(e) => set({ role: e.target.value })} placeholder="Any role" options={roles.map((r) => ({ value: r, label: r }))} />
        <SelectField label="Sort" hideLabel value={filters.sort} onChange={(e) => set({ sort: e.target.value as CrewFilters["sort"] })} options={[{ value: "name", label: "Name" }, { value: "role", label: "Role" }]} />
        <label className="flex items-center gap-1 pb-2 text-sm"><input type="checkbox" checked={filters.showArchived} onChange={(e) => set({ showArchived: e.target.checked })} /> Show archived</label>
      </FilterBar>

      {loadError ? (
        <ErrorState message={loadError} onRetry={() => void load()} />
      ) : !data ? (
        <LoadingState label="Loading crew" />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="crew-count">
            {shown.length} shown · {activeCount} active, {crew.length - activeCount} archived
          </p>
          {shown.length === 0 ? (
            <EmptyState title="No crew match these filters." />
          ) : (
            <DataTable label="Crew" columns={columns} rows={shown} rowKey={(c) => c.id} rowTestId={(c) => `crew-row-${c.id}`} />
          )}
        </>
      )}
      {dialog}
    </PageShell>
  );
}
