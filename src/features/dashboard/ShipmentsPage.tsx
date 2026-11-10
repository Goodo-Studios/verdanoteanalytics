// Shipments: staff page (consolidation step 5c, port of the old dashboard's
// /shipments package tracker). Two lanes, shown apart: product going out to
// creators (tracking, delivered date and notes on the creator's brand row,
// with footage due FOOTAGE_DUE_DAYS after delivery) and product coming in to
// the studio for a shoot. Stuck and footage-overdue rows sort first. Tracking
// numbers link to the carrier's public page; nothing calls a carrier.
// Not ported: the calendar view of expected and delivered dates.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { useRolePrefix } from "@/hooks/useRolePath";
import { DashboardError, loadBrandsAndTeam, type BrandOption } from "./api";
import {
  createStudioShipment,
  deleteStudioShipment,
  loadShipments,
  saveCreatorDelivery,
  setStudioDelivered,
  setStudioNotes,
  updateStudioShipment,
  type ShipmentsData,
} from "./shipmentsApi";
import {
  CARRIER_SUGGESTIONS,
  DEFAULT_SHIPMENT_FILTERS,
  EMPTY_STUDIO_FORM,
  FOOTAGE_DUE_DAYS,
  STATUS_LABELS,
  filterShipments,
  formToStudioArgs,
  fromCreator,
  fromStudio,
  isCreatorShipment,
  needsAttention,
  shipmentStatus,
  studioToForm,
  trackingUrl,
  type ShipmentFilters,
  type ShipmentRow,
  type StudioForm,
  type StudioShipment,
} from "./shipmentsModel";
import { errorText, formatDay, todayValue } from "./model";

const CTRL = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof DashboardError) return e.code === "P0002" ? "That shipment no longer exists." : errorText(e.code, e.message || fallback);
  return e instanceof Error ? e.message : fallback;
}

function StudioEditor({ initial, title, busy, brands, shoots, onSave, onCancel }: {
  initial: StudioForm;
  title: string;
  busy: boolean;
  brands: BrandOption[];
  shoots: ShipmentsData["shoots"];
  onSave: (f: StudioForm) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initial);
  const set = (patch: Partial<StudioForm>) => setForm((f) => ({ ...f, ...patch }));
  const clientShoots = shoots.filter((s) => s.client_slug === form.client_slug);
  return (
    <form aria-label={title} className="space-y-2 rounded-lg border p-3" onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-xs">Client
          <select aria-label="Client" className={`${CTRL} mt-0.5 w-full`} value={form.client_slug} onChange={(e) => set({ client_slug: e.target.value, actor_assignment_id: "" })}>
            <option value="">Pick a client</option>
            {brands.filter((b) => b.active || b.slug === form.client_slug).map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
          </select>
        </label>
        <label className="text-xs sm:col-span-2">What is in it
          <input aria-label="What is in it" className={`${CTRL} mt-0.5 w-full`} value={form.description} onChange={(e) => set({ description: e.target.value })} />
        </label>
        <label className="text-xs">Carrier
          <input aria-label="Carrier" list="carrier-suggestions" className={`${CTRL} mt-0.5 w-full`} value={form.carrier} onChange={(e) => set({ carrier: e.target.value })} />
          <datalist id="carrier-suggestions">{CARRIER_SUGGESTIONS.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <label className="text-xs">Tracking number
          <input aria-label="Tracking number" className={`${CTRL} mt-0.5 w-full`} value={form.tracking_number} onChange={(e) => set({ tracking_number: e.target.value })} />
        </label>
        <label className="text-xs">For the shoot
          <select aria-label="For the shoot" className={`${CTRL} mt-0.5 w-full`} value={form.actor_assignment_id} onChange={(e) => set({ actor_assignment_id: e.target.value })}>
            <option value="">No shoot</option>
            {clientShoots.map((s) => <option key={s.id} value={s.id}>{formatDay(s.scheduled_shoot_date)} ({s.actors?.name ?? "actor"})</option>)}
          </select>
        </label>
        <label className="text-xs">Shipped
          <input aria-label="Shipped" type="date" className={`${CTRL} mt-0.5 w-full`} value={form.shipped_at} onChange={(e) => set({ shipped_at: e.target.value })} />
        </label>
        <label className="text-xs">Expected
          <input aria-label="Expected" type="date" className={`${CTRL} mt-0.5 w-full`} value={form.expected_delivery_at} onChange={(e) => set({ expected_delivery_at: e.target.value })} />
        </label>
      </div>
      <div className="flex gap-2">
        <button type="submit" className={CTRL} disabled={busy}>{busy ? "Saving..." : "Save"}</button>
        <button type="button" className={CTRL} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function ShipmentsPage() {
  const prefix = useRolePrefix();
  const [today] = useState(() => todayValue(new Date()));
  const [data, setData] = useState<ShipmentsData | null>(null);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [filters, setFilters] = useState<ShipmentFilters>(DEFAULT_SHIPMENT_FILTERS);
  const [editing, setEditing] = useState<StudioShipment | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await loadShipments());
    } catch (e) {
      setError(messageOf(e, "Could not load shipments."));
    }
  }, []);
  useEffect(() => {
    void load();
    loadBrandsAndTeam().then((b) => setBrands(b.brands), () => setBrands([]));
  }, [load]);

  const names = useMemo(() => new Map(brands.map((b) => [b.slug, b.name])), [brands]);
  const clientName = useCallback((slug: string) => names.get(slug) ?? slug, [names]);
  const rows = useMemo<ShipmentRow[]>(() => [
    ...(data?.creators ?? []).filter(isCreatorShipment).map(fromCreator),
    ...(data?.studio ?? []).map(fromStudio),
  ], [data]);
  const shown = useMemo(() => filterShipments(rows, filters, today, clientName), [rows, filters, today, clientName]);
  const laneClients = useMemo(() => [...new Set(rows.filter((r) => r.lane === filters.lane).map((r) => r.clientSlug))].sort((a, b) => clientName(a).localeCompare(clientName(b))), [rows, filters.lane, clientName]);
  const attention = (lane: ShipmentRow["lane"]) => rows.filter((r) => r.lane === lane && needsAttention(r, today)).length;
  const set = (patch: Partial<ShipmentFilters>) => setFilters((f) => ({ ...f, ...patch }));

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

  const saveStudio = (form: StudioForm) => {
    let args;
    try {
      args = formToStudioArgs(form);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check the form.");
      return;
    }
    const target = editing;
    void run(async () => {
      if (target === "new") await createStudioShipment(args);
      else if (target) await updateStudioShipment(target.id, args);
      return `Saved the shipment for ${clientName(args.p_client_slug)}.`;
    }).then((ok) => { if (ok) setEditing(null); });
  };

  const markDelivered = (r: ShipmentRow, delivered: string | null) => {
    void run(async () => {
      if (r.lane === "studio") await setStudioDelivered(r.sourceId, delivered);
      else await saveCreatorDelivery(r.sourceId, r.trackingNumber, delivered, r.notes);
      if (!delivered) return `${r.recipient}: marked not delivered.`;
      return r.lane === "creators" ? `${r.recipient}: delivered. Footage is due ${FOOTAGE_DUE_DAYS} days after.` : `${r.recipient}: delivered.`;
    });
  };

  const editNotes = (r: ShipmentRow) => {
    const next = window.prompt(`Delivery notes for ${r.recipient}`, r.notes ?? "");
    if (next === null) return;
    const notes = next.trim() || null;
    void run(async () => {
      if (r.lane === "studio") await setStudioNotes(r.sourceId, notes);
      else await saveCreatorDelivery(r.sourceId, r.trackingNumber, r.deliveredAt, notes);
      return "Notes saved.";
    });
  };

  const editTracking = (r: ShipmentRow) => {
    const next = window.prompt(`Tracking number for ${r.recipient}`, r.trackingNumber ?? "");
    if (next === null) return;
    void run(async () => {
      await saveCreatorDelivery(r.sourceId, next.trim() || null, r.deliveredAt, r.notes);
      return "Tracking saved.";
    });
  };

  const remove = (r: ShipmentRow) => {
    if (!window.confirm(`Delete the studio shipment "${r.description}"? This cannot be undone.`)) return;
    void run(async () => {
      await deleteStudioShipment(r.sourceId);
      return "Shipment deleted.";
    });
  };

  const studioById = useMemo(() => new Map((data?.studio ?? []).map((s) => [s.id, s])), [data]);

  return (
    <div className="p-6 space-y-4" data-testid="shipments-page">
      <PageHeader title="Shipments" description="Product going out to creators and coming in to the studio, across every client." />
      <div role="tablist" aria-label="Lane" className="flex gap-2">
        {(["creators", "studio"] as const).map((lane) => (
          <button key={lane} role="tab" aria-selected={filters.lane === lane} type="button" className={`${CTRL} ${filters.lane === lane ? "bg-muted font-semibold" : ""}`} onClick={() => set({ lane, client: "" })}>
            {lane === "creators" ? "Creator shipments" : "Studio shipments"}{data && attention(lane) > 0 ? ` (${attention(lane)} need attention)` : ""}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {filters.lane === "creators"
          ? `Product going out to a creator for a UGC shoot. Footage is due back ${FOOTAGE_DUE_DAYS} days after it lands. Tracking for a new creator is added on the Creator pipeline.`
          : "Product coming in to the studio for an in-person shoot. Nobody owes footage."}
      </p>
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {filters.lane === "studio" && (editing ? (
        <StudioEditor
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? EMPTY_STUDIO_FORM : studioToForm(editing)}
          title={editing === "new" ? "Add a studio shipment" : "Edit the studio shipment"}
          busy={busy}
          brands={brands}
          shoots={data?.shoots ?? []}
          onSave={saveStudio}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button type="button" className={CTRL} onClick={() => { setEditing("new"); setError(null); setNotice(null); }}>Add studio shipment</button>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Search shipments" placeholder="Search recipient, contents, carrier, tracking, notes" className={`${CTRL} min-w-[16rem]`} value={filters.search} onChange={(e) => set({ search: e.target.value })} />
        <select aria-label="Client filter" className={CTRL} value={filters.client} onChange={(e) => set({ client: e.target.value })}>
          <option value="">Every client</option>
          {laneClients.map((s) => <option key={s} value={s}>{clientName(s)}</option>)}
        </select>
        <select aria-label="Show" className={CTRL} value={filters.show} onChange={(e) => set({ show: e.target.value as ShipmentFilters["show"] })}>
          <option value="">All</option>
          <option value="open">Not delivered yet</option>
          <option value="attention">Needs attention</option>
        </select>
      </div>

      {!data ? (
        error ? null : <p role="status" className="text-sm text-muted-foreground">Loading shipments...</p>
      ) : shown.length === 0 ? <p className="text-sm text-muted-foreground">No shipments match these filters.</p> : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground"><th>Status</th><th>Client</th><th>{filters.lane === "creators" ? "Creator" : "Contents"}</th><th>Tracking</th><th>Dates</th><th>Notes</th><th /></tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const status = shipmentStatus(r, today);
              const track = trackingUrl(r.carrier, r.trackingNumber);
              return (
                <tr key={r.key} className="border-t align-top" data-testid={`shipment-${r.key}`}>
                  <td className="py-1.5 text-xs"><span className={`rounded px-1 ${status === "stuck" || status === "footage_overdue" ? "bg-destructive/10 text-destructive" : "bg-muted"}`}>{STATUS_LABELS[status]}</span></td>
                  <td className="text-xs"><Link to={`${prefix}/clients/${encodeURIComponent(r.clientSlug)}`} className="underline">{clientName(r.clientSlug)}</Link></td>
                  <td className="text-xs">
                    {r.creatorId ? <Link to={`${prefix}/creators/${r.creatorId}`} className="underline">{r.recipient}</Link> : r.description}
                    {r.shootDate && <div className="text-muted-foreground">Shoot {formatDay(r.shootDate)}</div>}
                  </td>
                  <td className="text-xs">
                    {r.carrier && <span>{r.carrier} </span>}
                    {track ? <a href={track} target="_blank" rel="noopener noreferrer" className="underline">{r.trackingNumber}</a> : r.trackingNumber ?? ""}
                  </td>
                  <td className="text-xs">
                    {r.shippedAt && <div>Shipped {formatDay(r.shippedAt)}</div>}
                    {r.expectedDeliveryAt && !r.deliveredAt && <div>Expected {formatDay(r.expectedDeliveryAt)}</div>}
                    {r.deliveredAt && <div>Delivered {formatDay(r.deliveredAt)}</div>}
                    {r.footageDueAt && <div>Footage due {formatDay(r.footageDueAt)}</div>}
                  </td>
                  <td className="text-xs">{r.notes ?? ""}</td>
                  <td className="space-x-2 whitespace-nowrap text-xs">
                    {r.deliveredAt
                      ? <button type="button" className="underline" disabled={busy} onClick={() => markDelivered(r, null)}>Not delivered</button>
                      : <button type="button" className="underline" disabled={busy} onClick={() => markDelivered(r, today)}>Delivered today</button>}
                    {r.lane === "creators" && <button type="button" className="underline" disabled={busy} onClick={() => editTracking(r)}>Tracking</button>}
                    <button type="button" className="underline" disabled={busy} onClick={() => editNotes(r)}>Notes</button>
                    {r.lane === "studio" && (
                      <>
                        <button type="button" className="underline" onClick={() => { const s = studioById.get(r.sourceId); if (s) { setEditing(s); setError(null); setNotice(null); } }}>Edit</button>
                        <button type="button" className="underline" disabled={busy} onClick={() => remove(r)}>Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
