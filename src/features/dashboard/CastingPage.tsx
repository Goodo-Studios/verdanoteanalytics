// Casting: staff page (consolidation step 5c, port of the old dashboard's
// /production/casting and its actor approval panel). Per production client:
// every actor cast on it by stage, with owner, follow-up date, notes and the
// booked shoot date; add actors from the roster, change stage, owner,
// follow-up and notes, take an actor off the client after a confirm. Below,
// the client's casting link: the live link (served by the old dashboard) with
// copy and revoke, a new link with an expiry when none is live, the client's
// thumbs up and down, Apply decisions through apply_actor_approval_votes, and
// past links. Booking onto a shoot is on the Production calendar.
//
// This is the one talent and casting flow: Goodo OS talent profiles and talent
// approvals pointed at these same actors and casting links. The page a client
// opens (/cast/<token>) reads the old dashboard's database until the release;
// the page says so. Not ported: the casting follow-ups list (removed from the
// old dashboard) and the card board view.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { useRolePrefix } from "@/hooks/useRolePath";
import { DashboardError, loadBrandsAndTeam, type BrandOption } from "./api";
import { activeBoard, boardState, defaultExpiry, parseExpiry } from "./approvalBoardsModel";
import { addActors, applyActorVotes, createCastingLink, loadActorOptions, loadCasting, removeCasting, revokeCastingLink, updateCasting, type CastingData, type CastingPatch } from "./castingApi";
import { addableActors, castingUrl, sortCastings, splitActorVotes, stageCounts, type ActorOption, type CastingRow } from "./castingModel";
import { ACTOR_STAGES, actorStageLabel } from "./rosterModel";
import { errorText, formatDay, type AppUser } from "./model";

const CTRL = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof DashboardError) return e.code === "P0002" ? "An actor on this link is no longer cast on the client. Nothing was applied." : errorText(e.code, e.message || fallback);
  return e instanceof Error ? e.message : fallback;
}

export default function CastingPage() {
  const prefix = useRolePrefix();
  const [params, setParams] = useSearchParams();
  const brand = params.get("brand") ?? "";
  const [now] = useState(() => new Date());
  const [brands, setBrands] = useState<BrandOption[] | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [actors, setActors] = useState<ActorOption[]>([]);
  const [data, setData] = useState<CastingData | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [toAdd, setToAdd] = useState("");
  const [expiry, setExpiry] = useState(() => defaultExpiry(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    loadBrandsAndTeam().then((b) => { setBrands(b.brands); setUsers(b.users); }, (e) => setError(e instanceof Error ? e.message : "Could not load clients."));
    loadActorOptions().then(setActors, () => setActors([]));
  }, []);

  const load = useCallback(async () => {
    if (!brand) {
      setData(null);
      return;
    }
    try {
      setData(await loadCasting(brand));
    } catch (e) {
      setError(messageOf(e, "Could not load castings."));
    }
  }, [brand]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  const productionBrands = useMemo(() => (brands ?? []).filter((b) => (b.does_production ?? true) && (b.active || b.slug === brand)), [brands, brand]);
  const brandName = brands?.find((b) => b.slug === brand)?.name ?? brand;
  const rows = useMemo(() => sortCastings(data?.castings ?? [], showClosed), [data, showClosed]);
  const counts = useMemo(() => stageCounts(data?.castings ?? []), [data]);
  const addable = useMemo(() => addableActors(actors, data?.castings ?? []), [actors, data]);
  const live = data ? activeBoard(data.boards, now) : null;
  const past = (data?.boards ?? []).filter((b) => b.id !== live?.id);
  const liveVotes = useMemo(() => (live ? (data?.votes ?? []).filter((v) => v.board_id === live.id) : []), [data, live]);
  const responses = useMemo(() => splitActorVotes(liveVotes, data?.castings ?? []), [liveVotes, data]);
  const activeUsers = users.filter((u) => u.active);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await fn());
    } catch (e) {
      setError(messageOf(e, "The change could not be saved."));
    }
    setBusy(false);
    await load();
  };
  const patch = (r: CastingRow, p: CastingPatch, what: string) => void run(async () => { await updateCasting(r.id, p); return `${r.actors?.name ?? "Actor"}: ${what}.`; });

  return (
    <div className="p-6 space-y-4" data-testid="casting-page">
      <PageHeader title="Casting" description="Actors cast per production client, and the casting link the client uses to approve them." />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select aria-label="Client" className={CTRL} value={brand} onChange={(e) => { setParams(e.target.value ? { brand: e.target.value } : {}, { replace: true }); setNotice(null); setError(null); }}>
          <option value="">Choose a production client</option>
          {productionBrands.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
        </select>
        {brand && <Link to={`${prefix}/clients/${encodeURIComponent(brand)}`} className="underline">Client page</Link>}
        <Link to={`${prefix}/production-calendar`} className="underline">Production calendar</Link>
        <Link to={`${prefix}/actors`} className="underline">Actors</Link>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="old-dashboard-note">
        Public links still open on the old dashboard for now. Links you make or revoke here, and the votes shown here, reach clients once the public pages move over.
      </p>
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {!brand ? <p className="text-sm text-muted-foreground">Choose a client to see its castings.</p> : !data ? (
        error ? null : <p role="status" className="text-sm text-muted-foreground">Loading castings...</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground" data-testid="stage-counts">
            {ACTOR_STAGES.filter((s) => counts.get(s.value)).map((s) => `${s.label} ${counts.get(s.value)}`).join(" · ") || "No actors cast yet."}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <select aria-label="Actor to add" className={CTRL} value={toAdd} onChange={(e) => setToAdd(e.target.value)}>
              <option value="">Add an actor from the roster...</option>
              {addable.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button type="button" className={CTRL} disabled={busy || !toAdd} onClick={() => { const id = toAdd; setToAdd(""); void run(async () => { await addActors(brand, [id]); return `${actors.find((a) => a.id === id)?.name ?? "Actor"} added to ${brandName} as Sourced.`; }); }}>Add</button>
            <label><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show declined and passed</label>
          </div>

          {rows.length === 0 ? <p className="text-sm text-muted-foreground">No castings to show.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th>Actor</th><th>Stage</th><th>Owner</th><th>Follow up</th><th>Shoot</th><th>Notes</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t align-top" data-testid={`casting-${r.id}`}>
                    <td className="py-1.5">
                      <Link to={`${prefix}/actors/${r.actor_id}`} className="font-medium underline">{r.actors?.name ?? "Unknown actor"}</Link>
                      <div className="text-xs text-muted-foreground">{[r.actors?.gender, ...(r.actors?.age_range ?? [])].filter(Boolean).join(" · ")}</div>
                      {r.actors?.do_not_use_again && <span className="rounded bg-destructive/10 px-1 text-xs text-destructive">Do not use</span>}
                    </td>
                    <td>
                      <select aria-label={`Stage for ${r.actors?.name ?? r.id}`} className={CTRL} value={r.stage} disabled={busy} onChange={(e) => { const v = e.target.value; patch(r, { stage: v }, `moved to ${actorStageLabel(v)}`); }}>
                        {ACTOR_STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </td>
                    <td>
                      <select aria-label={`Owner for ${r.actors?.name ?? r.id}`} className={CTRL} value={r.owner_id ?? ""} disabled={busy} onChange={(e) => { const v = e.target.value || null; patch(r, { owner_id: v }, "owner changed"); }}>
                        <option value="">No owner</option>
                        {users.filter((u) => u.active || u.id === r.owner_id).map((u) => <option key={u.id} value={u.id}>{u.name}{u.active ? "" : " (inactive)"}</option>)}
                      </select>
                    </td>
                    <td><input aria-label={`Follow up for ${r.actors?.name ?? r.id}`} type="date" className={CTRL} value={r.next_follow_up_at ?? ""} disabled={busy} onChange={(e) => { const v = e.target.value || null; patch(r, { next_follow_up_at: v }, v ? `follow up ${formatDay(v)}` : "follow-up cleared"); }} /></td>
                    <td className="text-xs">{r.scheduled_shoot_date ? formatDay(r.scheduled_shoot_date) : ""}{r.shoot_id ? "" : r.scheduled_shoot_date ? " (not on a shoot)" : ""}</td>
                    <td className="text-xs">
                      {r.notes ?? ""}
                      <button type="button" className="ml-1 underline" disabled={busy} onClick={() => { const v = window.prompt(`Notes for ${r.actors?.name ?? "this actor"}`, r.notes ?? ""); if (v !== null) patch(r, { notes: v.trim() || null }, "notes saved"); }}>edit</button>
                    </td>
                    <td className="text-xs">
                      <button type="button" className="underline" disabled={busy} onClick={() => {
                        if (!window.confirm(`Take ${r.actors?.name ?? "this actor"} off ${brandName}? Their votes on casting links go too.`)) return;
                        void run(async () => { await removeCasting(r.id); return `${r.actors?.name ?? "Actor"} taken off ${brandName}.`; });
                      }}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {activeUsers.length === 0 && <p className="text-xs text-muted-foreground">No one is on the dashboard team list, so owners cannot be set yet.</p>}

          <section aria-label="Casting link" className="rounded-lg border p-3 text-sm">
            <h2 className="font-semibold">Casting link</h2>
            {live ? (
              <div className="mt-1 flex flex-wrap items-center gap-2" data-testid="live-link">
                <a href={castingUrl(live.token)} target="_blank" rel="noopener noreferrer" className="break-all underline">{castingUrl(live.token)}</a>
                <span className="text-xs text-muted-foreground">expires {formatDay(live.expires_at)}</span>
                <button type="button" className={CTRL} onClick={() => void navigator.clipboard?.writeText(castingUrl(live.token)).then(() => setNotice("Link copied."), () => setNotice(`Copy the link: ${castingUrl(live.token)}`))}>Copy link</button>
                <button type="button" className={CTRL} disabled={busy} onClick={() => { if (window.confirm(`Revoke the ${brandName} casting link? It stops working, and a new one can be made after.`)) void run(async () => { await revokeCastingLink(live.id); return "Link revoked."; }); }}>Revoke</button>
              </div>
            ) : (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">No live casting link for {brandName}.</span>
                <label className="text-xs">Expires<input aria-label="Expiry date" type="date" className={`${CTRL} ml-1`} value={expiry} onChange={(e) => setExpiry(e.target.value)} /></label>
                <button type="button" className={CTRL} disabled={busy} onClick={() => {
                  const at = parseExpiry(expiry, new Date());
                  if (!at) { setError("Pick an expiry date in the future."); return; }
                  void run(async () => { await createCastingLink(brand, at); return `New casting link created for ${brandName}.`; });
                }}>Create link</button>
              </div>
            )}
            {live && (
              <div className="mt-2 space-y-2">
                {liveVotes.length === 0 ? <p className="text-muted-foreground">No responses yet.</p> : (
                  <>
                    <div className="flex flex-wrap gap-3">
                      {(["approved", "passed"] as const).map((k) => (
                        <section key={k} aria-label={k === "approved" ? "Approved" : "Passed on"} className="flex-1 rounded border p-2">
                          <h3 className="text-xs font-semibold">{k === "approved" ? "Approved" : "Passed on"} ({responses[k].length})</h3>
                          <ul className="text-xs">
                            {responses[k].map((v) => (
                              <li key={v.id} data-testid={`vote-${v.id}`}>
                                {v.row ? <Link to={`${prefix}/actors/${v.row.actor_id}`} className="underline">{v.row.actors?.name ?? "Actor"}</Link> : "Actor no longer cast"}
                                <span className="text-muted-foreground"> · {formatDay(v.voted_at)}{v.voted_by ? ` · ${v.voted_by} (name typed by the reviewer)` : ""}</span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      ))}
                    </div>
                    <button type="button" className={CTRL} disabled={busy} onClick={() => {
                      const up = responses.approved.length;
                      const down = responses.passed.length;
                      if (!window.confirm(`Apply the client's decisions for ${brandName}? ${up} move to Client Approved and ${down} to Declined.`)) return;
                      void run(async () => { const n = await applyActorVotes(brand, liveVotes.map((v) => ({ assignment_id: v.assignment_id, vote: v.vote }))); return `Applied ${n} decision${n === 1 ? "" : "s"}: ${up} approved, ${down} declined.`; });
                    }}>Apply decisions</button>
                  </>
                )}
              </div>
            )}
            <h3 className="mt-2 text-xs font-semibold">Past links ({past.length})</h3>
            <ul className="text-xs">
              {past.map((b) => <li key={b.id} data-testid={`past-${b.id}`}>Made {formatDay(b.created_at)}, {boardState(b, now) === "revoked" ? "revoked" : `expired ${formatDay(b.expires_at)}`}</li>)}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
