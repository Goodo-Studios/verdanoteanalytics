// Production calendar: staff page (consolidation step 5c, port of the old
// dashboard's /production/calendar). Shoots for one month, grouped by day.
// Each shoot shows its client, location (a linked location or typed text),
// notes, the talent confirmed onto it and its schedule blocks with the talent
// and crew called for each block, and whether a call sheet exists. Staff
// schedule, edit and delete shoots, confirm and remove talent, and add, edit
// and delete blocks, all through the checked functions. Casting itself is on
// the Casting page and call sheets on the Call sheets page.
// Not ported: the month grid view and the Google Calendar sync.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { useRolePrefix } from "@/hooks/useRolePath";
import { DashboardError, loadBrandsAndTeam, type BrandOption } from "./api";
import { confirmTalent, createBlock, createShoot, deleteBlock, deleteShoot, loadCalendar, unconfirmTalent, updateBlock, updateShoot, type CalendarData } from "./productionApi";
import {
  EMPTY_BLOCK_FORM,
  EMPTY_SHOOT_FORM,
  blockToForm,
  callSheetState,
  formToBlockArgs,
  formToShootArgs,
  formatTime,
  groupByDate,
  monthLabel,
  monthRange,
  parseMonth,
  shiftMonth,
  shootToForm,
  sortBlocks,
  type BlockForm,
  type Casting,
  type Option,
  type Shoot,
  type ShootBlock,
  type ShootForm,
} from "./productionModel";
import { errorText, formatDay } from "./model";

const CTRL = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof DashboardError) return e.code === "42501" ? errorText(e.code, fallback) : e.message || fallback;
  return e instanceof Error ? e.message : fallback;
}

function ShootEditor({ initial, title, busy, brands, locations, fixedClient, onSave, onCancel }: {
  initial: ShootForm; title: string; busy: boolean; brands: BrandOption[]; locations: Option[]; fixedClient: boolean; onSave: (f: ShootForm) => void; onCancel: () => void;
}) {
  const [form, setForm] = useState(initial);
  const set = (patch: Partial<ShootForm>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <form aria-label={title} className="space-y-2 rounded-lg border p-3" onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-xs">Client
          <select aria-label="Shoot client" disabled={fixedClient} className={`${CTRL} mt-0.5 w-full`} value={form.client_slug} onChange={(e) => set({ client_slug: e.target.value })}>
            <option value="">Pick a client</option>
            {brands.filter((b) => b.active || b.slug === form.client_slug).map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
          </select>
        </label>
        <label className="text-xs">Date<input aria-label="Shoot date" type="date" className={`${CTRL} mt-0.5 w-full`} value={form.shoot_date} onChange={(e) => set({ shoot_date: e.target.value })} /></label>
        <label className="text-xs">Location
          <select aria-label="Shoot location" className={`${CTRL} mt-0.5 w-full`} value={form.location_id} onChange={(e) => set({ location_id: e.target.value })}>
            <option value="">Typed below, or none</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        {!form.location_id && <label className="text-xs">Typed location<input aria-label="Typed location" className={`${CTRL} mt-0.5 w-full`} value={form.location} onChange={(e) => set({ location: e.target.value })} /></label>}
        <label className="text-xs sm:col-span-2">Notes<input aria-label="Shoot notes" className={`${CTRL} mt-0.5 w-full`} value={form.notes} onChange={(e) => set({ notes: e.target.value })} /></label>
      </div>
      <div className="flex gap-2">
        <button type="submit" className={CTRL} disabled={busy}>{busy ? "Saving..." : "Save shoot"}</button>
        <button type="button" className={CTRL} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function BlockEditor({ initial, busy, talent, crew, onSave, onCancel }: {
  initial: BlockForm; busy: boolean; talent: Casting[]; crew: Option[]; onSave: (f: BlockForm) => void; onCancel: () => void;
}) {
  const [form, setForm] = useState(initial);
  const set = (patch: Partial<BlockForm>) => setForm((f) => ({ ...f, ...patch }));
  const toggle = (key: "talent" | "crew", id: string) => set({ [key]: form[key].includes(id) ? form[key].filter((x) => x !== id) : [...form[key], id] } as Partial<BlockForm>);
  return (
    <form aria-label="Schedule block" className="mt-2 space-y-2 rounded border p-2" onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      <div className="flex flex-wrap gap-2">
        <input aria-label="Block label" placeholder="Label, for example Kitchen scenes" className={CTRL} value={form.label} onChange={(e) => set({ label: e.target.value })} />
        <input aria-label="Block start" type="time" className={CTRL} value={form.start_time} onChange={(e) => set({ start_time: e.target.value })} />
        <input aria-label="Block end" type="time" className={CTRL} value={form.end_time} onChange={(e) => set({ end_time: e.target.value })} />
        <input aria-label="Block location" placeholder="Room or spot" className={CTRL} value={form.location} onChange={(e) => set({ location: e.target.value })} />
        <input aria-label="Block notes" placeholder="Notes" className={CTRL} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
      </div>
      <div className="text-xs">Talent called: {talent.length === 0 ? <span className="text-muted-foreground">confirm talent onto the shoot first</span> : talent.map((t) => (
        <label key={t.id} className="mr-3"><input type="checkbox" checked={form.talent.includes(t.id)} onChange={() => toggle("talent", t.id)} /> {t.actors?.name ?? "Actor"}</label>
      ))}</div>
      <div className="text-xs">Crew called: {crew.map((c) => (
        <label key={c.id} className="mr-3"><input type="checkbox" checked={form.crew.includes(c.id)} onChange={() => toggle("crew", c.id)} /> {c.name}</label>
      ))}</div>
      <div className="flex gap-2">
        <button type="submit" className={CTRL} disabled={busy}>Save block</button>
        <button type="button" className={CTRL} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function ProductionCalendarPage() {
  const prefix = useRolePrefix();
  const [params, setParams] = useSearchParams();
  const month = parseMonth(params.get("month"), new Date());
  const [data, setData] = useState<CalendarData | null>(null);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingShoot, setEditingShoot] = useState<string | null>(null);
  const [editingBlock, setEditingBlock] = useState<{ shootId: string; block: ShootBlock | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { from, to } = monthRange(month);
    try {
      setData(await loadCalendar(from, to));
    } catch (e) {
      setError(messageOf(e, "Could not load shoots."));
    }
  }, [month]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);
  useEffect(() => {
    loadBrandsAndTeam().then((b) => setBrands(b.brands), () => setBrands([]));
  }, []);

  const names = useMemo(() => new Map(brands.map((b) => [b.slug, b.name])), [brands]);
  const crewName = useMemo(() => new Map((data?.crew ?? []).map((c) => [c.id, c.name])), [data]);
  const days = useMemo(() => groupByDate(data?.shoots ?? []), [data]);
  const castingsOf = (s: Shoot) => (data?.castings ?? []).filter((c) => c.client_slug === s.client_slug);
  const goMonth = (m: string) => setParams({ month: m }, { replace: true });

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

  const saveShoot = (form: ShootForm, id: string | null) => {
    let args;
    try {
      args = formToShootArgs(form);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check the form.");
      return;
    }
    void run(async () => {
      if (id) await updateShoot(id, args);
      else await createShoot(args);
      return `Shoot saved for ${names.get(args.p_client_slug) ?? args.p_client_slug} on ${formatDay(args.p_shoot_date)}.`;
    }).then((ok) => {
      if (!ok) return;
      setAdding(false);
      setEditingShoot(null);
      if (args.p_shoot_date.slice(0, 7) !== month) goMonth(args.p_shoot_date.slice(0, 7));
    });
  };

  const saveBlock = (form: BlockForm) => {
    if (!editingBlock) return;
    let args;
    try {
      args = formToBlockArgs(form);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check the block.");
      return;
    }
    const target = editingBlock;
    void run(async () => {
      if (target.block) await updateBlock(target.block.id, args);
      else await createBlock(target.shootId, args);
      return `Block "${args.p_label}" saved.`;
    }).then((ok) => { if (ok) setEditingBlock(null); });
  };

  return (
    <div className="p-6 space-y-4" data-testid="production-calendar-page">
      <PageHeader title="Production calendar" description="Booked shoots by day: location, confirmed talent, schedule blocks and call sheets." />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" className={CTRL} onClick={() => goMonth(shiftMonth(month, -1))}>Previous month</button>
        <span className="font-semibold" data-testid="calendar-month">{monthLabel(month)}</span>
        <button type="button" className={CTRL} onClick={() => goMonth(shiftMonth(month, 1))}>Next month</button>
        <Link to={`${prefix}/call-sheets`} className="underline">Call sheets</Link>
        <Link to={`${prefix}/locations`} className="underline">Locations</Link>
        <Link to={`${prefix}/crew`} className="underline">Crew</Link>
      </div>
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {adding ? (
        <ShootEditor initial={EMPTY_SHOOT_FORM} title="Schedule a shoot" busy={busy} brands={brands} locations={data?.locations ?? []} fixedClient={false} onSave={(f) => saveShoot(f, null)} onCancel={() => setAdding(false)} />
      ) : (
        <button type="button" className={CTRL} onClick={() => { setAdding(true); setError(null); setNotice(null); }}>Schedule a shoot</button>
      )}

      {!data ? (
        error ? null : <p role="status" className="text-sm text-muted-foreground">Loading shoots...</p>
      ) : days.length === 0 ? <p className="text-sm text-muted-foreground">No shoots in {monthLabel(month)}.</p> : (
        days.map(([date, shoots]) => (
          <section key={date} aria-label={formatDay(date)} className="space-y-2">
            <h2 className="text-sm font-semibold">{formatDay(date)}</h2>
            {shoots.map((s) => {
              const castings = castingsOf(s);
              const confirmed = castings.filter((c) => c.shoot_id === s.id);
              const available = castings.filter((c) => c.shoot_id !== s.id && !["declined", "passed"].includes(c.stage));
              const talentName = new Map(confirmed.map((c) => [c.id, c.actors?.name ?? "Actor"]));
              const sheet = callSheetState(s);
              return (
                <article key={s.id} className="rounded-lg border p-3 text-sm" data-testid={`shoot-${s.id}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`${prefix}/clients/${encodeURIComponent(s.client_slug)}`} className="font-semibold underline">{names.get(s.client_slug) ?? s.client_slug}</Link>
                    <span className="text-muted-foreground">{s.location ?? "No location yet"}</span>
                    <span className="text-xs">{sheet === "live" ? "Call sheet made" : sheet === "revoked" ? "Call sheet revoked" : "No call sheet"}</span>
                    <button type="button" className="text-xs underline" onClick={() => setEditingShoot(s.id)}>Edit shoot</button>
                    <button type="button" className="text-xs underline" disabled={busy} onClick={() => {
                      if (!window.confirm(`Delete the ${names.get(s.client_slug) ?? s.client_slug} shoot on ${formatDay(s.shoot_date)}? Its schedule blocks and call sheet go with it.`)) return;
                      void run(async () => { await deleteShoot(s.id); return "Shoot deleted."; });
                    }}>Delete shoot</button>
                  </div>
                  {s.notes && <p className="text-xs text-muted-foreground">{s.notes}</p>}
                  {editingShoot === s.id && (
                    <ShootEditor initial={shootToForm(s)} title="Edit shoot" busy={busy} brands={brands} locations={data.locations} fixedClient onSave={(f) => saveShoot(f, s.id)} onCancel={() => setEditingShoot(null)} />
                  )}

                  <div className="mt-2 text-xs">
                    <span className="font-semibold">Talent: </span>
                    {confirmed.length === 0 ? <span className="text-muted-foreground">none confirmed. </span> : confirmed.map((c) => (
                      <span key={c.id} className="mr-3">
                        <Link to={`${prefix}/actors/${c.actor_id}`} className="underline">{c.actors?.name ?? "Actor"}</Link>
                        <button type="button" aria-label={`Remove ${c.actors?.name ?? "actor"} from the shoot`} className="ml-1 underline" disabled={busy} onClick={() => void run(async () => { await unconfirmTalent(c.id); return `${c.actors?.name ?? "Actor"} removed from the shoot.`; })}>remove</button>
                      </span>
                    ))}
                    {available.length > 0 && (
                      <select aria-label={`Confirm talent for ${s.id}`} className={CTRL} value="" disabled={busy} onChange={(e) => { const id = e.target.value; const c = available.find((x) => x.id === id); if (c) void run(async () => { await confirmTalent(c.id, s.id); return `${c.actors?.name ?? "Actor"} confirmed for the shoot.`; }); }}>
                        <option value="">Confirm a cast actor...</option>
                        {available.map((c) => <option key={c.id} value={c.id}>{c.actors?.name ?? "Actor"} ({c.stage.replace(/_/g, " ")})</option>)}
                      </select>
                    )}
                  </div>

                  <div className="mt-2">
                    <div className="text-xs font-semibold">Schedule</div>
                    {s.shoot_schedule_blocks.length === 0 ? <p className="text-xs text-muted-foreground">No blocks yet.</p> : (
                      <ul className="text-xs">
                        {sortBlocks(s.shoot_schedule_blocks).map((b) => (
                          <li key={b.id} className="border-t py-1" data-testid={`block-${b.id}`}>
                            <span className="font-medium">{formatTime(b.start_time)} to {formatTime(b.end_time)} · {b.label}</span>
                            {b.location && <span> · {b.location}</span>}
                            {b.shoot_schedule_block_talent.length > 0 && <span> · Talent: {b.shoot_schedule_block_talent.map((t) => talentName.get(t.actor_assignment_id) ?? "removed actor").join(", ")}</span>}
                            {b.shoot_schedule_block_crew.length > 0 && <span> · Crew: {b.shoot_schedule_block_crew.map((c) => crewName.get(c.crew_member_id) ?? "archived crew").join(", ")}</span>}
                            {b.notes && <div className="text-muted-foreground">{b.notes}</div>}
                            <button type="button" className="mr-2 underline" onClick={() => setEditingBlock({ shootId: s.id, block: b })}>Edit</button>
                            <button type="button" className="underline" disabled={busy} onClick={() => { if (window.confirm(`Delete the block "${b.label}"?`)) void run(async () => { await deleteBlock(b.id); return "Block deleted."; }); }}>Delete</button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {editingBlock?.shootId === s.id ? (
                      <BlockEditor key={editingBlock.block?.id ?? "new"} initial={editingBlock.block ? blockToForm(editingBlock.block) : EMPTY_BLOCK_FORM} busy={busy} talent={confirmed} crew={data.crew} onSave={saveBlock} onCancel={() => setEditingBlock(null)} />
                    ) : (
                      <button type="button" className="mt-1 text-xs underline" onClick={() => setEditingBlock({ shootId: s.id, block: null })}>Add block</button>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        ))
      )}
    </div>
  );
}
