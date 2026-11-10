// Creator pipeline: staff page (consolidation step 5a, port of the old
// dashboard's Pipeline page). Creators assigned to a brand (creator_assignments)
// on a board by stage, or as a list. Staff move a creator's stage, set the
// owner and the next follow-up date, record tracking and delivery, add
// creators from the roster and take them off a brand. Moving the stage lets
// the database stage rule set the next follow-up.
//
// Not the Content Pipeline: /pipeline shows the ClickUp asset board and is
// unchanged. Approval board links (public links sent to clients) stay on the
// old dashboard; their staff side moves with step 5b.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { useRolePrefix } from "@/hooks/useRolePath";
import {
  DashboardError,
  addCreatorsToBrand,
  loadAssignments,
  loadBrandsAndTeam,
  loadCreatorOptions,
  removeAssignment,
  saveDelivery,
  updateAssignment,
  type AssignmentPatch,
  type BrandOption,
} from "./api";
import {
  ALL_BRANDS,
  DELIVERY_STAGES,
  STAGES,
  TERMINAL_STAGES,
  addableCreators,
  boardColumns,
  creatorName,
  errorText,
  formatDay,
  groupByStage,
  ownerName,
  ownerOptions,
  searchAssignments,
  stageIndex,
  stageLabel,
  type AppUser,
  type Assignment,
  type CreatorOption,
  type StageScope,
} from "./model";

export const OLD_DASHBOARD_URL = "https://goodostudios-production.vercel.app";
const SELECT = "rounded-md border border-input bg-background px-2 py-1 text-xs";

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof DashboardError) return e.code === "22023" ? e.message : errorText(e.code, e.message || fallback);
  return e instanceof Error ? e.message : fallback;
}

function DeliveryFields({ a, onSaved, onError }: { a: Assignment; onSaved: () => void; onError: (m: string) => void }) {
  const [tracking, setTracking] = useState(a.tracking_number ?? "");
  const [delivered, setDelivered] = useState(a.product_delivered_at ?? "");
  const save = async () => {
    try {
      await saveDelivery(a.id, tracking.trim() || null, delivered || null);
      onSaved();
    } catch (e) {
      onError(messageOf(e, "Tracking could not be saved."));
    }
  };
  return (
    <div className="mt-2 space-y-1 border-t pt-2">
      <input aria-label={`Tracking number for ${creatorName(a)}`} className={`${SELECT} w-full`} placeholder="Tracking number" value={tracking} onChange={(e) => setTracking(e.target.value)} />
      <input aria-label={`Delivered on for ${creatorName(a)}`} type="date" className={`${SELECT} w-full`} value={delivered} onChange={(e) => setDelivered(e.target.value)} />
      <button type="button" className="text-xs underline" onClick={() => void save()}>Save delivery</button>
    </div>
  );
}

function AssignmentCard({ a, users, brandName, canRemove, onPatch, onRemove, onSaved, onError }: {
  a: Assignment;
  users: AppUser[];
  brandName: string | null;
  canRemove: boolean;
  onPatch: (a: Assignment, patch: AssignmentPatch) => void;
  onRemove: (a: Assignment) => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const name = creatorName(a);
  return (
    <li className="rounded-md border bg-card p-2 text-xs" data-testid={`assignment-${a.id}`}>
      <div className="font-medium">{name}</div>
      {brandName && <div className="text-muted-foreground">{brandName}</div>}
      {a.brief_name && <div className="text-muted-foreground">Brief: {a.brief_name}</div>}
      <div className="mt-2 space-y-1">
        <select aria-label={`Stage for ${name}`} className={`${SELECT} w-full`} value={a.stage} onChange={(e) => onPatch(a, { stage: e.target.value })}>
          {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select aria-label={`Owner for ${name}`} className={`${SELECT} w-full`} value={a.owner_id ?? ""} onChange={(e) => onPatch(a, { owner_id: e.target.value || null })}>
          <option value="">No owner</option>
          {ownerOptions(users, a.owner_id).map((u) => <option key={u.id} value={u.id}>{u.name}{u.active ? "" : " (inactive)"}</option>)}
        </select>
        <input aria-label={`Follow-up for ${name}`} type="date" className={`${SELECT} w-full`} value={a.next_follow_up_at ?? ""}
          onChange={(e) => onPatch(a, { next_follow_up_at: e.target.value || null })} />
      </div>
      {DELIVERY_STAGES.includes(a.stage) && <DeliveryFields key={`${a.tracking_number}-${a.product_delivered_at}`} a={a} onSaved={onSaved} onError={onError} />}
      {canRemove && (
        <button type="button" className="mt-2 text-xs text-destructive underline" onClick={() => onRemove(a)}>Remove from brand</button>
      )}
    </li>
  );
}

function AddCreators({ creators, onBrand, onAdd }: { creators: CreatorOption[] | null; onBrand: Assignment[]; onAdd: (ids: string[]) => void }) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const options = useMemo(() => addableCreators(creators ?? [], onBrand, query).slice(0, 50), [creators, onBrand, query]);
  if (!creators) return <p role="status" className="text-sm text-muted-foreground">Loading the roster...</p>;
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  return (
    <div className="rounded-lg border p-3 space-y-2" role="group" aria-label="Add creators">
      <input aria-label="Search the roster" className="w-full rounded-md border px-2 py-1 text-sm" placeholder="Search creators" value={query} onChange={(e) => setQuery(e.target.value)} />
      <ul className="max-h-64 overflow-y-auto text-sm">
        {options.map((c) => (
          <li key={c.id}>
            <label className="flex items-center gap-2 py-0.5">
              <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
              {c.name}{c.scale ? ` (scale ${c.scale})` : ""}
            </label>
          </li>
        ))}
        {options.length === 0 && <li className="text-muted-foreground">No creators match.</li>}
      </ul>
      <button type="button" className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50" disabled={picked.size === 0}
        onClick={() => { onAdd([...picked]); setPicked(new Set()); }}>
        Add {picked.size} {picked.size === 1 ? "creator" : "creators"}
      </button>
    </div>
  );
}

export default function CreatorPipelinePage() {
  const prefix = useRolePrefix();
  const [params, setParams] = useSearchParams();
  const brand = params.get("brand") ?? "";
  const [view, setView] = useState<"board" | "list">("board");
  const [scope, setScope] = useState<StageScope>("production");
  const [query, setQuery] = useState("");
  const [base, setBase] = useState<{ brands: BrandOption[]; users: AppUser[] } | null>(null);
  const [rows, setRows] = useState<Assignment[] | null>(null);
  const [creators, setCreators] = useState<CreatorOption[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    loadBrandsAndTeam().then(setBase, (e) => setError(messageOf(e, "Could not load brands.")));
  }, []);
  const loadRows = useCallback(async () => {
    if (!brand) return setRows(null);
    try {
      setRows(await loadAssignments(brand));
    } catch (e) {
      setError(messageOf(e, "Could not load the pipeline."));
    }
  }, [brand]);
  useEffect(() => {
    setRows(null);
    void loadRows();
  }, [loadRows]);
  useEffect(() => {
    if (adding && !creators) loadCreatorOptions().then(setCreators, (e) => setError(messageOf(e, "Could not load the roster.")));
  }, [adding, creators]);

  const brands = useMemo(() => (base?.brands ?? []).filter((b) => b.active && b.does_creators), [base]);
  const brandNames = useMemo(() => new Map((base?.brands ?? []).map((b) => [b.slug, b.name])), [base]);
  const users = base?.users ?? [];
  const isAll = brand === ALL_BRANDS;
  const columns = boardColumns(brand, scope);
  const visible = useMemo(() => searchAssignments(rows ?? [], query, brandNames), [rows, query, brandNames]);
  const grouped = useMemo(() => groupByStage(visible, columns), [visible, columns]);
  const offBoard = isAll ? visible.filter((r) => !columns.includes(r.stage)).length : 0;

  const pick = (slug: string) => {
    const next = new URLSearchParams(params);
    if (slug) next.set("brand", slug);
    else next.delete("brand");
    setParams(next);
    setAdding(false);
  };
  const run = async (fn: () => Promise<void>, ok: string, fallback: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(ok);
    } catch (e) {
      setError(messageOf(e, fallback));
    }
    await loadRows();
  };
  const patch = (a: Assignment, p: AssignmentPatch) =>
    void run(() => updateAssignment(a.id, p), `${creatorName(a)} updated.`, "The change could not be saved.");
  const remove = (a: Assignment) => {
    if (!window.confirm(`Take ${creatorName(a)} off ${brandNames.get(a.client_slug) ?? a.client_slug}? Their stage, owner and dates for this brand are deleted.`)) return;
    void run(() => removeAssignment(a.id), `${creatorName(a)} removed.`, "The creator could not be removed.");
  };
  const add = (ids: string[]) => void run(() => addCreatorsToBrand(brand, ids), `${ids.length} added as Sourced.`, "The creators could not be added.");
  const card = (a: Assignment) => (
    <AssignmentCard key={a.id} a={a} users={users} brandName={isAll ? brandNames.get(a.client_slug) ?? a.client_slug : null} canRemove={!isAll}
      onPatch={patch} onRemove={remove} onSaved={() => void run(async () => {}, "Delivery saved.", "")} onError={setError} />
  );

  return (
    <div className="p-6 space-y-4" data-testid="creator-pipeline-page">
      <PageHeader title="Creator pipeline" description="Creators per brand, from sourcing to payment. The ClickUp asset board is the Content Pipeline." />
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Brand" className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" value={brand} onChange={(e) => pick(e.target.value)}>
          <option value="">Choose a brand</option>
          <option value={ALL_BRANDS}>All brands</option>
          {brands.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
        </select>
        {brand && (
          <>
            <div role="group" aria-label="View" className="flex rounded-md border text-sm">
              {(["board", "list"] as const).map((v) => (
                <button key={v} type="button" aria-pressed={view === v} className={`px-3 py-1 ${view === v ? "bg-accent font-medium" : ""}`} onClick={() => setView(v)}>
                  {v === "board" ? "Board" : "List"}
                </button>
              ))}
            </div>
            {isAll && view === "board" && (
              <select aria-label="Stages shown" className="rounded-md border px-2 py-1.5 text-sm" value={scope} onChange={(e) => setScope(e.target.value as StageScope)}>
                <option value="production">Production stages</option>
                <option value="all">All active stages</option>
              </select>
            )}
            <input aria-label="Search the pipeline" className="rounded-md border px-2 py-1.5 text-sm" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
            {!isAll && <button type="button" className="rounded-md border px-3 py-1.5 text-sm" onClick={() => setAdding(!adding)}>{adding ? "Close" : "Add creators"}</button>}
            {!isAll && <Link to={`${prefix}/clients/${encodeURIComponent(brand)}`} className="text-sm underline">Client page</Link>}
          </>
        )}
      </div>
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {adding && !isAll && <AddCreators creators={creators} onBrand={rows ?? []} onAdd={add} />}

      {!brand ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Choose a brand, or All brands, to see its creators.</p>
      ) : !rows ? (
        <p role="status" className="text-sm text-muted-foreground">Loading creators...</p>
      ) : view === "board" ? (
        <>
          <div className="flex gap-3 overflow-x-auto pb-2" aria-label="Board">
            {columns.map((stage) => (
              <section key={stage} aria-label={stageLabel(stage)} className={`w-56 shrink-0 rounded-lg p-2 ${TERMINAL_STAGES.includes(stage) ? "bg-muted/40" : "bg-muted"}`}>
                <h2 className="mb-2 text-xs font-semibold">{stageLabel(stage)} ({grouped.get(stage)?.length ?? 0})</h2>
                <ul className="space-y-2">{(grouped.get(stage) ?? []).map(card)}</ul>
              </section>
            ))}
          </div>
          {offBoard > 0 && <p className="text-xs text-muted-foreground">{offBoard} creators are in stages not shown. Switch to all active stages or open one brand.</p>}
        </>
      ) : (
        <table className="w-full text-sm" aria-label="Creator list">
          <thead>
            <tr className="text-left text-xs text-muted-foreground"><th>Creator</th>{isAll && <th>Brand</th>}<th>Stage</th><th>Owner</th><th>Follow-up</th><th>Brief</th></tr>
          </thead>
          <tbody>
            {[...visible].sort((a, b) => stageIndex(a.stage) - stageIndex(b.stage) || creatorName(a).localeCompare(creatorName(b))).map((a) => (
              <tr key={a.id} className="border-t">
                <td>{creatorName(a)}</td>
                {isAll && <td>{brandNames.get(a.client_slug) ?? a.client_slug}</td>}
                <td>{stageLabel(a.stage)}</td>
                <td>{ownerName(users, a.owner_id)}</td>
                <td>{a.next_follow_up_at ? formatDay(a.next_follow_up_at) : ""}</td>
                <td>{a.brief_name ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-muted-foreground">
        Approval board links for clients are public links already sent out, so they stay on the{" "}
        <a href={brand && !isAll ? `${OLD_DASHBOARD_URL}/pipeline?brand=${encodeURIComponent(brand)}` : `${OLD_DASHBOARD_URL}/pipeline`} target="_blank" rel="noopener noreferrer" className="underline">old dashboard</a>.
      </p>
    </div>
  );
}
