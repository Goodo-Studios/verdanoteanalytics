// Knowledge: staff page. Staff read knowledge sources and edit them directly in a simple document
// editor (headings, bold, italic, bullet lists, links). Saving adds the next version through the
// checked database function edit_knowledge_source (migration 20261207080001) and the page shows it
// at once. A builder adds new sources. Clients see none of it. The older request-a-change flow
// (corrections, reviews, publish, rollback) is no longer shown; its tables and functions are kept.
import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { EmptyState, ErrorState, FilterBar, LoadingState, PageHeader, PageShell, SelectField, TextField, TextareaField } from "@/components/page-kit";
import { DocumentEditor } from "./DocumentEditor";
import { Button } from "@/components/ui/button";
import { currentVersion, errorText, type KnowledgeSource, matchesSearch, toSources } from "./model";

// The knowledge tables and functions are not in the generated types yet.
interface DbResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}
interface Query extends PromiseLike<DbResult> {
  order(column: string, opts?: { ascending?: boolean; referencedTable?: string }): Query;
  limit(count: number, opts?: { referencedTable?: string }): Query;
}
interface Untyped {
  from(table: string): { select(columns: string): Query };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<DbResult>;
}
const db = supabase as unknown as Untyped;
// Only the newest version of each source is loaded (it is the current text); edits add versions.
const SELECT = "*, knowledge_source_versions(*)";
const VERSIONS = "knowledge_source_versions";

interface ClientOption {
  slug: string;
  name: string;
}

function AddSource({ clients, onAdded }: { clients: ClientOption[]; onAdded: () => void }) {
  const [form, setForm] = useState({ title: "", body: "", classification: "staff", scope: "global", client: "", namespace: "general", url: "" });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const add = async () => {
    setError(null);
    const { error: e } = await db.rpc("create_knowledge_source", {
      p_title: form.title, p_body: form.body, p_classification: form.classification, p_release_scope: form.scope,
      p_client_slug: form.scope === "client" ? form.client : null, p_namespace: form.namespace, p_citation_url: form.url || null,
    });
    if (e) return setError(errorText(e.code, "The source could not be added."));
    setForm({ ...form, title: "", body: "", url: "" });
    onAdded();
  };
  return (
    <details className="rounded-lg border border-input bg-background p-4">
      <summary className="cursor-pointer text-sm font-medium">Add knowledge (builder)</summary>
      <div className="mt-3 space-y-2">
        <TextField label="Title" hideLabel placeholder="Title" value={form.title} onChange={set("title")} />
        <TextareaField label="Text" hideLabel inputClassName="min-h-[120px]" placeholder="Text" value={form.body} onChange={set("body")} />
        <div className="grid gap-2 sm:grid-cols-3">
          <SelectField label="Who it is for" hideLabel value={form.classification} onChange={set("classification")} options={[{ value: "staff", label: "Staff knowledge" }, { value: "client", label: "Client knowledge (still staff only)" }]} />
          <SelectField label="Applies to" hideLabel value={form.scope} onChange={set("scope")} options={[{ value: "global", label: "All clients" }, { value: "client", label: "One client" }]} />
          {form.scope === "client" ? (
            <SelectField label="Client" hideLabel value={form.client} onChange={set("client")} placeholder="Select client" options={clients.map((c) => ({ value: c.slug, label: c.name }))} />
          ) : <TextField label="Topic" hideLabel placeholder="Topic (for example process)" value={form.namespace} onChange={set("namespace")} />}
        </div>
        <TextField label="Source link" hideLabel placeholder="Source link (https://...)" value={form.url} onChange={set("url")} />
        <Button size="sm" disabled={!form.title.trim() || !form.body.trim()} onClick={() => void add()}>Add</Button>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </div>
    </details>
  );
}

function SourceDetail({ source, onChanged }: { source: KnowledgeSource; onChanged: () => Promise<void> }) {
  const current = currentVersion(source);
  const [editing, setEditing] = useState(false);

  const save = async (text: string): Promise<string | null> => {
    const { error: e } = await db.rpc("edit_knowledge_source", { p_source_id: source.id, p_body: text, p_expected_version: source.current_version });
    if (e) return errorText(e.code, "The document could not be saved.");
    await onChanged();
    setEditing(false);
    return null;
  };

  return (
    <section aria-label={source.title} className="space-y-4 rounded-lg border border-input bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{source.title}</h2>
          <p className="text-[12px] text-muted-foreground">
            {source.release_scope === "client" ? `client ${source.client_slug}` : "all clients"} · {source.namespace}
            {source.citation_url ? <> · <a className="underline" href={source.citation_url} target="_blank" rel="noopener noreferrer">source</a></> : null}
          </p>
        </div>
        {editing ? null : <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>}
      </div>
      {editing ? (
        <DocumentEditor initialText={current?.body ?? ""} onSave={save} onCancel={() => setEditing(false)} />
      ) : (
        <div className="prose max-w-none text-sm" data-testid="knowledge-current-body">
          <ReactMarkdown>{current?.body ?? ""}</ReactMarkdown>
        </div>
      )}
    </section>
  );
}

export default function KnowledgePage() {
  const { isBuilder } = useAuth();
  const [sources, setSources] = useState<KnowledgeSource[] | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: e } = await db
      .from("knowledge_sources")
      .select(SELECT)
      .order("title")
      .order("version", { ascending: false, referencedTable: VERSIONS })
      .limit(1, { referencedTable: VERSIONS });
    if (e) {
      setError("Knowledge could not load.");
      setSources([]);
    } else setSources(toSources(data));
  }, []);

  useEffect(() => {
    void load();
    if (isBuilder) {
      void db.from("clients").select("slug, name").order("name").then(({ data }) => setClients((data ?? []) as ClientOption[]));
    }
  }, [load, isBuilder]);

  const visible = useMemo(() => (sources ?? []).filter((s) => matchesSearch(s, query)), [sources, query]);
  const active = (sources ?? []).find((s) => s.id === selected) ?? null;

  return (
    <PageShell data-testid="knowledge">
      <PageHeader title="Knowledge" description="Shared Goodo knowledge. Open a document and press Edit to add to it or remove from it. Your change shows right away." />
      {isBuilder ? <AddSource clients={clients} onAdded={() => void load()} /> : null}
      <FilterBar search={{ value: query, onChange: setQuery, label: "Search knowledge", placeholder: "Search" }} />
      {error ? <ErrorState message={error} onRetry={() => { setError(null); setSources(null); void load(); }} /> : null}
      {sources === null ? <LoadingState label="Loading knowledge" /> : null}
      {sources && !error && visible.length === 0 ? <EmptyState title={sources.length ? "Nothing matches." : "No knowledge has been added yet."} /> : null}
      <ul className="space-y-1">
        {visible.map((s) => (
          <li key={s.id}>
            <button type="button" className={`w-full rounded border px-3 py-2 text-left text-sm ${s.id === selected ? "border-foreground" : "border-input"}`} onClick={() => setSelected(s.id)}>
              <span className="font-medium">{s.title}</span>
              <span className="text-muted-foreground"> · {s.release_scope === "client" ? s.client_slug : "all clients"}</span>
            </button>
          </li>
        ))}
      </ul>
      {active ? <SourceDetail key={active.id} source={active} onChanged={load} /> : null}
    </PageShell>
  );
}
