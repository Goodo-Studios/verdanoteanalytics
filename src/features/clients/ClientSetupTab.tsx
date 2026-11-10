// Client hub, Setup tab (phase 4, PR 1): link a client to its ad accounts, its ClickUp folder and its
// client logins without a database edit. Builders only (the tab is hidden from employees and the
// page says so if an employee opens the address).
//
// Ad accounts and the ClickUp link are written straight to client_ad_accounts and source_mappings
// (staff row rules, migration 20261109000004). Client logins go through list_client_members,
// add_client_member and remove_client_member (migration 20261112000001), because the login's email
// is not readable from the browser. The ClickUp folder picker uses the clickup-folders function when
// ClickUp is connected; without it a pasted folder link or id works the same.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClientSelection } from "@/contexts/ClientSelectionContext";
import { useRolePrefix } from "@/hooks/useRolePath";
import { ErrorState, LoadingState, PageHeader, PageShell, SelectField, TextField, EmptyState, useConfirm } from "@/components/page-kit";
import { Button } from "@/components/ui/button";
import { SETUP_AD_ACCOUNT_COLUMNS, SETUP_MAPPING_COLUMNS, CLIENT_SWITCHER_LINK_COLUMNS } from "@/lib/pageQueries";
import {
  buildChecklist,
  CLICKUP_ID_HELP,
  folderLabel,
  NO_LOOKUP_NOTE,
  parseClickUpId,
  setupErrorText,
  type FolderChoice,
  type SetupStatus,
} from "./setupModel";

interface DbResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}
interface Query extends PromiseLike<DbResult> {
  eq(column: string, value: unknown): Query;
  order(column: string, options?: { ascending: boolean }): Query;
}
interface Table {
  select(columns: string): Query;
  insert(row: Record<string, unknown>): PromiseLike<DbResult>;
  delete(): { eq(column: string, value: unknown): PromiseLike<DbResult> };
}
interface Untyped {
  from(table: string): Table;
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<DbResult>;
  functions: { invoke(name: string): Promise<{ data: unknown; error: unknown }> };
}
const db = supabase as unknown as Untyped;

const CARD = "rounded-lg border border-border bg-card p-4";
const H2 = "text-sm font-semibold";

interface AdAccount { id: string; name: string | null }
interface AdLink { account_id: string; client_slug: string }
interface Mapping { id: string; client_slug: string; provider: string; kind: string; external_id: string; label: string | null; active: boolean }
interface Member { user_id: string; email: string; display_name: string | null; added_at: string }

interface Loaded {
  accounts: AdAccount[];
  links: AdLink[];
  mappings: Mapping[];
  members: Member[];
  status: SetupStatus | null;
}

async function loadAll(slug: string): Promise<Loaded> {
  const [accounts, links, mappings, members, status] = await Promise.all([
    db.from("ad_accounts").select(SETUP_AD_ACCOUNT_COLUMNS).order("name"),
    db.from("client_ad_accounts").select(CLIENT_SWITCHER_LINK_COLUMNS),
    db.from("source_mappings").select(SETUP_MAPPING_COLUMNS).eq("provider", "clickup").eq("active", true),
    db.rpc("list_client_members", { p_slug: slug }),
    db.rpc("client_setup_status"),
  ]);
  for (const r of [accounts, links, mappings, members, status]) if (r.error) throw new Error(r.error.message);
  const all = (status.data ?? []) as SetupStatus[];
  return {
    accounts: (accounts.data ?? []) as AdAccount[],
    links: (links.data ?? []) as AdLink[],
    mappings: (mappings.data ?? []) as Mapping[],
    members: (members.data ?? []) as Member[],
    status: all.find((s) => s.client_slug === slug) ?? null,
  };
}

function Checklist({ status, now }: { status: SetupStatus | null; now: Date }) {
  const items = buildChecklist(status, now);
  return (
    <section aria-label="Setup checklist" className={CARD} data-testid="setup-checklist">
      <h2 className={H2}>Checklist</h2>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((i) => (
          <li key={i.key} className="rounded border border-input p-2 text-sm" data-testid={`setup-check-${i.key}`} data-done={i.done}>
            <div className="flex items-center gap-2 font-medium">
              <span aria-hidden>{i.done ? "✓" : "○"}</span>
              <span>{i.label}</span>
              <span className="sr-only">{i.done ? "(done)" : "(not done)"}</span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">{i.detail}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AdAccounts({ slug, data, clientName, nameOf, onChanged }: {
  slug: string; data: Loaded; clientName: string; nameOf: (slug: string) => string; onChanged: () => void;
}) {
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();
  const mine = data.links.filter((l) => l.client_slug === slug);
  const owner = new Map(data.links.map((l) => [l.account_id, l.client_slug]));
  const free = data.accounts.filter((a) => !owner.has(a.id));
  const nameFor = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? id;

  const link = async () => {
    if (!pick) return;
    setBusy(true);
    setError(null);
    const { error: e } = await db.from("client_ad_accounts").insert({ account_id: pick, client_slug: slug });
    setBusy(false);
    if (e) return setError(setupErrorText(e, "ad_account"));
    setPick("");
    onChanged();
  };
  const unlink = async (id: string) => {
    if (!(await confirm({ title: `Unlink ${nameFor(id)}?`, description: `Unlink ${nameFor(id)} from ${clientName}? ${clientName}'s logins will stop seeing its numbers.`, actionLabel: "Unlink" }))) return;
    setBusy(true);
    setError(null);
    const { error: e } = await db.from("client_ad_accounts").delete().eq("account_id", id);
    setBusy(false);
    if (e) return setError(setupErrorText(e, "ad_account"));
    onChanged();
  };

  return (
    <section aria-label="Ad accounts" className={`${CARD} space-y-2`}>
      <h2 className={H2}>Ad accounts</h2>
      <p className="text-xs text-muted-foreground">
        A client's logins see the ad accounts linked here. An ad account belongs to one client.
      </p>
      {mine.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="setup-no-accounts">No ad account is linked to {clientName} yet.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {mine.map((l) => (
            <li key={l.account_id} className="flex items-center justify-between gap-2">
              <span>{nameFor(l.account_id)}</span>
              <Button size="sm" variant="outline" disabled={busy} aria-label={`Unlink ${nameFor(l.account_id)}`} onClick={() => void unlink(l.account_id)}>Unlink</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <SelectField
          label="Ad account to link"
          hideLabel
          className="w-full sm:max-w-xs"
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          placeholder={free.length === 0 ? "Every ad account is already linked" : "Choose an ad account"}
          options={free.map((a) => ({ value: a.id, label: a.name ?? a.id }))}
        />
        <Button size="sm" disabled={busy || !pick} onClick={() => void link()}>Link ad account</Button>
      </div>
      {data.accounts.length > free.length ? (
        <p className="text-xs text-muted-foreground">
          Linked elsewhere: {data.accounts.filter((a) => owner.has(a.id) && owner.get(a.id) !== slug).map((a) => `${a.name ?? a.id} (${nameOf(owner.get(a.id) ?? "")})`).join(", ") || "none"}.
        </p>
      ) : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {dialog}
    </section>
  );
}

function ClickUpLink({ slug, data, clientName, nameOf, onChanged }: {
  slug: string; data: Loaded; clientName: string; nameOf: (slug: string) => string; onChanged: () => void;
}) {
  const [pasted, setPasted] = useState("");
  const [kind, setKind] = useState<"folder" | "list">("folder");
  const [label, setLabel] = useState("");
  const [folders, setFolders] = useState<FolderChoice[] | null>(null);
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [pickedFolder, setPickedFolder] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();

  const mine = data.mappings.filter((m) => m.client_slug === slug);
  const takenBy = useMemo(() => new Map(data.mappings.filter((m) => m.kind === "folder").map((m) => [m.external_id, m.client_slug])), [data.mappings]);
  const hasFolder = mine.some((m) => m.kind === "folder");

  const find = async () => {
    setLooking(true);
    setLookupNote(null);
    const { data: body, error: e } = await db.functions.invoke("clickup-folders");
    setLooking(false);
    if (e) {
      setFolders(null);
      const status = (e as { context?: { status?: number } })?.context?.status;
      setLookupNote(status === 503 ? NO_LOOKUP_NOTE : "The folder list could not load. Paste the folder link or id instead.");
      return;
    }
    const list = (body as { folders?: FolderChoice[] } | null)?.folders;
    setFolders(Array.isArray(list) ? list : []);
  };

  const save = async (externalId: string, saveKind: "folder" | "list", name: string) => {
    setBusy(true);
    setError(null);
    const { error: e } = await db.from("source_mappings").insert({
      client_slug: slug, provider: "clickup", kind: saveKind, external_id: externalId, label: name.trim() || null, active: true,
    });
    setBusy(false);
    if (e) {
      const owner = takenBy.get(externalId);
      return setError(e.code === "23505" && owner && owner !== slug ? `That ClickUp folder is already linked to ${nameOf(owner)}. Each folder belongs to one client.` : setupErrorText(e, "mapping"));
    }
    setPasted("");
    setLabel("");
    setPickedFolder("");
    onChanged();
  };
  const savePasted = () => {
    const parsed = parseClickUpId(pasted);
    if (!parsed) return setError("That does not look like a ClickUp folder link or id. " + CLICKUP_ID_HELP);
    void save(parsed.id, parsed.kind ?? kind, label);
  };
  const savePicked = () => {
    const f = folders?.find((x) => x.id === pickedFolder);
    if (f) void save(f.id, "folder", f.name);
  };
  const remove = async (m: Mapping) => {
    if (!(await confirm({ title: `Unlink ${m.label ?? m.external_id}?`, description: `Unlink ${m.label ?? m.external_id} from ${clientName}? The ClickUp board will stop filling for this client until a folder is linked again.`, actionLabel: "Unlink" }))) return;
    setBusy(true);
    setError(null);
    const { error: e } = await db.from("source_mappings").delete().eq("id", m.id);
    setBusy(false);
    if (e) return setError(setupErrorText(e, "mapping"));
    onChanged();
  };

  return (
    <section aria-label="ClickUp" className={`${CARD} space-y-2`}>
      <h2 className={H2}>ClickUp folder</h2>
      <p className="text-xs text-muted-foreground">
        The Work tab and the push-to-ClickUp buttons use the folder linked here. Without a link they fall back to matching the
        folder name to the client name.
      </p>
      {mine.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="setup-no-mapping">No ClickUp folder is linked to {clientName} yet.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {mine.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2" data-testid="setup-mapping">
              <span>
                {m.kind === "folder" ? "Folder" : "List"}: {m.label ?? m.external_id}{" "}
                <span className="text-xs text-muted-foreground">({m.external_id})</span>
                {m.kind !== "folder" ? <span className="block text-xs text-muted-foreground">Saved, but the board sync reads folders only.</span> : null}
              </span>
              <Button size="sm" variant="outline" disabled={busy} aria-label={`Unlink ${m.label ?? m.external_id}`} onClick={() => void remove(m)}>Unlink</Button>
            </li>
          ))}
        </ul>
      )}
      {hasFolder ? (
        <p className="text-xs text-muted-foreground">To use a different folder, unlink this one first.</p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={looking} onClick={() => void find()}>{looking ? "Looking..." : "Find folders in ClickUp"}</Button>
            {lookupNote ? <p role="status" className="text-xs text-muted-foreground" data-testid="setup-lookup-note">{lookupNote}</p> : null}
          </div>
          {folders ? (
            folders.length === 0 ? (
              <p className="text-sm text-muted-foreground">ClickUp returned no folders.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <SelectField
                  label="ClickUp folder to link"
                  hideLabel
                  className="w-full sm:max-w-xs"
                  value={pickedFolder}
                  onChange={(e) => setPickedFolder(e.target.value)}
                  placeholder="Choose a folder"
                  options={folders.map((f) => {
                    const owner = takenBy.get(f.id);
                    return { value: f.id, label: folderLabel(f, owner ? nameOf(owner) : undefined), disabled: !!owner };
                  })}
                />
                <Button size="sm" disabled={busy || !pickedFolder} onClick={savePicked}>Link folder</Button>
              </div>
            )
          ) : null}
          <div role="group" aria-label="Paste a ClickUp folder" className="grid items-end gap-2 sm:grid-cols-[1fr_9rem_1fr_auto]">
            <TextField label="ClickUp folder link or id" hideLabel placeholder="Folder link or id" value={pasted} onChange={(e) => setPasted(e.target.value)} />
            <SelectField
              label="What the id is"
              hideLabel
              value={kind}
              onChange={(e) => setKind(e.target.value as "folder" | "list")}
              options={[{ value: "folder", label: "Folder" }, { value: "list", label: "List" }]}
            />
            <TextField label="Name for this link (optional)" hideLabel placeholder="Name (optional)" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} />
            <Button size="sm" disabled={busy || !pasted.trim()} onClick={savePasted}>Link pasted id</Button>
          </div>
          <p className="text-xs text-muted-foreground">{CLICKUP_ID_HELP}</p>
        </div>
      )}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {dialog}
    </section>
  );
}

function Logins({ slug, data, clientName, onChanged }: { slug: string; data: Loaded; clientName: string; onChanged: () => void }) {
  const prefix = useRolePrefix();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();

  const add = async () => {
    setBusy(true);
    setError(null);
    const { error: e } = await db.rpc("add_client_member", { p_slug: slug, p_email: email });
    setBusy(false);
    if (e) return setError(setupErrorText(e, "member"));
    setEmail("");
    onChanged();
  };
  const remove = async (m: Member) => {
    if (!(await confirm({ title: `Unlink ${m.email}?`, description: `Unlink ${m.email} from ${clientName}? They will stop seeing ${clientName}'s work. Their login stays.`, actionLabel: "Unlink" }))) return;
    setBusy(true);
    setError(null);
    const { error: e } = await db.rpc("remove_client_member", { p_slug: slug, p_user_id: m.user_id });
    setBusy(false);
    if (e) return setError(setupErrorText(e, "member"));
    onChanged();
  };

  return (
    <section aria-label="Client logins" className={`${CARD} space-y-2`}>
      <h2 className={H2}>Client logins</h2>
      <p className="text-xs text-muted-foreground">
        People who log in as {clientName} and see its work. Create the login on{" "}
        <Link className="underline" to={`${prefix}/team`}>Team and settings</Link>, then link it here by email.
      </p>
      {data.members.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="setup-no-members">No login is linked to {clientName} yet.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {data.members.map((m) => (
            <li key={m.user_id} className="flex items-center justify-between gap-2" data-testid="setup-member">
              <span>{m.display_name ? `${m.display_name} ` : ""}<span className="text-muted-foreground">{m.email}</span></span>
              <Button size="sm" variant="outline" disabled={busy} aria-label={`Unlink ${m.email}`} onClick={() => void remove(m)}>Unlink</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <TextField label="Email of an existing client login" hideLabel type="email" className="w-full sm:max-w-xs" placeholder="client@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button size="sm" disabled={busy || !email.trim()} onClick={() => void add()}>Link login</Button>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {dialog}
    </section>
  );
}

export default function ClientSetupTab() {
  const { isBuilder } = useAuth();
  const { selectedSlug, selectedClient, clients } = useClientSelection();
  const slug = selectedSlug;
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    if (!slug) return;
    setError(null);
    try {
      setData(await loadAll(slug));
    } catch {
      setError("The setup details could not load, so this is not the same as nothing being set up.");
    }
  }, [slug]);
  useEffect(() => {
    if (isBuilder) void load();
  }, [isBuilder, load]);

  if (!slug) return null;
  const clientName = selectedClient?.name ?? slug;
  const nameOf = (s: string) => clients.find((c) => c.slug === s)?.name ?? s;

  if (!isBuilder) {
    return (
      <PageShell data-testid="client-setup-builders-only">
        <EmptyState
          title="Only a builder can set up a client"
          description={`Ask a builder to link ${clientName}'s ad account, ClickUp folder or logins.`}
        />
      </PageShell>
    );
  }

  return (
    <PageShell data-testid="client-setup">
      <PageHeader title="Setup" description={`Link ${clientName} to its ad accounts, its ClickUp folder and its logins.`} />
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !data ? (
        <LoadingState label="Loading setup" />
      ) : (
        <>
          <Checklist status={data.status} now={now} />
          <div className="grid gap-4 lg:grid-cols-2">
            <AdAccounts slug={slug} data={data} clientName={clientName} nameOf={nameOf} onChanged={() => void load()} />
            <ClickUpLink slug={slug} data={data} clientName={clientName} nameOf={nameOf} onChanged={() => void load()} />
          </div>
          <Logins slug={slug} data={data} clientName={clientName} onChanged={() => void load()} />
        </>
      )}
    </PageShell>
  );
}
