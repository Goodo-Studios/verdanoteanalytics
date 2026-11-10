// Recommendations: staff page (consolidation step 4c, port of the Goodo OS page
// RecommendationOutcomes.tsx). Staff propose a creative or service recommendation for
// an engagement, decide it (accepted with a hypothesis and final action, rejected or
// deferred) citing the client's ads, link the ads that execute it with a review window,
// and record an outcome the database computes from Verdanote's ad metrics. A person
// writes the learning only after a measured outcome whose evidence is unchanged. Every
// write goes through a checked database function (migration 20261110200003); clients
// see none of it, and the page shows only numbers the database stored.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSelectedClientSlug } from "@/contexts/ClientSelectionContext";
import { PickClientPrompt } from "@/components/PickClientPrompt";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  canDecide,
  canLearn,
  canLink,
  errorText,
  evidenceTotals,
  latestDecision,
  latestLearning,
  latestLink,
  latestOutcome,
  OUTCOME_LABEL,
  REASON_LABEL,
  type Recommendation,
  SELECT,
  STATE_LABEL,
  toRecommendations,
} from "./model";

// The recommendation tables and functions are not in the generated types yet.
interface DbResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}
interface Query extends PromiseLike<DbResult> {
  eq(column: string, value: unknown): Query;
  order(column: string): Query;
}
interface Untyped {
  from(table: string): { select(columns: string): Query };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<DbResult>;
}
const db = supabase as unknown as Untyped;
const field = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface ClientOption {
  slug: string;
  name: string;
}
interface EngagementOption {
  id: string;
  cycle_number: number;
  status: string;
}
interface AdOption {
  ad_id: string;
  ad_name: string;
  account_id: string;
}
interface StaffOption {
  user_id: string;
  display_name: string | null;
  email: string;
}
interface TaskOption {
  id: string;
  task_name: string | null;
  stage: string;
}

function AdPicker({ label, ads, value, onChange }: { label: string; ads: AdOption[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <select aria-label={label} multiple className={`${field} h-28`} value={value}
      onChange={(e) => onChange(Array.from(e.target.selectedOptions).map((o) => o.value))}>
      {ads.map((a) => <option key={a.ad_id} value={a.ad_id}>{a.ad_name} ({a.ad_id})</option>)}
    </select>
  );
}

function RecommendationCard({ rec, ads, staff, tasks, onChanged }: { rec: Recommendation; ads: AdOption[]; staff: StaffOption[]; tasks: TaskOption[]; onChanged: () => void }) {
  const decision = latestDecision(rec);
  const link = latestLink(rec);
  const outcome = latestOutcome(rec);
  const learning = latestLearning(rec);
  const [d, setD] = useState({ decision: "accepted", reason: "", hypothesis: "", finalAction: "", cited: [] as string[] });
  const [l, setL] = useState({ ads: [] as string[], task: "", owner: "", start: "", end: "" });
  const [lr, setLr] = useState({ conclusion: "supported", learning: "" });
  const [error, setError] = useState<string | null>(null);
  const adName = (id: string) => ads.find((a) => a.ad_id === id)?.ad_name ?? id;

  const call = async (name: string, args: Record<string, unknown>, fallback: string) => {
    setError(null);
    const { error: e } = await db.rpc(name, args);
    if (e) return setError(errorText(e.code, fallback));
    onChanged();
  };
  const decide = () => {
    if (!d.reason.trim()) return setError("Write the reason first.");
    if (d.decision === "accepted" && (!d.hypothesis.trim() || !d.finalAction.trim())) return setError("Accepting needs a hypothesis and a final action.");
    void call("decide_recommendation", {
      p_recommendation_id: rec.id, p_expected_version: rec.version, p_decision: d.decision, p_reason: d.reason.trim(),
      p_hypothesis: d.hypothesis.trim() || null, p_final_action: d.finalAction.trim() || null, p_evidence: d.cited.map((id) => ({ kind: "ad", id })),
    }, "The decision could not be saved.");
  };
  const totals = outcome ? evidenceTotals(outcome.recommendation_outcome_evidence) : null;

  return (
    <section aria-label={`Recommendation ${rec.title}`} className="space-y-2 rounded-lg border border-input bg-background p-4 text-sm">
      <h3 className="text-base font-semibold">{rec.title}</h3>
      <p className="text-[12px] text-muted-foreground" data-testid={`rec-${rec.id}`}>
        {STATE_LABEL[rec.state]} · {rec.category} · version {rec.version}
      </p>
      <p className="whitespace-pre-wrap">{rec.proposal}</p>
      {decision ? (
        <div className="rounded bg-muted/40 p-2">
          <p><span className="font-medium">Decision:</span> {decision.decision}, {decision.reason}</p>
          {decision.hypothesis ? <p><span className="font-medium">Hypothesis:</span> {decision.hypothesis}</p> : null}
          {decision.final_action ? <p><span className="font-medium">Final action:</span> {decision.final_action}</p> : null}
          {decision.evidence.length ? <p><span className="font-medium">Evidence:</span> {decision.evidence.map((e) => (e.kind === "ad" ? adName(e.id) : `recap item ${e.id}`)).join(", ")}</p> : null}
        </div>
      ) : null}
      {link ? <p><span className="font-medium">Executed by:</span> {link.ad_ids.map(adName).join(", ")} · review window {link.review_window_start} to {link.review_window_end}</p> : null}
      {outcome && totals ? (
        <div className="space-y-1" data-testid={`outcome-${rec.id}`}>
          <p><span className="font-medium">{OUTCOME_LABEL[outcome.status]}</span>: {REASON_LABEL[outcome.reason] ?? outcome.reason}</p>
          {outcome.recommendation_outcome_evidence.length ? (
            <table className="w-full text-[12px]">
              <thead><tr className="text-left"><th>Ad</th><th>Impressions</th><th>Spend</th><th>Clicks</th><th>Purchases</th><th>Purchase value</th><th>Days</th></tr></thead>
              <tbody>
                {outcome.recommendation_outcome_evidence.map((e) => (
                  <tr key={e.ad_id}><td>{adName(e.ad_id)}</td><td>{Number(e.impressions).toLocaleString()}</td><td>{money(Number(e.spend))}</td><td>{Number(e.clicks).toLocaleString()}</td><td>{Number(e.purchases)}</td><td>{money(Number(e.purchase_value))}</td><td>{e.metric_days}</td></tr>
                ))}
                <tr className="font-medium"><td>Total</td><td>{totals.impressions.toLocaleString()}</td><td>{money(totals.spend)}</td><td>{totals.clicks.toLocaleString()}</td><td>{totals.purchases}</td><td>{money(totals.purchase_value)}</td><td /></tr>
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}
      {learning ? <p><span className="font-medium">Learning ({learning.conclusion.replace("_", " ")}):</span> {learning.learning}</p> : null}

      {canDecide(rec) ? (
        <details>
          <summary className="cursor-pointer font-medium">Decide</summary>
          <div className="mt-2 space-y-2">
            <select aria-label="Decision" className={field} value={d.decision} onChange={(e) => setD({ ...d, decision: e.target.value })}>
              <option value="accepted">Accept</option>
              <option value="rejected">Reject</option>
              <option value="deferred">Defer</option>
            </select>
            <input aria-label="Reason" className={field} placeholder="Reason" value={d.reason} onChange={(e) => setD({ ...d, reason: e.target.value })} />
            <input aria-label="Hypothesis" className={field} placeholder="Hypothesis (needed to accept)" value={d.hypothesis} onChange={(e) => setD({ ...d, hypothesis: e.target.value })} />
            <input aria-label="Final action" className={field} placeholder="Final action (needed to accept)" value={d.finalAction} onChange={(e) => setD({ ...d, finalAction: e.target.value })} />
            <AdPicker label="Cited ads" ads={ads} value={d.cited} onChange={(cited) => setD({ ...d, cited })} />
            <Button size="sm" onClick={decide}>Save decision</Button>
          </div>
        </details>
      ) : null}
      {canLink(rec) ? (
        <details>
          <summary className="cursor-pointer font-medium">{link ? "Replace the linked ads" : "Link the ads that execute it"}</summary>
          <div className="mt-2 space-y-2">
            <AdPicker label="Linked ads" ads={ads} value={l.ads} onChange={(v) => setL({ ...l, ads: v })} />
            <div className="grid gap-2 sm:grid-cols-2">
              <select aria-label="Content Pipeline task" className={field} value={l.task} onChange={(e) => setL({ ...l, task: e.target.value })}>
                <option value="">No Content Pipeline task</option>
                {tasks.map((t) => <option key={t.id} value={t.id}>{t.task_name ?? t.id} ({t.stage})</option>)}
              </select>
              <select aria-label="Accountable owner" className={field} value={l.owner} onChange={(e) => setL({ ...l, owner: e.target.value })}>
                <option value="">Accountable owner</option>
                {staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.display_name || s.email}</option>)}
              </select>
              <input aria-label="Window start" type="date" className={field} value={l.start} onChange={(e) => setL({ ...l, start: e.target.value })} />
              <input aria-label="Window end" type="date" className={field} value={l.end} onChange={(e) => setL({ ...l, end: e.target.value })} />
            </div>
            <Button size="sm" disabled={!l.ads.length || !l.owner || !l.start || !l.end} onClick={() => void call("link_recommendation_execution", {
              p_recommendation_id: rec.id, p_expected_version: rec.version, p_ad_ids: l.ads, p_pipeline_task_id: l.task || null,
              p_accountable_owner_id: l.owner, p_review_window_start: l.start, p_review_window_end: l.end,
            }, "The ads could not be linked.")}>Save link</Button>
          </div>
        </details>
      ) : null}
      {rec.state !== "proposed" ? (
        <Button size="sm" variant="outline" onClick={() => void call("record_recommendation_outcome", { p_recommendation_id: rec.id, p_expected_version: rec.version }, "The outcome could not be recorded.")}>
          Evaluate from ad data
        </Button>
      ) : null}
      {canLearn(rec) && outcome ? (
        <div className="space-y-2 rounded border border-input p-3">
          <p className="font-medium">Review the measured outcome</p>
          <select aria-label="Conclusion" className={field} value={lr.conclusion} onChange={(e) => setLr({ ...lr, conclusion: e.target.value })}>
            <option value="supported">Supported</option>
            <option value="not_supported">Not supported</option>
            <option value="inconclusive">Inconclusive</option>
          </select>
          <textarea aria-label="Learning" className={field} placeholder="What we learned, in your words" value={lr.learning} onChange={(e) => setLr({ ...lr, learning: e.target.value })} />
          <Button size="sm" disabled={!lr.learning.trim()} onClick={() => void call("review_recommendation_learning", {
            p_recommendation_id: rec.id, p_expected_version: rec.version, p_outcome_id: outcome.id, p_conclusion: lr.conclusion, p_learning: lr.learning.trim(),
          }, "The learning could not be saved.")}>Save learning</Button>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-red-700">{error}</p> : null}
    </section>
  );
}

function ProposeForm({ engagementId, onCreated }: { engagementId: string; onCreated: () => void }) {
  const [f, setF] = useState({ category: "creative", title: "", proposal: "" });
  const [error, setError] = useState<string | null>(null);
  const propose = async () => {
    setError(null);
    const { error: e } = await db.rpc("propose_recommendation", { p_engagement_id: engagementId, p_category: f.category, p_title: f.title.trim(), p_proposal: f.proposal.trim() });
    if (e) return setError(errorText(e.code, "The recommendation could not be saved."));
    setF({ category: "creative", title: "", proposal: "" });
    onCreated();
  };
  return (
    <details className="rounded-lg border border-input bg-background p-4 text-sm">
      <summary className="cursor-pointer font-medium">Propose a recommendation</summary>
      <div className="mt-3 space-y-2">
        <select aria-label="Category" className={field} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
          <option value="creative">Creative</option>
          <option value="service">Service</option>
        </select>
        <input aria-label="Title" className={field} placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <textarea aria-label="Proposal" className={field} placeholder="The recommendation" value={f.proposal} onChange={(e) => setF({ ...f, proposal: e.target.value })} />
        <Button size="sm" disabled={!f.title.trim() || !f.proposal.trim()} onClick={() => void propose()}>Propose</Button>
        {error ? <p role="alert" className="text-red-700">{error}</p> : null}
      </div>
    </details>
  );
}

export default function RecommendationsPage() {
  // The client comes from the one switcher at the top of the app (or the client hub address).
  const clientSlug = useSelectedClientSlug();
  const [engagements, setEngagements] = useState<EngagementOption[]>([]);
  const [engagementId, setEngagementId] = useState("");
  const [ads, setAds] = useState<AdOption[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void db.rpc("handoff_staff_options", {}).then(({ data }) => setStaff((data ?? []) as StaffOption[]));
  }, []);
  useEffect(() => {
    setEngagementId("");
    if (!clientSlug) {
      setAds([]);
      setTasks([]);
      return setEngagements([]);
    }
    void db.from("engagements").select("id, cycle_number, status").eq("client_slug", clientSlug).order("cycle_number")
      .then(({ data }) => setEngagements(((data ?? []) as EngagementOption[]).slice().reverse()));
    void db.rpc("recommendation_ad_options", { p_client_slug: clientSlug }).then(({ data }) => setAds((data ?? []) as AdOption[]));
    void db.from("pipeline_tasks").select("id, task_name, stage").eq("client_slug", clientSlug).order("task_name")
      .then(({ data }) => setTasks((data ?? []) as TaskOption[]));
  }, [clientSlug]);

  const load = useCallback(async () => {
    if (!engagementId) return setRecs(null);
    const { data, error: e } = await db.from("recommendations").select(SELECT).eq("engagement_id", engagementId).order("created_at");
    if (e) {
      setError("Recommendations could not load.");
      setRecs([]);
      return;
    }
    setError(null);
    setRecs(toRecommendations(data));
  }, [engagementId]);
  useEffect(() => void load(), [load]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4" data-testid="recommendations">
      <PageHeader title="Recommendations" description="From decision to measured outcome. Outcomes are computed from the client's ad data and are never a win by themselves; a person writes the learning." />
      <div className="grid gap-2 sm:grid-cols-2">
        {!clientSlug ? <div className="sm:col-span-2"><PickClientPrompt what="its recommendations" /></div> : null}
        <select aria-label="Engagement" className={field} value={engagementId} onChange={(e) => setEngagementId(e.target.value)} disabled={!clientSlug}>
          <option value="">Select an engagement</option>
          {engagements.map((e) => <option key={e.id} value={e.id}>Cycle {e.cycle_number} ({e.status})</option>)}
        </select>
      </div>
      {engagementId ? <ProposeForm engagementId={engagementId} onCreated={() => void load()} /> : null}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {recs && recs.length === 0 ? <p className="text-sm text-muted-foreground">No recommendations for this engagement yet.</p> : null}
      {(recs ?? []).map((r) => <RecommendationCard key={`${r.id}:${r.version}`} rec={r} ads={ads} staff={staff} tasks={tasks} onChanged={() => void load()} />)}
    </div>
  );
}
