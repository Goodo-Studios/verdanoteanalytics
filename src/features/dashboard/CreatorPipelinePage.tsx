// Creator pipeline: staff page (consolidation step 5a, port of the old
// dashboard's Pipeline page). Creators assigned to a brand (creator_assignments)
// on a board by stage, or as a list. Staff move a creator's stage, set the
// owner and the next follow-up date, record tracking and delivery, add
// creators from the roster and take them off a brand. Moving the stage lets
// the database stage rule set the next follow-up.
//
// Not the Content Pipeline: /pipeline shows the ClickUp asset board and is
// unchanged. Approval board links (public links sent to clients) are served by
// the old dashboard; their staff side is the Approval boards page (step 5b).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSelectedClientSlug } from "@/contexts/ClientSelectionContext";
import { Button } from "@/components/ui/button";
import { DataTable, ErrorState, FilterBar, LoadingState, PageHeader, PageShell, SelectField, TextField, useConfirm, type DataColumn } from "@/components/page-kit";
import { useRolePrefix } from "@/hooks/useRolePath";
import { fmtDate } from "@/lib/formatters";
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

const COMPACT = "h-8 text-xs";

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof DashboardError) return e.code === "22023" ? e.message : errorText(e.code, e.message || fallback);
  return e instanceof Error ? e.message : fallback;
}

function DeliveryFields({ a, onSaved, onError }: { a: Assignment; onSaved: () => void; onError: (m: string) => void }) {
  const [tracking, setTracking] = useState(a.tracking_number ?? "");
  const [delivered, setDelivered] = useState(a.product_delivered_at ?? "");
  const save = async () => {
    try {
      await saveDelivery(a.id, tracking.trim() || null, delivered || null, a.delivery_notes);
      onSaved();
    } catch (e) {
      onError(messageOf(e, "Tracking could not be saved."));
    }
  };
  return (
    <div className="mt-2 space-y-1 border-t pt-2">
      <TextField label={`Tracking number for ${creatorName(a)}`} hideLabel inputClassName={COMPACT} placeholder="Tracking number" value={tracking} onChange={(e) => setTracking(e.target.value)} />
      <TextField label={`Delivered on for ${creatorName(a)}`} hideLabel type="date" inputClassName={COMPACT} value={delivered} onChange={(e) => setDelivered(e.target.value)} />
      <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => void save()}>Save delivery</Button>
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
        <SelectField label={`Stage for ${name}`} hideLabel inputClassName={COMPACT} value={a.stage} onChange={(e) => onPatch(a, { stage: e.target.value })} options={STAGES.map((s) => ({ value: s.value, label: s.label }))} />
        <SelectField label={`Owner for ${name}`} hideLabel inputClassName={COMPACT} value={a.owner_id ?? ""} onChange={(e) => onPatch(a, { owner_id: e.target.value || null })} placeholder="No owner" options={ownerOptions(users, a.owner_id).map((u) => ({ value: u.id, label: `${u.name}${u.active ? "" : " (inactive)"}` }))} />
        <TextField label={`Follow-up for ${name}`} hideLabel type="date" inputClassName={COMPACT} value={a.next_follow_up_at ?? ""} onChange={(e) => onPatch(a, { next_follow_up_at: e.target.value || null })} />
      </div>
      {DELIVERY_STAGES.includes(a.stage) && <DeliveryFields key={`${a.tracking_number}-${a.product_delivered_at}`} a={a} onSaved={onSaved} onError={onError} />}
      {canRemove && (
        <Button type="button" variant="link" size="sm" className="mt-2 h-auto p-0 text-xs text-destructive" onClick={() => onRemove(a)}>Remove from client</Button>
      )}
    </li>
  );
}

function AddCreators({ creators, onBrand, onAdd }: { creators: CreatorOption[] | null; onBrand: Assignment[]; onAdd: (ids: string[]) => void }) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const options = useMemo(() => addableCreators(creators ?? [], onBrand, query).slice(0, 50), [creators, onBrand, query]);
  if (!creators) return <LoadingState label="Loading the roster" count={3} />;
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  return (
    <div className="rounded-lg border p-3 space-y-2" role="group" aria-label="Add creators">
      <TextField label="Search the roster" hideLabel placeholder="Search creators" value={query} onChange={(e) => setQuery(e.target.value)} />
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
      <Button type="button" size="sm" disabled={picked.size === 0}
        onClick={() => { onAdd([...picked]); setPicked(new Set()); }}>
        Add {picked.size} {picked.size === 1 ? "creator" : "creators"}
      </Button>
    </div>
  );
}

export default function CreatorPipelinePage() {
  const prefix = useRolePrefix();
  const { confirm, dialog } = useConfirm();
  // The client comes from the one switcher at the top of the app. "All clients" shows every client's creators.
  const selected = useSelectedClientSlug();
  const brand = selected || ALL_BRANDS;
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
    loadBrandsAndTeam().then(setBase, (e) => setError(messageOf(e, "Could not load clients.")));
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

  const brandNames = useMemo(() => new Map((base?.brands ?? []).map((b) => [b.slug, b.name])), [base]);
  const users = base?.users ?? [];
  const isAll = brand === ALL_BRANDS;
  const columns = boardColumns(brand, scope);
  const visible = useMemo(() => searchAssignments(rows ?? [], query, brandNames), [rows, query, brandNames]);
  const grouped = useMemo(() => groupByStage(visible, columns), [visible, columns]);
  const offBoard = isAll ? visible.filter((r) => !columns.includes(r.stage)).length : 0;

  // Switching client closes the add-creators panel.
  useEffect(() => setAdding(false), [brand]);
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
  const remove = async (a: Assignment) => {
    const ok = await confirm({
      title: `Take ${creatorName(a)} off ${brandNames.get(a.client_slug) ?? a.client_slug}?`,
      description: "Their stage, owner and dates for this client are deleted.",
      actionLabel: "Remove",
    });
    if (!ok) return;
    void run(() => removeAssignment(a.id), `${creatorName(a)} removed.`, "The creator could not be removed.");
  };
  const add = (ids: string[]) => void run(() => addCreatorsToBrand(brand, ids), `${ids.length} added as Sourced.`, "The creators could not be added.");
  const listColumns: DataColumn<Assignment>[] = [
    { key: "creator", header: "Creator", cell: (a) => creatorName(a) },
    ...(isAll ? [{ key: "client", header: "Client", cell: (a: Assignment) => brandNames.get(a.client_slug) ?? a.client_slug }] : []),
    { key: "stage", header: "Stage", cell: (a) => stageLabel(a.stage) },
    { key: "owner", header: "Owner", cell: (a) => ownerName(users, a.owner_id) },
    { key: "followup", header: "Follow-up", cell: (a) => (a.next_follow_up_at ? fmtDate(a.next_follow_up_at) : "") },
    { key: "brief", header: "Brief", cell: (a) => a.brief_name ?? "" },
  ];
  const card = (a: Assignment) => (
    <AssignmentCard key={a.id} a={a} users={users} brandName={isAll ? brandNames.get(a.client_slug) ?? a.client_slug : null} canRemove={!isAll}
      onPatch={patch} onRemove={(x) => void remove(x)} onSaved={() => void run(async () => {}, "Delivery saved.", "")} onError={setError} />
  );

  return (
    <PageShell wide data-testid="creator-pipeline-page">
      <PageHeader title="Creator pipeline" description="Creators per client, from sourcing to payment. The ClickUp asset board is the Work tab on each client." />
      {brand && (
        <FilterBar search={{ value: query, onChange: setQuery, label: "Search the pipeline", placeholder: "Search" }}>
          <div role="group" aria-label="View" className="flex h-10 gap-1">
            {(["board", "list"] as const).map((v) => (
              <Button key={v} type="button" size="sm" variant={view === v ? "secondary" : "outline"} className="h-10" aria-pressed={view === v} onClick={() => setView(v)}>
                {v === "board" ? "Board" : "List"}
              </Button>
            ))}
          </div>
          {isAll && view === "board" && (
            <SelectField label="Stages shown" hideLabel className="w-52" value={scope} onChange={(e) => setScope(e.target.value as StageScope)} options={[{ value: "production", label: "Production stages" }, { value: "all", label: "All active stages" }]} />
          )}
          {!isAll && <Button type="button" variant="outline" onClick={() => setAdding(!adding)}>{adding ? "Close" : "Add creators"}</Button>}
          {!isAll && <Link to={`${prefix}/clients/${encodeURIComponent(brand)}`} className="flex h-10 items-center text-sm underline">Client page</Link>}
        </FilterBar>
      )}
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {error && (!rows && brand ? <ErrorState message={error} onRetry={() => { setError(null); void loadRows(); }} /> : <p role="alert" className="text-sm text-destructive">{error}</p>)}
      {adding && !isAll && <AddCreators creators={creators} onBrand={rows ?? []} onAdd={add} />}

      {!rows ? (
        error ? null : <LoadingState label="Loading creators" />
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
          {offBoard > 0 && <p className="text-xs text-muted-foreground">{offBoard} creators are in stages not shown. Switch to all active stages or open one client.</p>}
        </>
      ) : (
        <DataTable
          label="Creator list"
          columns={listColumns}
          rows={[...visible].sort((a, b) => stageIndex(a.stage) - stageIndex(b.stage) || creatorName(a).localeCompare(creatorName(b)))}
          rowKey={(a) => a.id}
          empty="No creators on this client yet."
        />
      )}
      <p className="text-xs text-muted-foreground">
        Client approval links and the client&apos;s votes are on{" "}
        <Link to={brand && !isAll ? `${prefix}/approval-boards?brand=${encodeURIComponent(brand)}` : `${prefix}/approval-boards`} className="underline">Approval boards</Link>.
      </p>
      {dialog}
    </PageShell>
  );
}
