// Shipments: staff page (consolidation step 5c, port of the old dashboard's
// /shipments package tracker). Two lanes, shown apart: product going out to
// creators (tracking, delivered date and notes on the creator's brand row,
// with footage due FOOTAGE_DUE_DAYS after delivery) and product coming in to
// the studio for a shoot. Stuck and footage-overdue rows sort first. Tracking
// numbers link to the carrier's public page; nothing calls a carrier.
// Not ported: the calendar view of expected and delivered dates.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { DataTable, EmptyState, ErrorState, FilterBar, LoadingState, PageHeader, PageShell, SelectField, StatusBadge, TextField, useConfirm, type DataColumn } from "@/components/page-kit";
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

const STATUS_KEY: Record<string, string> = { not_shipped: "draft", in_transit: "in_progress", stuck: "blocked", delivered: "done", footage_due: "waiting", footage_overdue: "late" };

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
        <SelectField label="Client" value={form.client_slug} onChange={(e) => set({ client_slug: e.target.value, actor_assignment_id: "" })} placeholder="Pick a client" options={brands.filter((b) => b.active || b.slug === form.client_slug).map((b) => ({ value: b.slug, label: b.name }))} />
        <TextField label="What is in it" className="sm:col-span-2" value={form.description} onChange={(e) => set({ description: e.target.value })} />
        <div>
          <TextField label="Carrier" list="carrier-suggestions" value={form.carrier} onChange={(e) => set({ carrier: e.target.value })} />
          <datalist id="carrier-suggestions">{CARRIER_SUGGESTIONS.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <TextField label="Tracking number" value={form.tracking_number} onChange={(e) => set({ tracking_number: e.target.value })} />
        <SelectField label="For the shoot" value={form.actor_assignment_id} onChange={(e) => set({ actor_assignment_id: e.target.value })} placeholder="No shoot" options={clientShoots.map((x) => ({ value: x.id, label: `${formatDay(x.scheduled_shoot_date)} (${x.actors?.name ?? "actor"})` }))} />
        <TextField label="Shipped" type="date" value={form.shipped_at} onChange={(e) => set({ shipped_at: e.target.value })} />
        <TextField label="Expected" type="date" value={form.expected_delivery_at} onChange={(e) => set({ expected_delivery_at: e.target.value })} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy ? "Saving..." : "Save"}</Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(async () => {
    try {
      setData(await loadShipments());
      setLoadError(null);
    } catch (e) {
      setLoadError(messageOf(e, "Could not load shipments."));
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

  const remove = async (r: ShipmentRow) => {
    if (!(await confirm({ title: `Delete the studio shipment "${r.description}"?`, description: "This cannot be undone.", actionLabel: "Delete" }))) return;
    void run(async () => {
      await deleteStudioShipment(r.sourceId);
      return "Shipment deleted.";
    });
  };

  const studioById = useMemo(() => new Map((data?.studio ?? []).map((s) => [s.id, s])), [data]);

  const linkBtn = "h-auto p-0";
  const columns: DataColumn<ShipmentRow>[] = [
    {
      key: "status",
      header: "Status",
      cell: (r) => {
        const status = shipmentStatus(r, today);
        return <StatusBadge status={STATUS_KEY[status]} label={STATUS_LABELS[status]} />;
      },
    },
    { key: "client", header: "Client", cell: (r) => <Link to={`${prefix}/clients/${encodeURIComponent(r.clientSlug)}`} className="underline">{clientName(r.clientSlug)}</Link> },
    {
      key: "what",
      header: filters.lane === "creators" ? "Creator" : "Contents",
      cell: (r) => (
        <>
          {r.creatorId ? <Link to={`${prefix}/creators/${r.creatorId}`} className="underline">{r.recipient}</Link> : r.description}
          {r.shootDate && <div className="text-muted-foreground">Shoot {formatDay(r.shootDate)}</div>}
        </>
      ),
    },
    {
      key: "tracking",
      header: "Tracking",
      cell: (r) => {
        const track = trackingUrl(r.carrier, r.trackingNumber);
        return (
          <>
            {r.carrier && <span>{r.carrier} </span>}
            {track ? <a href={track} target="_blank" rel="noopener noreferrer" className="underline">{r.trackingNumber}</a> : r.trackingNumber ?? ""}
          </>
        );
      },
    },
    {
      key: "dates",
      header: "Dates",
      cell: (r) => (
        <>
          {r.shippedAt && <div>Shipped {formatDay(r.shippedAt)}</div>}
          {r.expectedDeliveryAt && !r.deliveredAt && <div>Expected {formatDay(r.expectedDeliveryAt)}</div>}
          {r.deliveredAt && <div>Delivered {formatDay(r.deliveredAt)}</div>}
          {r.footageDueAt && <div>Footage due {formatDay(r.footageDueAt)}</div>}
        </>
      ),
    },
    { key: "notes", header: "Notes", cell: (r) => r.notes ?? "" },
    {
      key: "actions",
      header: "Actions",
      srOnlyHeader: true,
      cell: (r) => (
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          {r.deliveredAt
            ? <Button type="button" variant="link" size="sm" className={linkBtn} disabled={busy} onClick={() => markDelivered(r, null)}>Not delivered</Button>
            : <Button type="button" variant="link" size="sm" className={linkBtn} disabled={busy} onClick={() => markDelivered(r, today)}>Delivered today</Button>}
          {r.lane === "creators" && <Button type="button" variant="link" size="sm" className={linkBtn} disabled={busy} onClick={() => editTracking(r)}>Tracking</Button>}
          <Button type="button" variant="link" size="sm" className={linkBtn} disabled={busy} onClick={() => editNotes(r)}>Notes</Button>
          {r.lane === "studio" && (
            <>
              <Button type="button" variant="link" size="sm" className={linkBtn} onClick={() => { const s = studioById.get(r.sourceId); if (s) { setEditing(s); setError(null); setNotice(null); } }}>Edit</Button>
              <Button type="button" variant="link" size="sm" className={linkBtn} disabled={busy} onClick={() => void remove(r)}>Delete</Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <PageShell wide data-testid="shipments-page">
      <PageHeader title="Shipments" description="Product going out to creators and coming in to the studio, across every client." />
      <div role="tablist" aria-label="Lane" className="flex flex-wrap gap-2">
        {(["creators", "studio"] as const).map((lane) => (
          <Button key={lane} role="tab" aria-selected={filters.lane === lane} type="button" size="sm" variant={filters.lane === lane ? "default" : "outline"} onClick={() => set({ lane, client: "" })}>
            {lane === "creators" ? "Creator shipments" : "Studio shipments"}{data && attention(lane) > 0 ? ` (${attention(lane)} need attention)` : ""}
          </Button>
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
        <Button type="button" size="sm" variant="outline" onClick={() => { setEditing("new"); setError(null); setNotice(null); }}>Add studio shipment</Button>
      ))}

      <FilterBar search={{ value: filters.search, onChange: (v) => set({ search: v }), label: "Search shipments", placeholder: "Search recipient, contents, carrier, tracking, notes" }}>
        <SelectField label="Client filter" hideLabel value={filters.client} onChange={(e) => set({ client: e.target.value })} placeholder="Every client" options={laneClients.map((c) => ({ value: c, label: clientName(c) }))} />
        <SelectField label="Show" hideLabel value={filters.show} onChange={(e) => set({ show: e.target.value as ShipmentFilters["show"] })} placeholder="All" options={[{ value: "open", label: "Not delivered yet" }, { value: "attention", label: "Needs attention" }]} />
      </FilterBar>

      {loadError ? (
        <ErrorState message={loadError} onRetry={() => void load()} />
      ) : !data ? (
        <LoadingState label="Loading shipments" />
      ) : shown.length === 0 ? (
        <EmptyState title="No shipments match these filters." />
      ) : (
        <DataTable label="Shipments" columns={columns} rows={shown} rowKey={(r) => r.key} rowTestId={(r) => `shipment-${r.key}`} minWidthClass="min-w-[56rem]" />
      )}
      {dialog}
    </PageShell>
  );
}
