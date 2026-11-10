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
import { PageHeader } from "@/components/PageHeader";
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

const CTRL = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

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
      navigate(`${prefix}/actors/${id}`);
    } catch (e) {
      setError(e instanceof DashboardError ? errorText(e.code, e.message) : "The actor was not added.");
      setAdding(false);
    }
  };

  return (
    <div className="p-6 space-y-4" data-testid="actors-page">
      <PageHeader title="Actors" description="The production talent roster. Open an actor to edit their profile and see their castings and media." />
      <form className="flex flex-wrap items-end gap-2 rounded-lg border p-3" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <label className="text-xs">Name<input aria-label="New actor name" className={`${CTRL} ml-1`} value={newName} onChange={(e) => setNewName(e.target.value)} /></label>
        <label className="text-xs">Email<input aria-label="New actor email" type="email" className={`${CTRL} ml-1`} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} /></label>
        <button type="submit" className={CTRL} disabled={adding}>{adding ? "Adding..." : "Add actor"}</button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Search actors" placeholder="Search name, email, phone, skill" className={`${CTRL} min-w-[16rem]`} value={filters.search} onChange={(e) => set({ search: e.target.value })} />
        <select aria-label="Gender" className={CTRL} value={filters.gender} onChange={(e) => set({ gender: e.target.value })}>
          <option value="">Any gender</option>
          {genders.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select aria-label="Skill" className={CTRL} value={filters.skill} onChange={(e) => set({ skill: e.target.value })}>
          <option value="">Any skill</option>
          {skills.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Dog owner" className={CTRL} value={filters.dog} onChange={(e) => set({ dog: e.target.value as ActorFilters["dog"] })}>
          <option value="">Dog owner: any</option>
          <option value="yes">Dog owner: yes</option>
          <option value="no">Dog owner: no</option>
        </select>
        <select aria-label="Sort" className={CTRL} value={filters.sort} onChange={(e) => set({ sort: e.target.value as ActorFilters["sort"] })}>
          <option value="name">Name</option>
          <option value="newest">Newest first</option>
        </select>
        <label className="text-sm"><input type="checkbox" checked={filters.showDoNotUse} onChange={(e) => set({ showDoNotUse: e.target.checked })} /> Show do not use</label>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!actors ? (
        error ? null : <p role="status" className="text-sm text-muted-foreground">Loading actors...</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="actors-count">
            {visible.length === actors.length ? `${actors.length} actors` : `${visible.length} of ${actors.length} actors`}
          </p>
          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">No actors match these filters.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground"><th>Actor</th><th>Gender</th><th>Age range</th><th>Skills</th><th>Cast on</th></tr>
              </thead>
              <tbody>
                {paged.rows.map((a) => (
                  <tr key={a.id} className="border-t align-top" data-testid={`actor-row-${a.id}`}>
                    <td className="py-1.5">
                      <Link to={`${prefix}/actors/${a.id}`} className="font-medium underline">{a.name}</Link>
                      {a.do_not_use_again && <span className="ml-2 rounded bg-destructive/10 px-1 text-xs text-destructive">Do not use</span>}
                    </td>
                    <td className="text-xs">{a.gender ?? ""}</td>
                    <td className="text-xs">{a.age_range.join(", ")}</td>
                    <td className="text-xs">{a.skills.join(", ")}</td>
                    <td className="text-xs">
                      {(byActor.get(a.id) ?? []).map((c) => (
                        <span key={c.id} className="mr-2">{brandNames.get(c.client_slug) ?? c.client_slug} ({actorStageLabel(c.stage)})</span>
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
