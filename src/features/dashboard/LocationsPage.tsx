// Locations: staff page (consolidation step 5c, port of the old dashboard's
// /locations page and its shared location links). Spaces Goodo can shoot in:
// search, neighborhood and bedroom and bathroom floors, add and edit (through
// the checked location functions), delete after a confirm, photos through
// signed links (upload, delete and "set as main photo" in the editor, phase 6b),
// and links that share a set of locations with a client.
//
// The page a client opens (/locations-board/<token>) is served by Verdanote and
// reads this database, so a link made or revoked here works at once. Each link
// shows how often it was opened. Not ported: editing the locations on an
// existing link.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { DataTable, EmptyState, ErrorState, FilterBar, LoadingState, PageHeader, PageShell, SelectField, TextField, useConfirm, type DataColumn } from "@/components/page-kit";
import { useRolePrefix } from "@/hooks/useRolePath";
import { DashboardError, loadBrandsAndTeam, type BrandOption } from "./api";
import { describeOpens } from "@/features/public-links/linkStats";
import { createLocation, createLocationBoard, deleteLocation, loadLocations, revokeLocationBoard, updateLocation, type LocationsData } from "./locationsApi";
import {
  DEFAULT_LOCATION_FILTERS,
  EMPTY_LOCATION_FORM,
  filterLocations,
  formToArgs,
  formatCapacity,
  formatCost,
  locationBoardUrl,
  locationToForm,
  neighborhoodOptions,
  safeListingUrl,
  sortBoards,
  type Location,
  type LocationFilters,
  type LocationForm,
} from "./locationsModel";
import { errorText, formatDay } from "./model";
import { MediaSection, type MediaTile } from "./media/MediaSection";
import { MEDIA_KINDS } from "./media/mediaModel";
import { storageSecretsText } from "./media/storageSecrets";

const LINK_BTN = "h-auto p-0 text-xs";

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof DashboardError) {
    const storage = storageSecretsText(e.code, e.message, "removing the photo files");
    if (storage) return storage;
    return e.code === "P0002" ? "That location no longer exists." : errorText(e.code, e.message || fallback);
  }
  return e instanceof Error ? e.message : fallback;
}

const TEXT_FIELDS: { key: keyof LocationForm; label: string; type?: string; wide?: boolean }[] = [
  { key: "name", label: "Name" },
  { key: "neighborhood", label: "Neighborhood" },
  { key: "rental_type", label: "Rental type" },
  { key: "listing_url", label: "Listing link", type: "url" },
  { key: "cost", label: "Cost" },
  { key: "bedrooms", label: "Bedrooms" },
  { key: "bathrooms", label: "Bathrooms" },
  { key: "max_guests", label: "Max guests" },
  { key: "rooms", label: "Rooms (comma separated)", wide: true },
  { key: "attributes", label: "Attributes (comma separated)", wide: true },
  { key: "contact_name", label: "Host contact name" },
  { key: "contact_email", label: "Host contact email", type: "email" },
  { key: "wifi_name", label: "Wifi name" },
  { key: "wifi_password", label: "Wifi password" },
  { key: "parking_instructions", label: "Parking", wide: true },
  { key: "entry_instructions", label: "Entry instructions", wide: true },
  { key: "notes", label: "Notes", wide: true },
];

function LocationEditor({ initial, title, busy, onSave, onCancel, media }: {
  initial: LocationForm;
  title: string;
  busy: boolean;
  onSave: (f: LocationForm) => void;
  onCancel: () => void;
  media?: { locationId: string; tiles: MediaTile[]; links: Map<string, string>; onChanged: () => void | Promise<void>; onNotice: (m: string) => void };
}) {
  const [form, setForm] = useState(initial);
  const set = (patch: Partial<LocationForm>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <form aria-label={title} className="space-y-2 rounded-lg border p-3" onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {TEXT_FIELDS.map((f) => (
          <TextField key={f.key} label={f.label} type={f.type ?? "text"} className={f.wide ? "sm:col-span-2" : undefined} value={form[f.key] as string} onChange={(e) => set({ [f.key]: e.target.value } as Partial<LocationForm>)} />
        ))}
        <SelectField label="Cost period" value={form.cost_period} onChange={(e) => set({ cost_period: e.target.value as LocationForm["cost_period"] })} placeholder="Not set" options={[{ value: "hourly", label: "Hourly" }, { value: "daily", label: "Daily" }]} />
        <div className="flex items-end gap-3 text-sm">
          <label><input type="checkbox" checked={form.have_rented} onChange={(e) => set({ have_rented: e.target.checked })} /> Have rented</label>
          <label><input type="checkbox" checked={form.dont_rent_again} onChange={(e) => set({ dont_rent_again: e.target.checked })} /> Do not rent again</label>
        </div>
      </div>
      {media && (
        <MediaSection cfg={MEDIA_KINDS["location-photo"]} ownerId={media.locationId} title="Photos" items={media.tiles} links={media.links} allowSetMain onChanged={media.onChanged} onNotice={media.onNotice} />
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy ? "Saving..." : "Save"}</Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

export default function LocationsPage() {
  const prefix = useRolePrefix();
  const [data, setData] = useState<LocationsData | null>(null);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [filters, setFilters] = useState<LocationFilters>(DEFAULT_LOCATION_FILTERS);
  const [showUnrecorded, setShowUnrecorded] = useState(false);
  const [editing, setEditing] = useState<Location | "new" | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shareClient, setShareClient] = useState("");
  const [shareLabel, setShareLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(async () => {
    try {
      setData(await loadLocations());
      setLoadError(null);
    } catch (e) {
      setLoadError(messageOf(e, "Could not load locations."));
    }
  }, []);
  useEffect(() => {
    void load();
    loadBrandsAndTeam().then((b) => setBrands(b.brands), () => setBrands([]));
  }, [load]);

  const locations = useMemo(() => data?.locations ?? [], [data]);
  const byId = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  const brandName = useMemo(() => new Map(brands.map((b) => [b.slug, b.name])), [brands]);
  const photosOf = useMemo(() => {
    const m = new Map<string, LocationsData["photos"]>();
    for (const p of data?.photos ?? []) m.set(p.location_id, [...(m.get(p.location_id) ?? []), p]);
    return m;
  }, [data]);
  const neighborhoods = useMemo(() => neighborhoodOptions(locations), [locations]);
  const { shown, unrecorded } = useMemo(() => filterLocations(locations, filters), [locations, filters]);
  const boards = useMemo(() => sortBoards(data?.boards ?? []), [data]);
  const set = (patch: Partial<LocationFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const floor = (v: string) => (v === "" ? null : Number(v));

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await fn());
    } catch (e) {
      setError(messageOf(e, "The change could not be saved."));
      setBusy(false);
      await load();
      return false;
    }
    setBusy(false);
    await load();
    return true;
  };

  const save = (form: LocationForm) => {
    let args;
    try {
      args = formToArgs(form);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check the form.");
      return;
    }
    const target = editing;
    void run(async () => {
      if (target === "new") {
        await createLocation(args);
        return `Added ${args.p_name}.`;
      }
      if (target) await updateLocation(target.id, args);
      return `Saved ${args.p_name}.`;
    }).then((ok) => { if (ok) setEditing(null); });
  };

  const remove = async (l: Location) => {
    if (!(await confirm({ title: `Delete ${l.name}?`, description: "Its photos are deleted, it leaves every location link, and shoots that used it keep their typed location.", actionLabel: "Delete" }))) return;
    void run(async () => {
      await deleteLocation(l.id);
      return `Deleted ${l.name}.`;
    });
  };

  const toggle = (id: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const share = () => {
    const ids = [...selected];
    void run(async () => {
      const board = await createLocationBoard(shareClient || null, shareLabel.trim() || null, ids);
      setSelected(new Set());
      setShareLabel("");
      return `Link created with ${ids.length} location${ids.length === 1 ? "" : "s"}: ${locationBoardUrl(board.token)}`;
    });
  };

  const revoke = async (id: string) => {
    if (!(await confirm({ title: "Revoke this location link?", description: "It stops working, and a new one can be made after.", actionLabel: "Revoke" }))) return;
    void run(async () => {
      await revokeLocationBoard(id);
      return "Link revoked.";
    });
  };

  const copy = (url: string) => {
    void navigator.clipboard?.writeText(url).then(() => setNotice("Link copied."), () => setNotice(`Copy the link: ${url}`));
  };

  const columns: DataColumn<Location>[] = [
    { key: "select", header: "Select", srOnlyHeader: true, cell: (l) => <input type="checkbox" aria-label={`Select ${l.name}`} checked={selected.has(l.id)} onChange={() => toggle(l.id)} /> },
    {
      key: "thumb",
      header: "Photo",
      srOnlyHeader: true,
      cell: (l) => {
        const thumb = (photosOf.get(l.id) ?? []).map((p) => data?.links.get(p.storage_path)).find(Boolean);
        return thumb ? <img src={thumb} alt={l.name} className="h-12 w-16 rounded object-cover" /> : <div className="h-12 w-16 rounded bg-muted" />;
      },
    },
    {
      key: "location",
      header: "Location",
      cell: (l) => (
        <>
          <div className="font-medium">{l.name}</div>
          <div className="text-xs text-muted-foreground">{[l.neighborhood, l.rental_type].filter(Boolean).join(" · ")}</div>
          {l.dont_rent_again && <span className="mr-1 rounded bg-muted px-1 text-xs font-medium">Do not rent again</span>}
          {l.have_rented && <span className="rounded bg-muted px-1 text-xs">Rented before</span>}
        </>
      ),
    },
    { key: "cost", header: "Cost", cell: (l) => formatCost(l.cost, l.cost_period) },
    { key: "size", header: "Size", cell: (l) => formatCapacity(l) },
    { key: "photos", header: "Photos", cell: (l) => (photosOf.get(l.id) ?? []).length },
    {
      key: "actions",
      header: "Actions",
      srOnlyHeader: true,
      cell: (l) => {
        const listing = safeListingUrl(l.listing_url);
        return (
          <div className="flex flex-wrap items-center gap-2">
            {listing && <a href={listing} target="_blank" rel="noopener noreferrer" className="text-xs underline">Listing</a>}
            <Button type="button" variant="link" size="sm" className={LINK_BTN} onClick={() => { setEditing(l); setError(null); setNotice(null); }}>Edit</Button>
            <Button type="button" variant="link" size="sm" className={LINK_BTN} disabled={busy} onClick={() => void remove(l)}>Delete</Button>
          </div>
        );
      },
    },
  ];

  const editingMedia = editing && editing !== "new"
    ? {
        locationId: editing.id,
        tiles: (photosOf.get(editing.id) ?? []).map((p, i): MediaTile => ({ id: p.id, storage_path: p.storage_path, label: p.caption || `Photo ${i + 1}`, sort_order: p.sort_order })),
        links: data?.links ?? new Map<string, string>(),
        onChanged: load,
        onNotice: setNotice,
      }
    : undefined;

  return (
    <PageShell wide data-testid="locations-page">
      <PageHeader title="Locations" description="Spaces Goodo can shoot in, and links that share a set of them with a client." />
      <p className="text-xs text-muted-foreground" data-testid="old-dashboard-note">
        Clients open these links on Verdanote with no login. Revoke stops a link at once. Open a location to add, delete or reorder its photos.
      </p>
      {notice && <p role="status" className="break-all text-sm text-muted-foreground">{notice}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {editing ? (
        <LocationEditor
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? EMPTY_LOCATION_FORM : locationToForm(editing)}
          title={editing === "new" ? "Add a location" : `Edit ${editing.name}`}
          busy={busy}
          onSave={save}
          onCancel={() => setEditing(null)}
          media={editingMedia}
        />
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={() => { setEditing("new"); setError(null); setNotice(null); }}>Add location</Button>
      )}

      <FilterBar search={{ value: filters.search, onChange: (v) => set({ search: v }), label: "Search locations", placeholder: "Search name, neighborhood, rooms, notes" }}>
        <SelectField label="Neighborhood" hideLabel value={filters.neighborhood} onChange={(e) => set({ neighborhood: e.target.value })} placeholder="Any neighborhood" options={neighborhoods.map((n) => ({ value: n, label: n }))} />
        <SelectField label="Minimum bedrooms" hideLabel value={filters.minBedrooms ?? ""} onChange={(e) => set({ minBedrooms: floor(e.target.value) })} placeholder="Any bedrooms" options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n}+ bedrooms` }))} />
        <SelectField label="Minimum bathrooms" hideLabel value={filters.minBathrooms ?? ""} onChange={(e) => set({ minBathrooms: floor(e.target.value) })} placeholder="Any bathrooms" options={[1, 1.5, 2, 3].map((n) => ({ value: String(n), label: `${n}+ bathrooms` }))} />
        <label className="flex items-center gap-1 pb-2 text-sm"><input type="checkbox" checked={filters.hideDontRent} onChange={(e) => set({ hideDontRent: e.target.checked })} /> Hide do not rent again</label>
      </FilterBar>

      {loadError ? (
        <ErrorState message={loadError} onRetry={() => void load()} />
      ) : !data ? (
        <LoadingState label="Loading locations" />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="locations-count">
            {shown.length === locations.length ? `${locations.length} locations` : `${shown.length} of ${locations.length} locations`}
          </p>
          {shown.length === 0 ? (
            <EmptyState title="No locations match these filters." />
          ) : (
            <DataTable label="Locations" columns={columns} rows={shown} rowKey={(l) => l.id} rowTestId={(l) => `location-row-${l.id}`} />
          )}
          {unrecorded.length > 0 && (
            <section aria-label="No count recorded" className="text-sm">
              <Button type="button" variant="link" size="sm" className="h-auto p-0 text-sm" onClick={() => setShowUnrecorded((v) => !v)}>
                {unrecorded.length} location{unrecorded.length === 1 ? " has" : "s have"} no bedroom or bathroom count recorded{showUnrecorded ? " (hide)" : " (show)"}
              </Button>
              {showUnrecorded && <div className="mt-1"><DataTable label="Locations with no count recorded" columns={columns} rows={unrecorded} rowKey={(l) => l.id} rowTestId={(l) => `location-row-${l.id}`} /></div>}
            </section>
          )}

          <section aria-label="Share selected" className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
            <span>{selected.size} selected</span>
            <SelectField label="Share with client" hideLabel value={shareClient} onChange={(e) => setShareClient(e.target.value)} placeholder="No client" options={brands.filter((b) => b.active).map((b) => ({ value: b.slug, label: b.name }))} />
            <TextField label="Link label" hideLabel placeholder="Label, for example May shoot" value={shareLabel} onChange={(e) => setShareLabel(e.target.value)} />
            <Button type="button" size="sm" variant="outline" disabled={busy || selected.size === 0} onClick={share}>Create link</Button>
          </section>

          <section aria-label="Location links" className="rounded-lg border p-3 text-sm">
            <h2 className="font-semibold">Location links ({boards.length})</h2>
            {boards.length === 0 ? <EmptyState className="mt-2 py-4" title="None yet." /> : (
              <ul className="mt-1">
                {boards.map((b) => {
                  const url = locationBoardUrl(b.token);
                  const names = b.location_board_items.map((i) => byId.get(i.location_id)?.name ?? "Deleted location");
                  return (
                    <li key={b.id} className="border-t py-1.5" data-testid={`location-board-${b.id}`}>
                      <div className="font-medium">
                        {b.label || "Untitled link"}
                        {b.client_slug && <> for <Link to={`${prefix}/clients/${encodeURIComponent(b.client_slug)}`} className="underline">{brandName.get(b.client_slug) ?? b.client_slug}</Link></>}
                        <span className="text-xs text-muted-foreground"> · made {formatDay(b.created_at)}{b.revoked ? " · revoked" : ""}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">{names.join(", ")}</div>
                      {!b.revoked && (
                        <div className="mt-0.5 flex flex-wrap items-center gap-2">
                          <a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-xs underline">{url}</a>
                          <Button type="button" size="sm" variant="outline" onClick={() => copy(url)}>Copy link</Button>
                          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void revoke(b.id)}>Revoke</Button>
                          <span className="w-full text-xs text-muted-foreground" data-testid={`link-activity-${b.id}`}>{describeOpens(data?.stats?.[b.id], formatDay)}</span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
      {dialog}
    </PageShell>
  );
}
