// Actors: staff page (consolidation step 5b, port of the old dashboard's
// Actors page). The production talent roster (actors) with search, gender,
// skill and dog-owner filters and sort kept in the address, 50 to a page.
// Each row links to the actor's page and lists the clients they are cast on.
// Staff add an actor by hand here; applicants become actors when an actor
// application is approved.
//
// Not ported: the profile-gap and age-band filters, sortable headers and the
// add-to-shoot dialog (casting moves with step 5c).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { DataTable, EmptyState, ErrorState, FilterBar, LoadingState, PageHeader, PageShell, SelectField, TextField, type DataColumn } from "@/components/page-kit";
import { useRolePrefix } from "@/hooks/useRolePath";
import { DashboardError, loadBrandsAndTeam, type BrandOption } from "./api";
import { createActor, loadActorRoster, type ActorCasting } from "./rosterApi";
import {
  actorFiltersFromParams,
  actorFiltersToParams,
  actorStageLabel,
  filterActors,
  genderOptions,
  paginate,
  skillOptions,
  sortActors,
  type ActorFilters,
  type RosterActor,
} from "./rosterModel";
import { errorText } from "./model";
import ActorDetailPage from "./ActorDetailPage";
import { RecordModal } from "./RecordModal";

export default function ActorsPage() {
  const prefix = useRolePrefix();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => actorFiltersFromParams(params), [params]);
  const [actors, setActors] = useState<RosterActor[] | null>(null);
  const [castings, setCastings] = useState<ActorCasting[]>([]);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [roster, base] = await Promise.all([loadActorRoster(), loadBrandsAndTeam()]);
      setActors(roster.actors);
      setCastings(roster.castings);
      setBrands(base.brands);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load actors.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // The open record lives in the address (?actor=), so the modal can be linked, and Back closes it.
  const hrefFor = (id: string | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set("actor", id);
    else p.delete("actor");
    const s = p.toString();
    return s ? `?${s}` : "?";
  };
  const openId = params.get("actor");

  const set = (patch: Partial<ActorFilters>) => setParams(actorFiltersToParams({ ...filters, page: 1, ...patch }), { replace: true });
  const brandNames = useMemo(() => new Map(brands.map((b) => [b.slug, b.name])), [brands]);
  const byActor = useMemo(() => {
    const m = new Map<string, ActorCasting[]>();
    for (const c of castings) m.set(c.actor_id, [...(m.get(c.actor_id) ?? []), c]);
    return m;
  }, [castings]);
  const genders = useMemo(() => genderOptions(actors ?? []), [actors]);
  const skills = useMemo(() => skillOptions(actors ?? []), [actors]);
  const visible = useMemo(() => sortActors(filterActors(actors ?? [], filters), filters.sort), [actors, filters]);
  const paged = paginate(visible, filters.page);

  const add = async () => {
    const name = newName.trim();
    if (!name) {
      setError("A name is required to add an actor.");
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const id = await createActor(name, newEmail.trim() || null);
      setNewName("");
      setNewEmail("");
      setAdding(false);
      await load();
      navigate(hrefFor(id));
    } catch (e) {
      setError(e instanceof DashboardError ? errorText(e.code, e.message) : "The actor was not added.");
      setAdding(false);
    }
  };

  const columns: DataColumn<RosterActor>[] = [
    {
      key: "actor",
      header: "Actor",
      cell: (a) => (
        <>
          <Link to={hrefFor(a.id)} preventScrollReset className="font-medium underline">{a.name}</Link>
          {a.do_not_use_again && <span className="ml-2 rounded bg-destructive/10 px-1 text-xs text-destructive">Do not use</span>}
        </>
      ),
    },
    { key: "gender", header: "Gender", cell: (a) => a.gender ?? "" },
    { key: "age", header: "Age range", cell: (a) => a.age_range.join(", ") },
    { key: "skills", header: "Skills", cell: (a) => a.skills.join(", ") },
    {
      key: "cast",
      header: "Cast on",
      cell: (a) =>
        (byActor.get(a.id) ?? []).map((c) => (
          <span key={c.id} className="mr-2">{brandNames.get(c.client_slug) ?? c.client_slug} ({actorStageLabel(c.stage)})</span>
        )),
    },
  ];

  return (
    <PageShell wide data-testid="actors-page">
      <PageHeader title="Actors" description="The production talent roster. Open an actor to edit their profile and see their castings and media." />
      <form className="flex flex-wrap items-end gap-2 rounded-card border bg-card p-3" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <TextField label="Name" aria-label="New actor name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <TextField label="Email" aria-label="New actor email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
        <Button type="submit" variant="outline" disabled={adding}>{adding ? "Adding..." : "Add actor"}</Button>
      </form>

      <FilterBar search={{ value: filters.search, onChange: (v) => set({ search: v }), label: "Search actors", placeholder: "Search name, email, phone, skill" }}>
        <SelectField label="Gender" hideLabel value={filters.gender} onChange={(e) => set({ gender: e.target.value })} placeholder="Any gender" options={genders.map((g) => ({ value: g, label: g }))} />
        <SelectField label="Skill" hideLabel value={filters.skill} onChange={(e) => set({ skill: e.target.value })} placeholder="Any skill" options={skills.map((s) => ({ value: s, label: s }))} />
        <SelectField label="Dog owner" hideLabel value={filters.dog} onChange={(e) => set({ dog: e.target.value as ActorFilters["dog"] })} placeholder="Dog owner: any" options={[{ value: "yes", label: "Dog owner: yes" }, { value: "no", label: "Dog owner: no" }]} />
        <SelectField label="Sort" hideLabel value={filters.sort} onChange={(e) => set({ sort: e.target.value as ActorFilters["sort"] })} options={[{ value: "name", label: "Name" }, { value: "newest", label: "Newest first" }]} />
        <label className="flex h-10 items-center gap-1.5 text-sm"><input type="checkbox" checked={filters.showDoNotUse} onChange={(e) => set({ showDoNotUse: e.target.checked })} /> Show do not use</label>
      </FilterBar>

      {error && !actors ? <ErrorState message={error} onRetry={() => { setError(null); void load(); }} /> : error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {!actors ? (
        error ? null : <LoadingState label="Loading actors" />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="actors-count">
            {visible.length === actors.length ? `${actors.length} actors` : `${visible.length} of ${actors.length} actors`}
          </p>
          {visible.length === 0 ? (
            <EmptyState title="No actors match these filters." />
          ) : (
            <DataTable label="Actors" columns={columns} rows={paged.rows} rowKey={(a) => a.id} rowTestId={(a) => `actor-row-${a.id}`} />
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
      <RecordModal open={!!openId} label="Actor" onClose={() => { navigate(hrefFor(null), { replace: true, preventScrollReset: true }); void load(); }}>
        {openId ? <ActorDetailPage actorId={openId} embedded /> : null}
      </RecordModal>
    </PageShell>
  );
}
