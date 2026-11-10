// Engagements: staff page (consolidation step 4b, port of the Goodo OS pages
// EngagementSetup.tsx and CloseoutReview). Staff pick a client, see its 45-day
// cycles, create the next one from a template, record its kickoff once (the start
// date is then frozen), and write versioned closeout readouts. A builder saves
// template versions. Every write except closing or cancelling goes through a
// checked database function (migration 20261110120001); clients see none of the
// terms, milestones, templates or closeouts.
//
// Overlap: the old dashboard Client Detail page (step 5a) shows the same clients;
// it is not built here.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/formatters";
import {
  canKickoff,
  type Engagement,
  type EngagementTemplate,
  type EngagementType,
  errorText,
  expectedTemplateVersion,
  kickoffRecorded,
  latestCloseout,
  latestTemplates,
  lines,
  parseDeliverableLines,
  parseMilestoneLines,
  STATUS_LABEL,
  TEMPLATE_KEY,
  templateLabel,
  toEngagements,
  TYPE_LABEL,
} from "./model";

// The engagement setup tables and functions are not in the generated types yet.
interface DbResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}
interface Query extends PromiseLike<DbResult> {
  eq(column: string, value: unknown): Query;
  order(column: string): Query;
}
interface Untyped {
  from(table: string): { select(columns: string): Query; update(values: Record<string, unknown>): Query };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<DbResult>;
}
const db = supabase as unknown as Untyped;
const SELECT = "*, engagement_terms(*), engagement_notes(purchase_reference), engagement_milestones(*), engagement_closeouts(*)";
const field = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

interface ClientOption {
  slug: string;
  name: string;
  active: boolean;
}

function TemplateForm({ templates, clientSlug, onSaved }: { templates: EngagementTemplate[]; clientSlug: string; onSaved: () => void }) {
  const [form, setForm] = useState({ key: "standard-sprint", scope: "global", type: "standard_sprint", milestones: "kickoff\ndelivery", deliverables: "", source: "" });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const scopeSlug = form.scope === "client" ? clientSlug : null;
  const expected = expectedTemplateVersion(templates, form.key.trim(), scopeSlug);
  const save = async () => {
    setError(null);
    const milestones = parseMilestoneLines(form.milestones);
    if (!milestones.ok) return setError(milestones.error);
    const deliverables = parseDeliverableLines(form.deliverables);
    if (!deliverables.ok) return setError(deliverables.error);
    const { error: e } = await db.rpc("save_engagement_template", {
      p_template_key: form.key.trim(), p_client_slug: scopeSlug, p_expected_version: expected, p_template_type: form.type,
      p_milestone_template: milestones.value, p_agreed_deliverables: deliverables.value, p_source_reference: form.source.trim(),
    });
    if (e) return setError(errorText(e.code, "The template could not be saved."));
    setForm({ ...form, source: "" });
    onSaved();
  };
  return (
    <details className="rounded-lg border border-input bg-background p-4">
      <summary className="cursor-pointer text-sm font-medium">Save a template version (builder)</summary>
      <div className="mt-3 space-y-2 text-sm">
        <p className="text-muted-foreground">Saving an existing name makes a new version for future engagements. Engagements already created keep their copy.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <input aria-label="Template name" className={field} value={form.key} onChange={set("key")} />
          <select aria-label="Template scope" className={field} value={form.scope} onChange={set("scope")}>
            <option value="global">All clients</option>
            <option value="client" disabled={!clientSlug}>This client only</option>
          </select>
          <select aria-label="Template type" className={field} value={form.type} onChange={set("type")}>
            {(Object.keys(TYPE_LABEL) as EngagementType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </div>
        <label className="block">Milestones, one per line (<code>key</code>, or <code>key | evidence, evidence | client</code> or <code>| internal</code>)
          <textarea aria-label="Milestones" className={`${field} min-h-[90px] font-mono`} value={form.milestones} onChange={set("milestones")} />
        </label>
        <label className="block">Agreed deliverables, one per line (<code>name | quantity | revision rounds</code>)
          <textarea aria-label="Agreed deliverables" className={`${field} min-h-[70px] font-mono`} value={form.deliverables} onChange={set("deliverables")} />
        </label>
        <input aria-label="Template source reference" className={field} placeholder="Source reference (for example the signed agreement)" value={form.source} onChange={set("source")} />
        <Button size="sm" disabled={!TEMPLATE_KEY.test(form.key.trim()) || !form.source.trim()} onClick={() => void save()}>
          Save as version {expected + 1}
        </Button>
        {error ? <p role="alert" className="text-red-700">{error}</p> : null}
      </div>
    </details>
  );
}

function CloseoutForm({ engagement, onSaved }: { engagement: Engagement; onSaved: () => void }) {
  const latest = latestCloseout(engagement);
  const [form, setForm] = useState({
    limit: latest?.evidence_limit ?? "",
    started: latest?.testing_started_at?.slice(0, 10) ?? "",
    ended: latest?.testing_ended_at?.slice(0, 10) ?? "",
    assets: (latest?.delivered_assets ?? []).join("\n"),
    conclusions: (latest?.supported_conclusions ?? []).join("\n"),
    actions: (latest?.outstanding_actions ?? []).join("\n"),
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const save = async () => {
    setError(null);
    const { error: e } = await db.rpc("save_engagement_closeout", {
      p_engagement_id: engagement.id, p_expected_version: latest?.version ?? 0, p_evidence_limit: form.limit.trim(),
      p_testing_started_at: form.started ? `${form.started}T00:00:00Z` : null, p_testing_ended_at: form.ended ? `${form.ended}T00:00:00Z` : null,
      p_delivered_assets: lines(form.assets), p_supported_conclusions: lines(form.conclusions), p_outstanding_actions: lines(form.actions),
    });
    if (e) return setError(errorText(e.code, "The closeout could not be saved."));
    onSaved();
  };
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">Closeout readout{latest ? ` (version ${latest.version})` : ""}</h4>
      <textarea aria-label="Evidence limit" className={`${field} min-h-[60px]`} placeholder="What the evidence can and cannot support" value={form.limit} onChange={set("limit")} />
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-sm">Testing started<input aria-label="Testing started" type="date" className={field} value={form.started} onChange={set("started")} /></label>
        <label className="text-sm">Testing ended<input aria-label="Testing ended" type="date" className={field} value={form.ended} onChange={set("ended")} /></label>
      </div>
      <textarea aria-label="Delivered assets" className={field} placeholder="Delivered assets, one per line" value={form.assets} onChange={set("assets")} />
      <textarea aria-label="Supported conclusions" className={field} placeholder="Supported conclusions, one per line" value={form.conclusions} onChange={set("conclusions")} />
      <textarea aria-label="Outstanding actions" className={field} placeholder="Outstanding actions, one per line" value={form.actions} onChange={set("actions")} />
      <Button size="sm" disabled={!form.limit.trim()} onClick={() => void save()}>Save closeout version {(latest?.version ?? 0) + 1}</Button>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}

function EngagementCard({ engagement, onChanged }: { engagement: Engagement; onChanged: () => void }) {
  const [start, setStart] = useState("");
  const [error, setError] = useState<string | null>(null);
  const kickoff = async () => {
    setError(null);
    const { error: e } = await db.rpc("record_engagement_kickoff", { p_engagement_id: engagement.id, p_start_date: start });
    if (e) return setError(errorText(e.code, "The kickoff could not be recorded."));
    onChanged();
  };
  const setStatus = async (status: "closed" | "cancelled") => {
    setError(null);
    const { error: e } = await db.from("engagements").update({ status }).eq("id", engagement.id);
    if (e) return setError(errorText(e.code, "The status could not be changed."));
    onChanged();
  };
  const e = engagement;
  return (
    <section aria-label={`Cycle ${e.cycle_number}`} className="space-y-3 rounded-lg border border-input bg-background p-4">
      <div>
        <h3 className="text-base font-semibold">Cycle {e.cycle_number} · {TYPE_LABEL[e.engagement_type]} · {STATUS_LABEL[e.status]}</h3>
        <p className="text-[12px] text-muted-foreground" data-testid={`dates-${e.id}`}>
          {e.start_date ? `Day 1 ${fmtDate(e.start_date)}` : "No kickoff yet"}
          {e.day30_date ? ` · Day 30 ${fmtDate(e.day30_date)} · Day 45 ${fmtDate(e.day45_date)}` : ""}
          {kickoffRecorded(e) ? " · kickoff recorded, dates fixed" : ""}
          {e.purchase_reference ? ` · purchase ${e.purchase_reference}` : ""}
        </p>
      </div>
      {canKickoff(e) ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">Actual kickoff date<input aria-label="Kickoff date" type="date" className={field} value={start} onChange={(ev) => setStart(ev.target.value)} /></label>
          <Button size="sm" disabled={!start} onClick={() => void kickoff()}>Record kickoff</Button>
          <Button size="sm" variant="outline" onClick={() => void setStatus("cancelled")}>Cancel engagement</Button>
        </div>
      ) : null}
      {e.status === "active" ? <Button size="sm" variant="outline" onClick={() => void setStatus("closed")}>Mark closed</Button> : null}
      {e.milestones.length ? (
        <div>
          <h4 className="text-sm font-semibold">Milestones</h4>
          <ol className="list-decimal pl-5 text-sm">
            {e.milestones.map((m) => (
              <li key={m.milestone_key}>{m.milestone_key}: {m.required_evidence.join(", ")}{m.client_visible ? "" : " (internal)"}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {e.status !== "planned" && e.status !== "cancelled" ? <CloseoutForm key={latestCloseout(e)?.id ?? "new"} engagement={e} onSaved={onChanged} /> : null}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    </section>
  );
}

export default function EngagementsPage() {
  const { isBuilder } = useAuth();
  // Optional ?client=<slug> (from a client page) preselects that client.
  const [searchParams] = useSearchParams();
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientSlug, setClientSlug] = useState(() => searchParams.get("client") ?? "");
  const [engagements, setEngagements] = useState<Engagement[] | null>(null);
  const [templates, setTemplates] = useState<EngagementTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [purchase, setPurchase] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void db.from("clients").select("slug, name, active").order("name").then(({ data }) => {
      const list = (data ?? []) as ClientOption[];
      setClients(list);
      // Drop a preselected client that is not in the list (unknown or hidden slug).
      setClientSlug((slug) => (slug && !list.some((c) => c.slug === slug) ? "" : slug));
    });
  }, []);

  const loadTemplates = useCallback(async () => {
    const { data } = await db.from("engagement_templates").select("*").order("template_key");
    setTemplates((data ?? []) as EngagementTemplate[]);
  }, []);
  useEffect(() => void loadTemplates(), [loadTemplates]);

  const load = useCallback(async () => {
    if (!clientSlug) return setEngagements(null);
    const { data, error: e } = await db.from("engagements").select(SELECT).eq("client_slug", clientSlug).order("cycle_number");
    if (e) {
      setError("Engagements could not load.");
      setEngagements([]);
    } else setEngagements(toEngagements(data));
  }, [clientSlug]);
  useEffect(() => void load(), [load]);

  const available = useMemo(() => latestTemplates(templates, clientSlug || null), [templates, clientSlug]);
  const client = clients.find((c) => c.slug === clientSlug);

  const create = async () => {
    setError(null);
    const { error: e } = await db.rpc("create_engagement_from_template", { p_client_slug: clientSlug, p_template_id: templateId, p_purchase_reference: purchase.trim() || null });
    if (e) return setError(errorText(e.code, "The engagement could not be created."));
    setPurchase("");
    void load();
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4" data-testid="engagements">
      <PageHeader title="Engagements" description="45-day cycles per client: create from a template, record the kickoff, write the closeout." />
      <select aria-label="Client" className={field} value={clientSlug} onChange={(e) => setClientSlug(e.target.value)}>
        <option value="">Select a client</option>
        {clients.map((c) => <option key={c.slug} value={c.slug}>{c.name}{c.active ? "" : " (inactive)"}</option>)}
      </select>
      {isBuilder ? <TemplateForm templates={templates} clientSlug={clientSlug} onSaved={() => void loadTemplates()} /> : null}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {clientSlug && client?.active ? (
        <div className="space-y-2 rounded-lg border border-input bg-background p-4">
          <h2 className="text-sm font-semibold">New engagement for {client.name}</h2>
          {available.length ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <select aria-label="Template" className={`${field} sm:col-span-2`} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">Select a template</option>
                {available.map((t) => <option key={t.id} value={t.id}>{templateLabel(t)}</option>)}
              </select>
              <input aria-label="Purchase reference" className={field} placeholder="Purchase reference" value={purchase} onChange={(e) => setPurchase(e.target.value)} />
            </div>
          ) : <p className="text-sm text-muted-foreground">No template yet. A builder saves one above.</p>}
          <Button size="sm" disabled={!templateId} onClick={() => void create()}>Create next cycle</Button>
        </div>
      ) : null}
      {clientSlug && engagements === null ? <p role="status" className="text-sm text-muted-foreground">Loading engagements...</p> : null}
      {engagements && engagements.length === 0 ? <p className="text-sm text-muted-foreground">No engagements for this client yet.</p> : null}
      {(engagements ?? []).map((e) => <EngagementCard key={e.id} engagement={e} onChanged={() => void load()} />)}
    </div>
  );
}
