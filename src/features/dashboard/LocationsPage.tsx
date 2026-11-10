// Locations: staff page (consolidation step 5c, port of the old dashboard's
// /locations page and its shared location links). Spaces Goodo can shoot in:
// search, neighborhood and bedroom and bathroom floors, add and edit (through
// the checked location functions), delete after a confirm, photos through
// signed links, and links that share a set of locations with a client.
//
// The page a client opens (/locations-board/<token>) stays on the old
// dashboard and reads the old dashboard's database until the release, so a
// link made or revoked here takes effect for clients only once the release
// points that page at this database. The page says so. Not ported: photo
// upload and reorder, and editing the locations on an existing link.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { useRolePrefix } from "@/hooks/useRolePath";
import { DashboardError, loadBrandsAndTeam, type BrandOption } from "./api";
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

const CTRL = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof DashboardError) return e.code === "P0002" ? "That location no longer exists." : errorText(e.code, e.message || fallback);
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

function LocationEditor({ initial, title, busy, onSave, onCancel, photos }: {
  initial: LocationForm;
  title: string;
  busy: boolean;
  onSave: (f: LocationForm) => void;
  onCancel: () => void;
  photos?: { id: string; label: string; url?: string }[];
}) {
  const [form, setForm] = useState(initial);
  const set = (patch: Partial<LocationForm>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <form aria-label={title} className="space-y-2 rounded-lg border p-3" onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {TEXT_FIELDS.map((f) => (
          <label key={f.key} className={`text-xs ${f.wide ? "sm:col-span-2" : ""}`}>
            {f.label}
            <input aria-label={f.label} type={f.type ?? "text"} className={`${CTRL} mt-0.5 w-full`} value={form[f.key] as string} onChange={(e) => set({ [f.key]: e.target.value } as Partial<LocationForm>)} />
          </label>
        ))}
        <label className="text-xs">
          Cost period
          <select aria-label="Cost period" className={`${CTRL} mt-0.5 w-full`} value={form.cost_period} onChange={(e) => set({ cost_period: e.target.value as LocationForm["cost_period"] })}>
            <option value="">Not set</option>
            <option value="hourly">Hourly</option>
            <option value="daily">Daily</option>
          </select>
        </label>
        <div className="flex items-end gap-3 text-sm">
          <label><input type="checkbox" checked={form.have_rented} onChange={(e) => set({ have_rented: e.target.checked })} /> Have rented</label>
          <label><input type="checkbox" checked={form.dont_rent_again} onChange={(e) => set({ dont_rent_again: e.target.checked })} /> Do not rent again</label>
        </div>
      </div>
      {photos && (
        <section aria-label="Photos" className="text-xs">
          <h3 className="font-semibold">Photos ({photos.length})</h3>
          {photos.length === 0 ? <p className="text-muted-foreground">No photos. Photos are added on the old dashboard until the release.</p> : (
            <ul className="mt-1 flex flex-wrap gap-2">
              {photos.map((p) => (
                <li key={p.id} className="w-32">
                  {p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer"><img src={p.url} alt={p.label} className="h-24 w-32 rounded object-cover" /></a> : <div className="flex h-24 w-32 items-center justify-center rounded bg-muted text-muted-foreground">File not in storage</div>}
                  <div className="truncate">{p.label}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <div className="flex gap-2">
        <button type="submit" className={CTRL} disabled={busy}>{busy ? "Saving..." : "Save"}</button>
        <button type="button" className={CTRL} onClick={onCancel}>Cancel</button>
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
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await loadLocations());
    } catch (e) {
      setError(messageOf(e, "Could not load locations."));
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

  const remove = (l: Location) => {
    if (!window.confirm(`Delete ${l.name}? Its photos are deleted, it leaves every location link, and shoots that used it keep their typed location.`)) return;
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

  const revoke = (id: string) => {
    if (!window.confirm("Revoke this location link? It stops working, and a new one can be made after.")) return;
    void run(async () => {
      await revokeLocationBoard(id);
      return "Link revoked.";
    });
  };

  const copy = (url: string) => {
    void navigator.clipboard?.writeText(url).then(() => setNotice("Link copied."), () => setNotice(`Copy the link: ${url}`));
  };

  const row = (l: Location) => {
    const photos = photosOf.get(l.id) ?? [];
    const thumb = photos.map((p) => data?.links.get(p.storage_path)).find(Boolean);
    const listing = safeListingUrl(l.listing_url);
    return (
      <tr key={l.id} className="border-t align-top" data-testid={`location-row-${l.id}`}>
        <td className="py-1.5 pr-2"><input type="checkbox" aria-label={`Select ${l.name}`} checked={selected.has(l.id)} onChange={() => toggle(l.id)} /></td>
        <td className="py-1.5 pr-2">{thumb ? <img src={thumb} alt={l.name} className="h-12 w-16 rounded object-cover" /> : <div className="h-12 w-16 rounded bg-muted" />}</td>
        <td className="py-1.5">
          <div className="font-medium">{l.name}</div>
          <div className="text-xs text-muted-foreground">{[l.neighborhood, l.rental_type].filter(Boolean).join(" · ")}</div>
          {l.dont_rent_again && <span className="mr-1 rounded bg-destructive/10 px-1 text-xs text-destructive">Do not rent again</span>}
          {l.have_rented && <span className="rounded bg-muted px-1 text-xs">Rented before</span>}
        </td>
        <td className="text-xs">{formatCost(l.cost, l.cost_period)}</td>
        <td className="text-xs">{formatCapacity(l)}</td>
        <td className="text-xs">{photos.length}</td>
        <td className="space-x-2 text-xs">
          {listing && <a href={listing} target="_blank" rel="noopener noreferrer" className="underline">Listing</a>}
          <button type="button" className="underline" onClick={() => { setEditing(l); setError(null); setNotice(null); }}>Edit</button>
          <button type="button" className="underline" disabled={busy} onClick={() => remove(l)}>Delete</button>
        </td>
      </tr>
    );
  };

  const editingPhotos = editing && editing !== "new"
    ? (photosOf.get(editing.id) ?? []).map((p, i) => ({ id: p.id, label: p.caption || `Photo ${i + 1}`, url: data?.links.get(p.storage_path) }))
    : undefined;

  return (
    <div className="p-6 space-y-4" data-testid="locations-page">
      <PageHeader title="Locations" description="Spaces Goodo can shoot in, and links that share a set of them with a client." />
      <p className="text-xs text-muted-foreground" data-testid="old-dashboard-note">
        Public links still open on the old dashboard for now. Links you make or revoke here reach clients once the public pages move over. Photos are still uploaded on the old dashboard.
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
          photos={editingPhotos}
        />
      ) : (
        <button type="button" className={CTRL} onClick={() => { setEditing("new"); setError(null); setNotice(null); }}>Add location</button>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Search locations" placeholder="Search name, neighborhood, rooms, notes" className={`${CTRL} min-w-[16rem]`} value={filters.search} onChange={(e) => set({ search: e.target.value })} />
        <select aria-label="Neighborhood" className={CTRL} value={filters.neighborhood} onChange={(e) => set({ neighborhood: e.target.value })}>
          <option value="">Any neighborhood</option>
          {neighborhoods.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select aria-label="Minimum bedrooms" className={CTRL} value={filters.minBedrooms ?? ""} onChange={(e) => set({ minBedrooms: floor(e.target.value) })}>
          <option value="">Any bedrooms</option>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}+ bedrooms</option>)}
        </select>
        <select aria-label="Minimum bathrooms" className={CTRL} value={filters.minBathrooms ?? ""} onChange={(e) => set({ minBathrooms: floor(e.target.value) })}>
          <option value="">Any bathrooms</option>
          {[1, 1.5, 2, 3].map((n) => <option key={n} value={n}>{n}+ bathrooms</option>)}
        </select>
        <label className="text-sm"><input type="checkbox" checked={filters.hideDontRent} onChange={(e) => set({ hideDontRent: e.target.checked })} /> Hide do not rent again</label>
      </div>

      {!data ? (
        error ? null : <p role="status" className="text-sm text-muted-foreground">Loading locations...</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="locations-count">
            {shown.length === locations.length ? `${locations.length} locations` : `${shown.length} of ${locations.length} locations`}
          </p>
          {shown.length === 0 ? <p className="text-sm text-muted-foreground">No locations match these filters.</p> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground"><th /><th /><th>Location</th><th>Cost</th><th>Size</th><th>Photos</th><th /></tr>
              </thead>
              <tbody>{shown.map(row)}</tbody>
            </table>
          )}
          {unrecorded.length > 0 && (
            <section aria-label="No count recorded" className="text-sm">
              <button type="button" className="underline" onClick={() => setShowUnrecorded((v) => !v)}>
                {unrecorded.length} location{unrecorded.length === 1 ? " has" : "s have"} no bedroom or bathroom count recorded{showUnrecorded ? " (hide)" : " (show)"}
              </button>
              {showUnrecorded && <table className="mt-1 w-full text-sm"><tbody>{unrecorded.map(row)}</tbody></table>}
            </section>
          )}

          <section aria-label="Share selected" className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
            <span>{selected.size} selected</span>
            <select aria-label="Share with client" className={CTRL} value={shareClient} onChange={(e) => setShareClient(e.target.value)}>
              <option value="">No client</option>
              {brands.filter((b) => b.active).map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
            </select>
            <input aria-label="Link label" placeholder="Label, for example May shoot" className={CTRL} value={shareLabel} onChange={(e) => setShareLabel(e.target.value)} />
            <button type="button" className={CTRL} disabled={busy || selected.size === 0} onClick={share}>Create link</button>
          </section>

          <section aria-label="Location links" className="rounded-lg border p-3 text-sm">
            <h2 className="font-semibold">Location links ({boards.length})</h2>
            {boards.length === 0 ? <p className="mt-1 text-muted-foreground">None yet.</p> : (
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
                          <button type="button" className={CTRL} onClick={() => copy(url)}>Copy link</button>
                          <button type="button" className={CTRL} disabled={busy} onClick={() => revoke(b.id)}>Revoke</button>
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
    </div>
  );
}
