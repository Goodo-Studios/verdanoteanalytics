// Props: staff page (consolidation step 5c, port of the old dashboard's /props
// page). What was bought or borrowed for a shoot, what it cost, the client it
// was for, its bin, whether it is still at the studio and what happened to it
// after the shoot. Search and filters, add and edit, quick changes in the row
// (at studio, client supplied, outcome) and delete after a confirm, all
// through the checked prop functions.
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
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

const CTRL = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

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

function PropEditor({ initial, title, busy, onSave, onCancel }: { initial: PropForm; title: string; busy: boolean; onSave: (f: PropForm) => void; onCancel: () => void }) {
  const [form, setForm] = useState(initial);
  const set = (patch: Partial<PropForm>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <form aria-label={title} className="space-y-2 rounded-lg border p-3" onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="grid gap-2 sm:grid-cols-3">
        {FIELDS.map((f) => (
          <label key={f.key} className="text-xs">
            {f.label}
            <input aria-label={f.label} className={`${CTRL} mt-0.5 w-full`} value={form[f.key]} onChange={(e) => set({ [f.key]: e.target.value } as Partial<PropForm>)} />
          </label>
        ))}
        <label className="text-xs">
          Outcome
          <select aria-label="Outcome" className={`${CTRL} mt-0.5 w-full`} value={form.return_status} onChange={(e) => set({ return_status: e.target.value as PropForm["return_status"] })}>
            <option value="">Not decided</option>
            {RETURN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <div className="flex items-end gap-3 text-sm">
          <label><input type="checkbox" checked={form.at_studio} onChange={(e) => set({ at_studio: e.target.checked })} /> At the studio</label>
          <label><input type="checkbox" checked={form.client_supplied} onChange={(e) => set({ client_supplied: e.target.checked })} /> Client supplied</label>
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" className={CTRL} disabled={busy}>{busy ? "Saving..." : "Save"}</button>
        <button type="button" className={CTRL} onClick={onCancel}>Cancel</button>
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
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProps(await loadProps());
    } catch (e) {
      setError(messageOf(e, "Could not load props."));
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

  const remove = (p: Prop) => {
    if (!window.confirm(`Delete ${p.name}? This cannot be undone.`)) return;
    void run(async () => {
      await deleteProp(p.id);
      return `Deleted ${p.name}.`;
    });
  };

  return (
    <div className="p-6 space-y-4" data-testid="props-page">
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
        <button type="button" className={CTRL} onClick={() => { setEditing("new"); setError(null); setNotice(null); }}>Add prop</button>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Search props" placeholder="Search name, store, client, bin" className={`${CTRL} min-w-[16rem]`} value={filters.search} onChange={(e) => set({ search: e.target.value })} />
        <select aria-label="Store" className={CTRL} value={filters.store} onChange={(e) => set({ store: e.target.value })}>
          <option value="">Any store</option>
          {stores.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Client filter" className={CTRL} value={filters.client} onChange={(e) => set({ client: e.target.value })}>
          <option value="">Any client</option>
          {clients.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select aria-label="Outcome filter" className={CTRL} value={filters.status} onChange={(e) => set({ status: e.target.value as PropFilters["status"] })}>
          <option value="">Outcome: any</option>
          <option value="open">Outcome: not decided</option>
          {RETURN_STATUSES.map((s) => <option key={s} value={s}>Outcome: {s}</option>)}
        </select>
        <select aria-label="Where" className={CTRL} value={filters.where} onChange={(e) => set({ where: e.target.value as PropFilters["where"] })}>
          <option value="">Anywhere</option>
          <option value="studio">At the studio</option>
          <option value="away">Not at the studio</option>
        </select>
      </div>

      {!props ? (
        error ? null : <p role="status" className="text-sm text-muted-foreground">Loading props...</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="props-count">
            {shown.length === all.length ? `${all.length} props` : `${shown.length} of ${all.length} props`} · {formatPrice(spentTotal(shown))} spent, not counting client supplied
          </p>
          {shown.length === 0 ? <p className="text-sm text-muted-foreground">No props match these filters.</p> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground"><th>Prop</th><th>Store</th><th>Price</th><th>Client</th><th>Bin</th><th>At studio</th><th>Client supplied</th><th>Outcome</th><th /></tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} className="border-t align-top" data-testid={`prop-row-${p.id}`}>
                    <td className="py-1.5">
                      <div className="font-medium">{p.name}</div>
                      {p.notes && <div className="text-xs text-muted-foreground">{p.notes}</div>}
                    </td>
                    <td className="text-xs">{p.store ?? ""}</td>
                    <td className="text-xs">{formatPrice(p.price)}</td>
                    <td className="text-xs">{p.client ?? ""}</td>
                    <td className="text-xs">{p.bin_number ?? ""}</td>
                    <td><input type="checkbox" aria-label={`${p.name} at the studio`} checked={p.at_studio} disabled={busy} onChange={(e) => { const v = e.target.checked; void run(async () => { await setAtStudio(p.id, v); return `${p.name}: ${v ? "at the studio" : "not at the studio"}.`; }); }} /></td>
                    <td><input type="checkbox" aria-label={`${p.name} client supplied`} checked={p.client_supplied} disabled={busy} onChange={(e) => { const v = e.target.checked; void run(async () => { await setClientSupplied(p.id, v); return `${p.name}: ${v ? "client supplied" : "bought by Goodo"}.`; }); }} /></td>
                    <td>
                      <select aria-label={`${p.name} outcome`} className={CTRL} value={p.return_status ?? ""} disabled={busy} onChange={(e) => { const v = (e.target.value || null) as ReturnStatus | null; void run(async () => { await setReturnStatus(p.id, v); return `${p.name}: ${v ?? "not decided"}.`; }); }}>
                        <option value="">Not decided</option>
                        {RETURN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="space-x-2 text-xs">
                      <button type="button" className="underline" onClick={() => { setEditing(p); setError(null); setNotice(null); }}>Edit</button>
                      <button type="button" className="underline" disabled={busy} onClick={() => remove(p)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
