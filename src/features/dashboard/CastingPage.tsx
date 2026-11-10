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
import { Link } from "react-router-dom";
import { useSelectedClientSlug } from "@/contexts/ClientSelectionContext";
import { PickClientPrompt } from "@/components/PickClientPrompt";
import { Button } from "@/components/ui/button";
import { DataTable, EmptyState, ErrorState, LoadingState, PageHeader, PageShell, SelectField, TextField, useConfirm, type DataColumn } from "@/components/page-kit";
import { useRolePrefix } from "@/hooks/useRolePath";
import { DashboardError, loadBrandsAndTeam, type BrandOption } from "./api";
import { activeBoard, boardState, defaultExpiry, parseExpiry } from "./approvalBoardsModel";
import { addActors, applyActorVotes, createCastingLink, loadActorOptions, loadCasting, removeCasting, revokeCastingLink, updateCasting, type CastingData, type CastingPatch } from "./castingApi";
import { addableActors, castingUrl, sortCastings, splitActorVotes, stageCounts, type ActorOption, type CastingRow } from "./castingModel";
import { ACTOR_STAGES, actorStageLabel } from "./rosterModel";
import { errorText, formatDay, type AppUser } from "./model";

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof DashboardError) return e.code === "P0002" ? "An actor on this link is no longer cast on the client. Nothing was applied." : errorText(e.code, e.message || fallback);
  return e instanceof Error ? e.message : fallback;
}

export default function CastingPage() {
  const prefix = useRolePrefix();
  // The client comes from the one switcher at the top of the app (or the client hub address).
  const brand = useSelectedClientSlug();
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

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
      setLoadError(null);
    } catch (e) {
      setLoadError(messageOf(e, "Could not load castings."));
    }
  }, [brand]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

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
  const removeActor = async (r: CastingRow) => {
    const who = r.actors?.name ?? "this actor";
    if (!(await confirm({ title: `Take ${who} off ${brandName}?`, description: "Their votes on casting links go too.", actionLabel: "Remove" }))) return;
    void run(async () => { await removeCasting(r.id); return `${r.actors?.name ?? "Actor"} taken off ${brandName}.`; });
  };
  const revokeLink = async (id: string) => {
    if (!(await confirm({ title: `Revoke the ${brandName} casting link?`, description: "It stops working, and a new one can be made after.", actionLabel: "Revoke" }))) return;
    void run(async () => { await revokeCastingLink(id); return "Link revoked."; });
  };
  const applyDecisions = async (up: number, down: number, payload: { assignment_id: string; vote: "up" | "down" }[]) => {
    if (!(await confirm({ title: `Apply the client's decisions for ${brandName}?`, description: `${up} move to Client Approved and ${down} to Declined.`, actionLabel: "Apply", tone: "default" }))) return;
    void run(async () => { const n = await applyActorVotes(brand, payload); return `Applied ${n} decision${n === 1 ? "" : "s"}: ${up} approved, ${down} declined.`; });
  };
  const patch = (r: CastingRow, p: CastingPatch, what: string) => void run(async () => { await updateCasting(r.id, p); return `${r.actors?.name ?? "Actor"}: ${what}.`; });

  const columns: DataColumn<CastingRow>[] = [
    {
      key: "actor",
      header: "Actor",
      cell: (r) => (
        <>
          <Link to={`${prefix}/actors/${r.actor_id}`} className="font-medium underline">{r.actors?.name ?? "Unknown actor"}</Link>
          <div className="text-xs text-muted-foreground">{[r.actors?.gender, ...(r.actors?.age_range ?? [])].filter(Boolean).join(" · ")}</div>
          {r.actors?.do_not_use_again && <span className="rounded bg-muted px-1 text-xs font-medium">Do not use</span>}
        </>
      ),
    },
    {
      key: "stage",
      header: "Stage",
      cell: (r) => <SelectField label={`Stage for ${r.actors?.name ?? r.id}`} hideLabel value={r.stage} disabled={busy} onChange={(e) => { const v = e.target.value; patch(r, { stage: v }, `moved to ${actorStageLabel(v)}`); }} options={ACTOR_STAGES.map((st) => ({ value: st.value, label: st.label }))} />,
    },
    {
      key: "owner",
      header: "Owner",
      cell: (r) => <SelectField label={`Owner for ${r.actors?.name ?? r.id}`} hideLabel value={r.owner_id ?? ""} disabled={busy} onChange={(e) => { const v = e.target.value || null; patch(r, { owner_id: v }, "owner changed"); }} placeholder="No owner" options={users.filter((u) => u.active || u.id === r.owner_id).map((u) => ({ value: u.id, label: `${u.name}${u.active ? "" : " (inactive)"}` }))} />,
    },
    {
      key: "follow",
      header: "Follow up",
      cell: (r) => <TextField label={`Follow up for ${r.actors?.name ?? r.id}`} hideLabel type="date" value={r.next_follow_up_at ?? ""} disabled={busy} onChange={(e) => { const v = e.target.value || null; patch(r, { next_follow_up_at: v }, v ? `follow up ${formatDay(v)}` : "follow-up cleared"); }} />,
    },
    { key: "shoot", header: "Shoot", cell: (r) => `${r.scheduled_shoot_date ? formatDay(r.scheduled_shoot_date) : ""}${r.shoot_id ? "" : r.scheduled_shoot_date ? " (not on a shoot)" : ""}` },
    {
      key: "notes",
      header: "Notes",
      cell: (r) => (
        <>
          {r.notes ?? ""}
          <Button type="button" variant="link" size="sm" className="ml-1 h-auto p-0" disabled={busy} onClick={() => { const v = window.prompt(`Notes for ${r.actors?.name ?? "this actor"}`, r.notes ?? ""); if (v !== null) patch(r, { notes: v.trim() || null }, "notes saved"); }}>edit</Button>
        </>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      srOnlyHeader: true,
      cell: (r) => <Button type="button" variant="link" size="sm" className="h-auto p-0" disabled={busy} onClick={() => void removeActor(r)}>Remove</Button>,
    },
  ];

  return (
    <PageShell wide data-testid="casting-page">
      <PageHeader title="Casting" description="Actors cast per production client, and the casting link the client uses to approve them." />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {brand && <Link to={`${prefix}/clients/${encodeURIComponent(brand)}`} className="underline">Client page</Link>}
        <Link to={`${prefix}/production/calendar`} className="underline">Production calendar</Link>
        <Link to={`${prefix}/talent/actors`} className="underline">Actors</Link>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="old-dashboard-note">
        Public links still open on the old dashboard for now. Links you make or revoke here, and the votes shown here, reach clients once the public pages move over.
      </p>
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {!brand ? <PickClientPrompt what="its castings" /> : loadError ? (
        <ErrorState message={loadError} onRetry={() => void load()} />
      ) : !data ? (
        <LoadingState label="Loading castings" />
      ) : (
        <>
          <p className="text-xs text-muted-foreground" data-testid="stage-counts">
            {ACTOR_STAGES.filter((s) => counts.get(s.value)).map((s) => `${s.label} ${counts.get(s.value)}`).join(" · ") || "No actors cast yet."}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <SelectField label="Actor to add" hideLabel value={toAdd} onChange={(e) => setToAdd(e.target.value)} placeholder="Add an actor from the roster..." options={addable.map((a) => ({ value: a.id, label: a.name }))} />
            <Button type="button" size="sm" variant="outline" disabled={busy || !toAdd} onClick={() => { const id = toAdd; setToAdd(""); void run(async () => { await addActors(brand, [id]); return `${actors.find((a) => a.id === id)?.name ?? "Actor"} added to ${brandName} as Sourced.`; }); }}>Add</Button>
            <label><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show declined and passed</label>
          </div>

          {rows.length === 0 ? (
            <EmptyState title="No castings to show." />
          ) : (
            <DataTable label="Castings" columns={columns} rows={rows} rowKey={(r) => r.id} rowTestId={(r) => `casting-${r.id}`} minWidthClass="min-w-[56rem]" />
          )}
          {activeUsers.length === 0 && <p className="text-xs text-muted-foreground">No one is on the dashboard team list, so owners cannot be set yet.</p>}

          <section aria-label="Casting link" className="rounded-lg border p-3 text-sm">
            <h2 className="font-semibold">Casting link</h2>
            {live ? (
              <div className="mt-1 flex flex-wrap items-center gap-2" data-testid="live-link">
                <a href={castingUrl(live.token)} target="_blank" rel="noopener noreferrer" className="break-all underline">{castingUrl(live.token)}</a>
                <span className="text-xs text-muted-foreground">expires {formatDay(live.expires_at)}</span>
                <Button type="button" size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(castingUrl(live.token)).then(() => setNotice("Link copied."), () => setNotice(`Copy the link: ${castingUrl(live.token)}`))}>Copy link</Button>
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void revokeLink(live.id)}>Revoke</Button>
              </div>
            ) : (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">No live casting link for {brandName}.</span>
                <TextField label="Expiry date" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => {
                  const at = parseExpiry(expiry, new Date());
                  if (!at) { setError("Pick an expiry date in the future."); return; }
                  void run(async () => { await createCastingLink(brand, at); return `New casting link created for ${brandName}.`; });
                }}>Create link</Button>
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
                    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void applyDecisions(responses.approved.length, responses.passed.length, liveVotes.map((v) => ({ assignment_id: v.assignment_id, vote: v.vote })))}>Apply decisions</Button>
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
      {dialog}
    </PageShell>
  );
}
