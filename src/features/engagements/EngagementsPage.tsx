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
import { supabase } from "@/integrations/supabase/client";
import { useClientSelection } from "@/contexts/ClientSelectionContext";
import { PickClientPrompt } from "@/components/PickClientPrompt";
import { useAuth } from "@/contexts/AuthContext";
import { ErrorState, LoadingState, PageHeader, PageShell, EmptyState, SelectField, TextField, TextareaField } from "@/components/page-kit";
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
          <TextField label="Template name" hideLabel value={form.key} onChange={set("key")} />
          <SelectField
            label="Template scope"
            hideLabel
            value={form.scope}
            onChange={set("scope")}
            options={[{ value: "global", label: "All clients" }, { value: "client", label: "This client only", disabled: !clientSlug }]}
          />
          <SelectField
            label="Template type"
            hideLabel
            value={form.type}
            onChange={set("type")}
            options={(Object.keys(TYPE_LABEL) as EngagementType[]).map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
          />
        </div>
        <TextareaField
          label="Milestones"
          hint="One per line: key, or key | evidence, evidence | client, or | internal."
          inputClassName="min-h-[90px] font-mono"
          value={form.milestones}
          onChange={set("milestones")}
        />
        <TextareaField
          label="Agreed deliverables"
          hint="One per line: name | quantity | revision rounds."
          inputClassName="min-h-[70px] font-mono"
          value={form.deliverables}
          onChange={set("deliverables")}
        />
        <TextField label="Template source reference" hideLabel placeholder="Source reference (for example the signed agreement)" value={form.source} onChange={set("source")} />
        <Button size="sm" disabled={!TEMPLATE_KEY.test(form.key.trim()) || !form.source.trim()} onClick={() => void save()}>
          Save as version {expected + 1}
        </Button>
        {error ? <p role="alert" className="text-destructive">{error}</p> : null}
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
      <TextareaField label="Evidence limit" hideLabel inputClassName="min-h-[60px]" placeholder="What the evidence can and cannot support" value={form.limit} onChange={set("limit")} />
      <div className="grid gap-2 sm:grid-cols-2">
        <TextField label="Testing started" type="date" value={form.started} onChange={set("started")} />
        <TextField label="Testing ended" type="date" value={form.ended} onChange={set("ended")} />
      </div>
      <TextareaField label="Delivered assets" hideLabel placeholder="Delivered assets, one per line" value={form.assets} onChange={set("assets")} />
      <TextareaField label="Supported conclusions" hideLabel placeholder="Supported conclusions, one per line" value={form.conclusions} onChange={set("conclusions")} />
      <TextareaField label="Outstanding actions" hideLabel placeholder="Outstanding actions, one per line" value={form.actions} onChange={set("actions")} />
      <Button size="sm" disabled={!form.limit.trim()} onClick={() => void save()}>Save closeout version {(latest?.version ?? 0) + 1}</Button>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
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
          <TextField label="Kickoff date" type="date" value={start} onChange={(ev) => setStart(ev.target.value)} />
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
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}

export default function EngagementsPage() {
  const { isBuilder } = useAuth();
  // The client comes from the one switcher at the top of the app (or the client hub address).
  const { clients, selectedSlug: clientSlug } = useClientSelection();
  const [engagements, setEngagements] = useState<Engagement[] | null>(null);
  const [templates, setTemplates] = useState<EngagementTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [purchase, setPurchase] = useState("");
  const [error, setError] = useState<string | null>(null);

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
    <PageShell data-testid="engagements">
      <PageHeader title="Engagements" description="45-day cycles per client: create from a template, record the kickoff, write the closeout." />
      {!clientSlug ? <PickClientPrompt what="its engagements" /> : null}
      {isBuilder ? <TemplateForm templates={templates} clientSlug={clientSlug} onSaved={() => void loadTemplates()} /> : null}
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {clientSlug && client?.active ? (
        <div className="space-y-2 rounded-lg border border-input bg-background p-4">
          <h2 className="text-sm font-semibold">New engagement for {client.name}</h2>
          {available.length ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <SelectField
                label="Template"
                hideLabel
                className="sm:col-span-2"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                placeholder="Select a template"
                options={available.map((t) => ({ value: t.id, label: templateLabel(t) }))}
              />
              <TextField label="Purchase reference" hideLabel placeholder="Purchase reference" value={purchase} onChange={(e) => setPurchase(e.target.value)} />
            </div>
          ) : <EmptyState title="No template yet" description="A builder saves one above." />}
          <Button size="sm" disabled={!templateId} onClick={() => void create()}>Create next cycle</Button>
        </div>
      ) : null}
      {clientSlug && engagements === null ? <LoadingState label="Loading engagements" /> : null}
      {engagements && engagements.length === 0 && !error ? <EmptyState title="No engagements for this client yet" /> : null}
      {(engagements ?? []).map((e) => <EngagementCard key={e.id} engagement={e} onChanged={() => void load()} />)}
    </PageShell>
  );
}
