// Knowledge: staff page (consolidation step 4a, port of the Goodo OS pages
// KnowledgeCorrections.tsx and KnowledgePublication.tsx). Staff read knowledge
// sources and propose corrections against the version on screen; another staff
// member reviews; a builder publishes accepted content and factual corrections
// as a new version or rolls a source back. Every write goes through a checked
// database function (migration 20261110000003); clients see none of it.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ConfirmDialog, EmptyState, ErrorState, FilterBar, LoadingState, PageHeader, PageShell, SelectField, TextField, TextareaField } from "@/components/page-kit";
import { CorrectionForm, type CorrectionInput } from "./CorrectionForm";
import { fmtDate } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import {
  canPublish,
  canReview,
  CLASS_LABEL,
  type Correction,
  correctionStatus,
  currentVersion,
  errorText,
  type KnowledgeSource,
  matchesSearch,
  STATUS_LABEL,
  toSources,
  versionLabel,
} from "./model";

// The knowledge tables and functions are not in the generated types yet.
interface DbResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}
interface Untyped {
  from(table: string): { select(columns: string): { order(column: string): PromiseLike<DbResult> } };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<DbResult>;
}
const db = supabase as unknown as Untyped;
const SELECT = "*, knowledge_source_versions(*), knowledge_corrections(*, knowledge_correction_reviews(*))";

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

function CorrectionRow({ c, source, onChanged }: { c: Correction; source: KnowledgeSource; onChanged: () => void }) {
  const { user, isBuilder } = useAuth();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const status = correctionStatus(c, source);
  const call = async (name: string, args: Record<string, unknown>, fallback: string) => {
    setError(null);
    const { error: e } = await db.rpc(name, args);
    if (e) return setError(errorText(e.code, fallback));
    onChanged();
  };
  const review = (decision: "accepted" | "rejected" | "conflict") => {
    if (!reason.trim()) return setError("Add a reason before recording a decision.");
    void call("review_knowledge_correction", { p_correction_id: c.id, p_decision: decision, p_reason: reason.trim() }, "The review could not be saved.");
  };
  return (
    <li className="space-y-2 rounded border border-input p-3 text-sm" data-testid={`correction-${c.id}`}>
      <p className="font-medium">{CLASS_LABEL[c.classification]} correction to version {c.source_version} · {STATUS_LABEL[status]}</p>
      <p className="text-muted-foreground">{c.reason}</p>
      <p className="whitespace-pre-wrap rounded bg-muted/40 p-2">{c.proposed_body}</p>
      {c.review ? <p className="text-muted-foreground">Review: {c.review.reason}</p> : null}
      {canReview(c, user?.id, isBuilder) ? (
        <div className="space-y-2">
          <TextField label="Review reason" hideLabel value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => review("accepted")}>Accept</Button>
            <Button size="sm" variant="outline" onClick={() => review("rejected")}>Reject</Button>
            <Button size="sm" variant="outline" onClick={() => review("conflict")}>Conflict</Button>
          </div>
        </div>
      ) : null}
      {canPublish(c, source, isBuilder) ? (
        <Button size="sm" onClick={() => void call("publish_knowledge_correction", { p_correction_id: c.id }, "The correction could not be published.")}>
          Publish as version {source.current_version + 1}
        </Button>
      ) : null}
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    </li>
  );
}

function SourceDetail({ source, onChanged }: { source: KnowledgeSource; onChanged: () => void }) {
  const { isBuilder } = useAuth();
  const current = currentVersion(source);
  const [error, setError] = useState<string | null>(null);
  const [rollbackTo, setRollbackTo] = useState<number | null>(null);

  const submit = async (input: CorrectionInput): Promise<string | null> => {
    const { error: e } = await db.rpc("submit_knowledge_correction", {
      p_source_id: source.id, p_source_version: source.current_version, p_proposed_body: input.text, p_reason: input.reason, p_classification: input.classification,
    });
    if (e) return errorText(e.code, "The correction could not be saved.");
    onChanged();
    return null;
  };
  const rollback = async (to: number) => {
    setError(null);
    const { error: e } = await db.rpc("rollback_knowledge_source", {
      p_source_id: source.id, p_to_version: to, p_expected_version: source.current_version, p_reason: `Rolled back to version ${to} from the knowledge page`,
    });
    if (e) return setError(errorText(e.code, "The rollback failed."));
    onChanged();
  };

  return (
    <section aria-label={source.title} className="space-y-4 rounded-lg border border-input bg-background p-4">
      <div>
        <h2 className="text-base font-semibold">{source.title}</h2>
        <p className="text-[12px] text-muted-foreground">
          Version {source.current_version} · {source.release_scope === "client" ? `client ${source.client_slug}` : "all clients"} · {source.namespace}
          {source.citation_url ? <> · <a className="underline" href={source.citation_url} target="_blank" rel="noopener noreferrer">source</a></> : null}
        </p>
      </div>
      <p className="whitespace-pre-wrap text-sm" data-testid="knowledge-current-body">{current?.body}</p>

      <details>
        <summary className="cursor-pointer text-sm font-medium">Versions ({source.versions.length})</summary>
        <ul className="mt-2 space-y-1 text-sm">
          {source.versions.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-2">
              <span>{versionLabel(v)} · {fmtDate(v.created_at)}</span>
              {isBuilder && v.version < source.current_version ? (
                <Button size="sm" variant="outline" onClick={() => setRollbackTo(v.version)}>Roll back to this</Button>
              ) : null}
            </li>
          ))}
        </ul>
      </details>
      <ConfirmDialog
        open={rollbackTo !== null}
        onOpenChange={(open) => { if (!open) setRollbackTo(null); }}
        title={`Roll back to version ${rollbackTo ?? ""}?`}
        description={`"${source.title}" will go back to version ${rollbackTo ?? ""}. Version ${source.current_version} stays in the history.`}
        actionLabel="Roll back"
        onConfirm={() => {
          const to = rollbackTo;
          setRollbackTo(null);
          if (to !== null) void rollback(to);
        }}
      />

      <CorrectionForm heading="Propose a correction" initialText={current?.body ?? ""} sentMessage="Correction sent for review." onSubmit={submit} />
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

      {source.corrections.length ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Corrections</h3>
          <ul className="space-y-2">
            {source.corrections.map((c) => <CorrectionRow key={c.id} c={c} source={source} onChanged={onChanged} />)}
          </ul>
        </div>
      ) : null}
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
    const { data, error: e } = await db.from("knowledge_sources").select(SELECT).order("title");
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
  const openCount = (s: KnowledgeSource) => s.corrections.filter((c) => correctionStatus(c, s) === "open").length;

  return (
    <PageShell data-testid="knowledge">
      <PageHeader title="Knowledge" description="Shared Goodo knowledge. Propose a correction to what is on screen; another person reviews it before it is published." />
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
              <span className="text-muted-foreground"> · v{s.current_version} · {s.release_scope === "client" ? s.client_slug : "all clients"}{openCount(s) ? ` · ${openCount(s)} to review` : ""}</span>
            </button>
          </li>
        ))}
      </ul>
      {active ? <SourceDetail key={active.id} source={active} onChanged={() => void load()} /> : null}
    </PageShell>
  );
}
