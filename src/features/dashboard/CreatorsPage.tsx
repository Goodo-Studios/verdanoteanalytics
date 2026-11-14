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
import { Button } from "@/components/ui/button";
import { DataTable, EmptyState, ErrorState, FilterBar, LoadingState, PageHeader, PageShell, SelectField, TextField, type DataColumn } from "@/components/page-kit";
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
import CreatorDetailPage from "./CreatorDetailPage";
import { RecordModal } from "./RecordModal";

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

  // The open record lives in the address (?creator=), so the modal can be linked, and Back closes it.
  const hrefFor = (id: string | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set("creator", id);
    else p.delete("creator");
    const s = p.toString();
    return s ? `?${s}` : "?";
  };
  const openId = params.get("creator");

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
      setNewName("");
      setNewEmail("");
      setAdding(false);
      await load();
      navigate(hrefFor(id));
    } catch (e) {
      setError(e instanceof DashboardError ? errorText(e.code, e.message) : "The creator was not added.");
      setAdding(false);
    }
  };

  const columns: DataColumn<RosterCreator>[] = [
    {
      key: "creator",
      header: "Creator",
      cell: (c) => (
        <>
          <Link to={hrefFor(c.id)} preventScrollReset className="font-medium underline">{c.name}</Link>
          {c.do_not_use_again && <span className="ml-2 rounded bg-destructive/10 px-1 text-xs text-destructive">Do not use</span>}
          {c.trialed && <span className="ml-2 rounded bg-muted px-1 text-xs">Trialed</span>}
        </>
      ),
    },
    { key: "scale", header: "Scale", cell: (c) => c.scale ?? "" },
    { key: "categories", header: "Categories", cell: (c) => `${c.categories.join(", ")}${c.categories_needs_review ? " (needs review)" : ""}` },
    { key: "location", header: "Location", cell: (c) => c.location ?? "" },
    {
      key: "clients",
      header: "Clients",
      cell: (c) =>
        (byCreator.get(c.id) ?? []).map((a) => (
          <Link key={a.id} to={`${prefix}/creator-pipeline?brand=${encodeURIComponent(a.client_slug)}`} className="mr-2 underline">
            {brandNames.get(a.client_slug) ?? a.client_slug} ({stageLabel(a.stage)})
          </Link>
        )),
    },
  ];

  const check = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label className="flex h-10 items-center gap-1.5 text-sm"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}</label>
  );

  return (
    <PageShell wide data-testid="creators-page">
      <PageHeader title="Creators" description="The creator roster. Open a creator to edit their profile and see their clients and media." />
      <form className="flex flex-wrap items-end gap-2 rounded-card border bg-card p-3" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <TextField label="Name" aria-label="New creator name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <TextField label="Email" aria-label="New creator email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
        <Button type="submit" variant="outline" disabled={adding}>{adding ? "Adding..." : "Add creator"}</Button>
      </form>

      <FilterBar search={{ value: filters.search, onChange: (v) => set({ search: v }), label: "Search creators", placeholder: "Search name, email, location, category" }}>
        <SelectField label="Category" hideLabel value={filters.category} onChange={(e) => set({ category: e.target.value })} placeholder="Any category" options={CREATOR_CATEGORIES.map((c) => ({ value: c, label: c }))} />
        <SelectField label="Minimum scale" hideLabel value={filters.minScale === null ? "" : String(filters.minScale)} onChange={(e) => set({ minScale: e.target.value ? Number(e.target.value) : null })} placeholder="Any scale" options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n}+` }))} />
        <SelectField label="Gender" hideLabel value={filters.gender} onChange={(e) => set({ gender: e.target.value })} placeholder="Any gender" options={genders.map((g) => ({ value: g, label: g }))} />
        <SelectField label="Sort" hideLabel value={filters.sort} onChange={(e) => set({ sort: e.target.value as CreatorFilters["sort"] })} options={[{ value: "name", label: "Name" }, { value: "scale", label: "Scale, highest first" }, { value: "newest", label: "Newest first" }]} />
        {check("Trialed only", filters.trialedOnly, (v) => set({ trialedOnly: v }))}
        {check("Categories need review", filters.needsReviewOnly, (v) => set({ needsReviewOnly: v }))}
        {check("Show do not use", filters.showDoNotUse, (v) => set({ showDoNotUse: v }))}
      </FilterBar>

      {error && !creators ? <ErrorState message={error} onRetry={() => { setError(null); void load(); }} /> : error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {!creators ? (
        error ? null : <LoadingState label="Loading creators" />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="creators-count">
            {visible.length === creators.length ? `${creators.length} creators` : `${visible.length} of ${creators.length} creators`}
          </p>
          {visible.length === 0 ? (
            <EmptyState title="No creators match these filters." />
          ) : (
            <DataTable label="Creators" columns={columns} rows={paged.rows} rowKey={(c) => c.id} rowTestId={(c) => `creator-row-${c.id}`} />
          )}
          {paged.pages > 1 && (
            <nav aria-label="Pages" className="flex items-center gap-2 text-sm">
              <Button type="button" variant="outline" size="sm" disabled={paged.page <= 1} onClick={() => set({ page: paged.page - 1 })}>Previous</Button>
              <span>Page {paged.page} of {paged.pages}</span>
              <Button type="button" variant="outline" size="sm" disabled={paged.page >= paged.pages} onClick={() => set({ page: paged.page + 1 })}>Next</Button>
            </nav>
          )}
        </>
      )}
      <RecordModal open={!!openId} label="Creator" onClose={() => { navigate(hrefFor(null), { replace: true, preventScrollReset: true }); void load(); }}>
        {openId ? <CreatorDetailPage creatorId={openId} embedded /> : null}
      </RecordModal>
    </PageShell>
  );
}
