// Client settings on the Team and settings page (consolidation step 5d, the old dashboard
// Settings "Active clients" section). Every client, active or not: staff add a client by hand
// (create_client); a builder switches a client on or off the Client overview
// (set_client_active) and renames or changes the service lines of a hand-made client
// (update_client). A client kept in step by the HQ sync is read only here. The client page
// (/clients/:slug) holds details, scope and linked ad accounts.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { useRolePrefix } from "@/hooks/useRolePath";
import { Button } from "@/components/ui/button";
import { buildChecklist, checklistSummary, type SetupStatus } from "@/features/clients/setupModel";
import { errorText } from "./model";
import {
  CLIENT_SELECT,
  type ClientFilter,
  type ClientRow,
  editClientProblem,
  filterClients,
  isSynced,
  newClientProblem,
  originLabel,
  serviceLinesLabel,
  suggestClientSlug,
} from "./clientsModel";

interface DbResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}
interface Query extends PromiseLike<DbResult> {
  order(column: string, options?: { ascending: boolean }): Query;
}
interface Untyped {
  from(table: string): { select(columns: string): Query };
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<DbResult>;
}
const db = supabase as unknown as Untyped;
const field = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

function SetupLine({ client, status, builder }: { client: ClientRow; status: SetupStatus | undefined; builder: boolean }) {
  const prefix = useRolePrefix();
  if (!status) return null;
  const items = buildChecklist(status, new Date());
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground" data-testid="client-setup-line">
      <span>{checklistSummary(items)}:</span>
      {items.map((i) => (
        <span key={i.key} data-done={i.done}>{i.done ? "\u2713" : "\u25CB"} {i.label}{i.key === "sync" ? ` (${i.detail})` : ""}</span>
      ))}
      {builder ? <Link className="underline" to={`${prefix}/clients/${client.slug}/setup`}>Set up</Link> : null}
    </div>
  );
}

function ClientItem({ client, builder, status, onChanged }: { client: ClientRow; builder: boolean; status: SetupStatus | undefined; onChanged: () => void }) {
  const prefix = useRolePrefix();
  const [form, setForm] = useState({ name: client.name, doesCreators: client.does_creators, doesProduction: client.does_production });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const problem = editClientProblem(form);
  const changed = form.name.trim() !== client.name || form.doesCreators !== client.does_creators || form.doesProduction !== client.does_production;

  const run = async (fn: string, args: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const { error: e } = await db.rpc(fn, args);
    setBusy(false);
    if (e) return setError(errorText(e));
    onChanged();
  };
  const toggle = () => {
    const next = !client.active;
    if (!window.confirm(`${next ? "Show" : "Hide"} ${client.name} ${next ? "on" : "from"} the Client overview?`)) return;
    void run("set_client_active", { p_slug: client.slug, p_active: next });
  };

  return (
    <li className="rounded border border-input p-3 text-sm" data-testid="client-setting">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <Link className="font-medium underline" to={`${prefix}/clients/${client.slug}`}>{client.name}</Link>{" "}
          <span className="text-muted-foreground">{client.slug}</span>
        </div>
        <div className="text-[12px] text-muted-foreground">
          {serviceLinesLabel(client)} · {originLabel(client)} · {client.active ? "On the Client overview" : "Not shown"}
        </div>
      </div>
      <SetupLine client={client} status={status} builder={builder} />
      {builder ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={toggle}>{client.active ? "Hide from overview" : "Show on overview"}</Button>
        </div>
      ) : null}
      {builder && !isSynced(client) ? (
        <details>
          <summary className="cursor-pointer text-[12px] text-muted-foreground">Edit name and service lines</summary>
          <div role="group" aria-label={`Edit ${client.name}`} className="mt-2 grid gap-2 sm:grid-cols-4">
            <input aria-label="Client name" className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.doesCreators} onChange={(e) => setForm({ ...form, doesCreators: e.target.checked })} /> Creators</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.doesProduction} onChange={(e) => setForm({ ...form, doesProduction: e.target.checked })} /> Production</label>
            <Button size="sm" disabled={busy || !!problem || !changed}
              onClick={() => void run("update_client", { p_slug: client.slug, p_name: form.name.trim(), p_does_creators: form.doesCreators, p_does_production: form.doesProduction })}>
              Save
            </Button>
            {problem ? <p className="text-[12px] text-muted-foreground sm:col-span-4">{problem}</p> : null}
          </div>
        </details>
      ) : null}
      {builder && isSynced(client) ? (
        <p className="mt-1 text-[12px] text-muted-foreground">Name and details come from the client knowledge file through the HQ sync.</p>
      ) : null}
      {error ? <p role="alert" className="mt-1 text-red-700">{error}</p> : null}
    </li>
  );
}

function AddClient({ existing, onAdded }: { existing: string[]; onAdded: () => void }) {
  const empty = { name: "", slug: "", doesCreators: true, doesProduction: false };
  const [form, setForm] = useState(empty);
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = newClientProblem(form, existing);
  const save = async () => {
    setError(null);
    const { error: e } = await db.rpc("create_client", {
      p_slug: form.slug.trim().toLowerCase(), p_name: form.name.trim(), p_does_creators: form.doesCreators, p_does_production: form.doesProduction,
    });
    if (e) return setError(errorText(e));
    setForm(empty);
    setSlugTouched(false);
    onAdded();
  };
  return (
    <div role="group" aria-label="Add a client" className="grid gap-2 sm:grid-cols-2">
      <input aria-label="New client name" className={field} placeholder="Client name" value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value, slug: slugTouched ? form.slug : suggestClientSlug(e.target.value) })} />
      <input aria-label="New client slug" className={field} placeholder="client-slug" value={form.slug}
        onChange={(e) => { setSlugTouched(true); setForm({ ...form, slug: e.target.value }); }} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.doesCreators} onChange={(e) => setForm({ ...form, doesCreators: e.target.checked })} /> Creators</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.doesProduction} onChange={(e) => setForm({ ...form, doesProduction: e.target.checked })} /> Production</label>
      {problem && form.name ? <p className="text-[12px] text-muted-foreground sm:col-span-2">{problem}</p> : null}
      <div><Button size="sm" disabled={!!problem} onClick={() => void save()}>Add client</Button></div>
      {error ? <p role="alert" className="text-sm text-red-700 sm:col-span-2">{error}</p> : null}
    </div>
  );
}

export function ClientsSettings({ builder }: { builder: boolean }) {
  const [clients, setClients] = useState<ClientRow[] | null>(null);
  const [setup, setSetup] = useState<Map<string, SetupStatus>>(new Map());
  const [filter, setFilter] = useState<ClientFilter>("active");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: e } = await db.from("clients").select(CLIENT_SELECT).order("name");
    if (e) {
      setError("The client list could not load.");
      setClients([]);
      return;
    }
    setError(null);
    setClients((data ?? []) as ClientRow[]);
    // The checklist line is a nicety: if it fails the list still works, so the line is left out.
    const status = await db.rpc("client_setup_status");
    setSetup(new Map((!status.error && Array.isArray(status.data) ? (status.data as SetupStatus[]) : []).map((s) => [s.client_slug, s])));
  }, []);
  useEffect(() => void load(), [load]);

  const shown = filterClients(clients ?? [], filter, query);
  return (
    <section aria-label="Clients" className="space-y-2">
      <h2 className="text-lg font-semibold">Clients</h2>
      <p className="text-sm text-muted-foreground">
        Every client, including the ones hidden from the Client overview. Staff add a client by hand; builders show or hide a client
        and edit a hand-made client's name and service lines. Details, scope and linked ad accounts are on each client's page.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <select aria-label="Which clients" className={field} value={filter} onChange={(e) => setFilter(e.target.value as ClientFilter)}>
          <option value="active">On the Client overview</option>
          <option value="inactive">Hidden</option>
          <option value="all">All</option>
        </select>
        <input aria-label="Search clients" className={field} placeholder="Search by name or slug" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {clients && shown.length === 0 ? <p className="text-sm text-muted-foreground">No clients match.</p> : null}
      <ul className="space-y-2">{shown.map((c) => <ClientItem key={`${c.slug}:${c.active}:${c.name}`} client={c} builder={builder} status={setup.get(c.slug)} onChanged={() => void load()} />)}</ul>
      <details>
        <summary className="cursor-pointer text-sm font-medium">Add a client by hand</summary>
        <div className="mt-2"><AddClient existing={(clients ?? []).map((c) => c.slug)} onAdded={() => void load()} /></div>
      </details>
    </section>
  );
}
