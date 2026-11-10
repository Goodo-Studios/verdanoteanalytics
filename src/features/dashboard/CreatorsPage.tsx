// Creators: staff page (consolidation step 5b, port of the old dashboard's
// Creators page). The creator roster (dashboard_creators) with search, filters
// and sort kept in the address, 50 to a page. Each row links to the creator's
// page and to the brands they are on in the Creator pipeline. Staff add a
// creator by hand here; applicants become creators when an application is
// approved.
//
// Not ported: bulk do-not-use, the profile-gap and age-band filters and the
// sortable column headers.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { useRolePrefix } from "@/hooks/useRolePath";
import { DashboardError, loadBrandsAndTeam, type BrandOption } from "./api";
import { createCreator, loadCreatorRoster, type RosterAssignment } from "./rosterApi";
import {
  CREATOR_CATEGORIES,
  creatorFiltersFromParams,
  creatorFiltersToParams,
  filterCreators,
  genderOptions,
  paginate,
  sortCreators,
  type CreatorFilters,
  type RosterCreator,
} from "./rosterModel";
import { errorText, stageLabel } from "./model";

const CTRL = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

export default function CreatorsPage() {
  const prefix = useRolePrefix();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => creatorFiltersFromParams(params), [params]);
  const [creators, setCreators] = useState<RosterCreator[] | null>(null);
  const [assignments, setAssignments] = useState<RosterAssignment[]>([]);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [roster, base] = await Promise.all([loadCreatorRoster(), loadBrandsAndTeam()]);
      setCreators(roster.creators);
      setAssignments(roster.assignments);
      setBrands(base.brands);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load creators.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const set = (patch: Partial<CreatorFilters>) => {
    setParams(creatorFiltersToParams({ ...filters, page: 1, ...patch }), { replace: true });
  };

  const brandNames = useMemo(() => new Map(brands.map((b) => [b.slug, b.name])), [brands]);
  const byCreator = useMemo(() => {
    const m = new Map<string, RosterAssignment[]>();
    for (const a of assignments) m.set(a.creator_id, [...(m.get(a.creator_id) ?? []), a]);
    return m;
  }, [assignments]);
  const genders = useMemo(() => genderOptions(creators ?? []), [creators]);
  const visible = useMemo(() => sortCreators(filterCreators(creators ?? [], filters), filters.sort), [creators, filters]);
  const paged = paginate(visible, filters.page);

  const add = async () => {
    const name = newName.trim();
    if (!name) {
      setError("A name is required to add a creator.");
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const id = await createCreator(name, newEmail.trim() || null);
      navigate(`${prefix}/creators/${id}`);
    } catch (e) {
      setError(e instanceof DashboardError ? errorText(e.code, e.message) : "The creator was not added.");
      setAdding(false);
    }
  };

  return (
    <div className="p-6 space-y-4" data-testid="creators-page">
      <PageHeader title="Creators" description="The creator roster. Open a creator to edit their profile and see their brands and media." />
      <form className="flex flex-wrap items-end gap-2 rounded-lg border p-3" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <label className="text-xs">Name<input aria-label="New creator name" className={`${CTRL} ml-1`} value={newName} onChange={(e) => setNewName(e.target.value)} /></label>
        <label className="text-xs">Email<input aria-label="New creator email" type="email" className={`${CTRL} ml-1`} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} /></label>
        <button type="submit" className={CTRL} disabled={adding}>{adding ? "Adding..." : "Add creator"}</button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Search creators" placeholder="Search name, email, location, category" className={`${CTRL} min-w-[16rem]`} value={filters.search} onChange={(e) => set({ search: e.target.value })} />
        <select aria-label="Category" className={CTRL} value={filters.category} onChange={(e) => set({ category: e.target.value })}>
          <option value="">Any category</option>
          {CREATOR_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select aria-label="Minimum scale" className={CTRL} value={filters.minScale ?? ""} onChange={(e) => set({ minScale: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Any scale</option>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}+</option>)}
        </select>
        <select aria-label="Gender" className={CTRL} value={filters.gender} onChange={(e) => set({ gender: e.target.value })}>
          <option value="">Any gender</option>
          {genders.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select aria-label="Sort" className={CTRL} value={filters.sort} onChange={(e) => set({ sort: e.target.value as CreatorFilters["sort"] })}>
          <option value="name">Name</option>
          <option value="scale">Scale, highest first</option>
          <option value="newest">Newest first</option>
        </select>
        <label className="text-sm"><input type="checkbox" checked={filters.trialedOnly} onChange={(e) => set({ trialedOnly: e.target.checked })} /> Trialed only</label>
        <label className="text-sm"><input type="checkbox" checked={filters.needsReviewOnly} onChange={(e) => set({ needsReviewOnly: e.target.checked })} /> Categories need review</label>
        <label className="text-sm"><input type="checkbox" checked={filters.showDoNotUse} onChange={(e) => set({ showDoNotUse: e.target.checked })} /> Show do not use</label>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!creators ? (
        error ? null : <p role="status" className="text-sm text-muted-foreground">Loading creators...</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="creators-count">
            {visible.length === creators.length ? `${creators.length} creators` : `${visible.length} of ${creators.length} creators`}
          </p>
          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">No creators match these filters.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground"><th>Creator</th><th>Scale</th><th>Categories</th><th>Location</th><th>Brands</th></tr>
              </thead>
              <tbody>
                {paged.rows.map((c) => (
                  <tr key={c.id} className="border-t align-top" data-testid={`creator-row-${c.id}`}>
                    <td className="py-1.5">
                      <Link to={`${prefix}/creators/${c.id}`} className="font-medium underline">{c.name}</Link>
                      {c.do_not_use_again && <span className="ml-2 rounded bg-destructive/10 px-1 text-xs text-destructive">Do not use</span>}
                      {c.trialed && <span className="ml-2 rounded bg-muted px-1 text-xs">Trialed</span>}
                    </td>
                    <td>{c.scale ?? ""}</td>
                    <td className="text-xs">{c.categories.join(", ")}{c.categories_needs_review ? " (needs review)" : ""}</td>
                    <td className="text-xs">{c.location ?? ""}</td>
                    <td className="text-xs">
                      {(byCreator.get(c.id) ?? []).map((a) => (
                        <Link key={a.id} to={`${prefix}/creator-pipeline?brand=${encodeURIComponent(a.client_slug)}`} className="mr-2 underline">
                          {brandNames.get(a.client_slug) ?? a.client_slug} ({stageLabel(a.stage)})
                        </Link>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {paged.pages > 1 && (
            <nav aria-label="Pages" className="flex items-center gap-2 text-sm">
              <button type="button" className={CTRL} disabled={paged.page <= 1} onClick={() => set({ page: paged.page - 1 })}>Previous</button>
              <span>Page {paged.page} of {paged.pages}</span>
              <button type="button" className={CTRL} disabled={paged.page >= paged.pages} onClick={() => set({ page: paged.page + 1 })}>Next</button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
