// Props: staff page (consolidation step 5c, port of the old dashboard's /props
// page). What was bought or borrowed for a shoot, what it cost, the client it
// was for, its bin, whether it is still at the studio and what happened to it
// after the shoot. Search and filters, add and edit, quick changes in the row
// (at studio, client supplied, outcome) and delete after a confirm, all
// through the checked prop functions.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DataTable, EmptyState, ErrorState, FilterBar, LoadingState, PageHeader, PageShell, SelectField, TextField, useConfirm, type DataColumn } from "@/components/page-kit";
import { DashboardError } from "./api";
import { createProp, deleteProp, loadProps, setAtStudio, setClientSupplied, setReturnStatus, updateProp } from "./propsApi";
import {
  DEFAULT_PROP_FILTERS,
  EMPTY_PROP_FORM,
  RETURN_STATUSES,
  clientOptions,
  filterProps,
  formToPropArgs,
  formatPrice,
  propToForm,
  spentTotal,
  storeOptions,
  type Prop,
  type PropFilters,
  type PropForm,
  type ReturnStatus,
} from "./propsModel";
import { errorText } from "./model";

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof DashboardError) return e.code === "P0002" ? "That prop no longer exists." : errorText(e.code, e.message || fallback);
  return e instanceof Error ? e.message : fallback;
}

const FIELDS: { key: "name" | "store" | "price" | "client" | "bin_number" | "notes"; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "store", label: "Store" },
  { key: "price", label: "Price" },
  { key: "client", label: "Client" },
  { key: "bin_number", label: "Bin" },
  { key: "notes", label: "Notes" },
];

const outcomeOptions = RETURN_STATUSES.map((s) => ({ value: s, label: s }));

function PropEditor({ initial, title, busy, onSave, onCancel }: { initial: PropForm; title: string; busy: boolean; onSave: (f: PropForm) => void; onCancel: () => void }) {
  const [form, setForm] = useState(initial);
  const set = (patch: Partial<PropForm>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <form aria-label={title} className="space-y-2 rounded-lg border p-3" onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="grid gap-2 sm:grid-cols-3">
        {FIELDS.map((f) => (
          <TextField key={f.key} label={f.label} value={form[f.key]} onChange={(e) => set({ [f.key]: e.target.value } as Partial<PropForm>)} />
        ))}
        <SelectField label="Outcome" value={form.return_status} onChange={(e) => set({ return_status: e.target.value as PropForm["return_status"] })} placeholder="Not decided" options={outcomeOptions} />
        <div className="flex items-end gap-3 text-sm">
          <label><input type="checkbox" checked={form.at_studio} onChange={(e) => set({ at_studio: e.target.checked })} /> At the studio</label>
          <label><input type="checkbox" checked={form.client_supplied} onChange={(e) => set({ client_supplied: e.target.checked })} /> Client supplied</label>
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy ? "Saving..." : "Save"}</Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

export default function PropsPage() {
  const [props, setProps] = useState<Prop[] | null>(null);
  const [filters, setFilters] = useState<PropFilters>(DEFAULT_PROP_FILTERS);
  const [editing, setEditing] = useState<Prop | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(async () => {
    try {
      setProps(await loadProps());
      setLoadError(null);
    } catch (e) {
      setLoadError(messageOf(e, "Could not load props."));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const all = useMemo(() => props ?? [], [props]);
  const stores = useMemo(() => storeOptions(all), [all]);
  const clients = useMemo(() => clientOptions(all), [all]);
  const shown = useMemo(() => filterProps(all, filters), [all, filters]);
  const set = (patch: Partial<PropFilters>) => setFilters((f) => ({ ...f, ...patch }));

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

  const save = (form: PropForm) => {
    let args;
    try {
      args = formToPropArgs(form);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check the form.");
      return;
    }
    const target = editing;
    void run(async () => {
      if (target === "new") {
        await createProp(args);
        return `Added ${args.p_name}.`;
      }
      if (target) await updateProp(target.id, args, target);
      return `Saved ${args.p_name}.`;
    }).then((ok) => { if (ok) setEditing(null); });
  };

  const remove = async (p: Prop) => {
    if (!(await confirm({ title: `Delete ${p.name}?`, description: "This cannot be undone.", actionLabel: "Delete" }))) return;
    void run(async () => {
      await deleteProp(p.id);
      return `Deleted ${p.name}.`;
    });
  };

  const columns: DataColumn<Prop>[] = [
    {
      key: "name",
      header: "Prop",
      cell: (p) => (
        <>
          <div className="font-medium">{p.name}</div>
          {p.notes && <div className="text-xs text-muted-foreground">{p.notes}</div>}
        </>
      ),
    },
    { key: "store", header: "Store", cell: (p) => p.store ?? "" },
    { key: "price", header: "Price", cell: (p) => formatPrice(p.price) },
    { key: "client", header: "Client", cell: (p) => p.client ?? "" },
    { key: "bin", header: "Bin", cell: (p) => p.bin_number ?? "" },
    {
      key: "studio",
      header: "At studio",
      cell: (p) => (
        <input type="checkbox" aria-label={`${p.name} at the studio`} checked={p.at_studio} disabled={busy} onChange={(e) => { const v = e.target.checked; void run(async () => { await setAtStudio(p.id, v); return `${p.name}: ${v ? "at the studio" : "not at the studio"}.`; }); }} />
      ),
    },
    {
      key: "supplied",
      header: "Client supplied",
      cell: (p) => (
        <input type="checkbox" aria-label={`${p.name} client supplied`} checked={p.client_supplied} disabled={busy} onChange={(e) => { const v = e.target.checked; void run(async () => { await setClientSupplied(p.id, v); return `${p.name}: ${v ? "client supplied" : "bought by Goodo"}.`; }); }} />
      ),
    },
    {
      key: "outcome",
      header: "Outcome",
      cell: (p) => (
        <SelectField label={`${p.name} outcome`} hideLabel value={p.return_status ?? ""} disabled={busy} onChange={(e) => { const v = (e.target.value || null) as ReturnStatus | null; void run(async () => { await setReturnStatus(p.id, v); return `${p.name}: ${v ?? "not decided"}.`; }); }} placeholder="Not decided" options={outcomeOptions} />
      ),
    },
    {
      key: "actions",
      header: "Actions",
      srOnlyHeader: true,
      cell: (p) => (
        <div className="flex gap-1">
          <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => { setEditing(p); setError(null); setNotice(null); }}>Edit</Button>
          <Button type="button" variant="link" size="sm" className="h-auto p-0" disabled={busy} onClick={() => void remove(p)}>Delete</Button>
        </div>
      ),
    },
  ];

  return (
    <PageShell wide data-testid="props-page">
      <PageHeader title="Props" description="Everything bought or borrowed for a shoot: what it cost, whose shoot it was for, and whether it is still at the studio." />
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {editing ? (
        <PropEditor
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? EMPTY_PROP_FORM : propToForm(editing)}
          title={editing === "new" ? "Add a prop" : `Edit ${editing.name}`}
          busy={busy}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={() => { setEditing("new"); setError(null); setNotice(null); }}>Add prop</Button>
      )}

      <FilterBar search={{ value: filters.search, onChange: (v) => set({ search: v }), label: "Search props", placeholder: "Search name, store, client, bin" }}>
        <SelectField label="Store" hideLabel value={filters.store} onChange={(e) => set({ store: e.target.value })} placeholder="Any store" options={stores.map((x) => ({ value: x, label: x }))} />
        <SelectField label="Client filter" hideLabel value={filters.client} onChange={(e) => set({ client: e.target.value })} placeholder="Any client" options={clients.map((c) => ({ value: c, label: c }))} />
        <SelectField
          label="Outcome filter"
          hideLabel
          value={filters.status}
          onChange={(e) => set({ status: e.target.value as PropFilters["status"] })}
          placeholder="Outcome: any"
          options={[{ value: "open", label: "Outcome: not decided" }, ...RETURN_STATUSES.map((x) => ({ value: x, label: `Outcome: ${x}` }))]}
        />
        <SelectField label="Where" hideLabel value={filters.where} onChange={(e) => set({ where: e.target.value as PropFilters["where"] })} placeholder="Anywhere" options={[{ value: "studio", label: "At the studio" }, { value: "away", label: "Not at the studio" }]} />
      </FilterBar>

      {loadError ? (
        <ErrorState message={loadError} onRetry={() => void load()} />
      ) : !props ? (
        <LoadingState label="Loading props" />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="props-count">
            {shown.length === all.length ? `${all.length} props` : `${shown.length} of ${all.length} props`} · {formatPrice(spentTotal(shown))} spent, not counting client supplied
          </p>
          {shown.length === 0 ? (
            <EmptyState title="No props match these filters." />
          ) : (
            <DataTable label="Props" columns={columns} rows={shown} rowKey={(p) => p.id} rowTestId={(p) => `prop-row-${p.id}`} />
          )}
        </>
      )}
      {dialog}
    </PageShell>
  );
}
