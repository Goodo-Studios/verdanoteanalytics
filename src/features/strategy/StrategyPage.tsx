// Strategy proposals: staff page (consolidation step 4c, port of the Goodo OS page
// StrategyProposals.tsx). A strategist writes a proposal for an engagement on top of a
// published idea or shot list: title, summary, goal, angle, brief and required inputs.
// Another staff member reviews the exact version (reviewed or changes requested) and
// accepts it; then it is published as the engagement strategy, which prefills new
// handoff packets. Every write goes through a checked database function (migration
// 20261110200001). Clients see none of it; publication here is internal.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSelectedClientSlug } from "@/contexts/ClientSelectionContext";
import { PickClientPrompt } from "@/components/PickClientPrompt";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  canAccept,
  canPublish,
  canReview,
  canRevise,
  currentVersion,
  errorText,
  parseInputs,
  type Proposal,
  type ProposalVersion,
  proposalState,
  type SourceSubject,
  sourceCurrent,
  STATE_LABEL,
  toProposals,
} from "./model";

// The strategy tables and functions are not in the generated types yet.
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
const SELECT = "*, strategy_proposal_versions(*), strategy_proposal_reviews(*), strategy_proposal_acceptances(*), strategy_proposal_publications(*)";
const field = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

interface ClientOption {
  slug: string;
  name: string;
}
interface EngagementOption {
  id: string;
  cycle_number: number;
  status: string;
}

type Draft = { source: string; title: string; summary: string; goal: string; angle: string; brief: string; inputs: string };
const EMPTY: Draft = { source: "", title: "", summary: "", goal: "", angle: "", brief: "", inputs: "" };
const fromVersion = (v: ProposalVersion): Draft => ({
  source: `${v.source_subject_id}:${v.source_version}`, title: v.title, summary: v.summary, goal: v.goal, angle: v.angle, brief: v.brief,
  inputs: v.required_inputs.join("\n"),
});

function DraftFields({ draft, setDraft, subjects }: { draft: Draft; setDraft: (d: Draft) => void; subjects: SourceSubject[] }) {
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value });
  const published = subjects.filter((s) => s.published_version);
  return (
    <div className="space-y-2">
      <select aria-label="Approved source" className={field} value={draft.source} onChange={set("source")}>
        <option value="">Published idea or shot list it is based on</option>
        {published.map((s) => (
          <option key={s.id} value={`${s.id}:${s.published_version}`}>{s.subject_kind === "idea" ? "Idea" : "Shot list"}: {s.title} (version {s.published_version})</option>
        ))}
      </select>
      <input aria-label="Title" className={field} placeholder="Title" value={draft.title} onChange={set("title")} />
      <input aria-label="Summary" className={field} placeholder="One-line summary" value={draft.summary} onChange={set("summary")} />
      <input aria-label="Goal" className={field} placeholder="Goal" value={draft.goal} onChange={set("goal")} />
      <input aria-label="Angle" className={field} placeholder="Angle" value={draft.angle} onChange={set("angle")} />
      <textarea aria-label="Brief" className={`${field} min-h-[100px]`} placeholder="Brief" value={draft.brief} onChange={set("brief")} />
      <textarea aria-label="Required inputs" className={field} placeholder="Required inputs, one per line" value={draft.inputs} onChange={set("inputs")} />
      {published.length === 0 ? <p className="text-muted-foreground">Publish an idea or shot list on the Deliverables page first.</p> : null}
    </div>
  );
}

const ready = (d: Draft) => d.source && d.title.trim() && d.summary.trim() && d.goal.trim() && d.angle.trim() && d.brief.trim() && parseInputs(d.inputs).length;
const draftArgs = (d: Draft) => {
  const [subject, version] = d.source.split(":");
  return {
    p_source_subject_id: subject, p_source_version: Number(version), p_title: d.title.trim(), p_summary: d.summary.trim(),
    p_brief: d.brief.trim(), p_angle: d.angle.trim(), p_goal: d.goal.trim(), p_required_inputs: parseInputs(d.inputs),
  };
};

function ProposalCard({ proposal, subjects, onChanged }: { proposal: Proposal; subjects: SourceSubject[]; onChanged: () => void }) {
  const { user } = useAuth();
  const v = currentVersion(proposal);
  const state = proposalState(proposal);
  const source = v ? subjects.find((s) => s.id === v.source_subject_id) : undefined;
  const current = sourceCurrent(proposal, subjects);
  const [note, setNote] = useState("");
  const [revision, setRevision] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = async (name: string, args: Record<string, unknown>, fallback: string) => {
    setError(null);
    const { error: e } = await db.rpc(name, args);
    if (e) return setError(errorText(e.code, fallback));
    onChanged();
  };
  const review = (decision: "reviewed" | "changes_requested") => {
    if (!note.trim()) return setError("Write a review note first.");
    void call("review_strategy_proposal", { p_proposal_id: proposal.id, p_version: proposal.current_version, p_decision: decision, p_note: note.trim() }, "The review could not be saved.");
  };
  if (!v) return null;
  return (
    <section aria-label={`Strategy proposal ${v.title}`} className="space-y-2 rounded-lg border border-input bg-background p-4 text-sm">
      <h3 className="text-base font-semibold">{v.title}</h3>
      <p className="text-[12px] text-muted-foreground" data-testid={`proposal-${proposal.id}`}>
        {STATE_LABEL[state]} · version {proposal.current_version} · based on {source ? `${source.title} version ${v.source_version}` : `version ${v.source_version} of an approval`}
        {current ? "" : " · the source has a newer published version, so this version cannot be reviewed, accepted or published"}
      </p>
      <p>{v.summary}</p>
      <p><span className="font-medium">Goal:</span> {v.goal}</p>
      <p><span className="font-medium">Angle:</span> {v.angle}</p>
      <p className="whitespace-pre-wrap rounded bg-muted/40 p-2">{v.brief}</p>
      <p className="font-medium">Required inputs</p>
      <ul className="list-disc pl-5">{v.required_inputs.map((i) => <li key={i}>{i}</li>)}</ul>
      {proposal.reviews.filter((r) => r.version === proposal.current_version).map((r) => (
        <p key={r.id} className="text-muted-foreground">Review: {r.decision === "reviewed" ? "reviewed" : "changes requested"}, {r.note}</p>
      ))}
      {canReview(proposal, user?.id) ? (
        <div className="space-y-2">
          <input aria-label="Review note" className={field} placeholder="Review note" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => review("reviewed")}>Mark reviewed</Button>
            <Button size="sm" variant="outline" onClick={() => review("changes_requested")}>Request changes</Button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canAccept(proposal, user?.id) ? (
          <Button size="sm" onClick={() => void call("accept_strategy_proposal", { p_proposal_id: proposal.id, p_version: proposal.current_version }, "It could not be accepted.")}>Accept version {proposal.current_version}</Button>
        ) : null}
        {canPublish(proposal) ? (
          <Button size="sm" onClick={() => void call("publish_strategy_proposal", { p_proposal_id: proposal.id, p_version: proposal.current_version }, "It could not be published.")}>Publish as the engagement strategy</Button>
        ) : null}
        {canRevise(proposal) && !revision ? <Button size="sm" variant="outline" onClick={() => setRevision(fromVersion(v))}>Write version {proposal.current_version + 1}</Button> : null}
      </div>
      {revision ? (
        <div className="space-y-2 rounded border border-input p-3">
          <DraftFields draft={revision} setDraft={setRevision} subjects={subjects} />
          <div className="flex gap-2">
            <Button size="sm" disabled={!ready(revision)} onClick={() => void call("revise_strategy_proposal", { p_proposal_id: proposal.id, p_expected_version: proposal.current_version, ...draftArgs(revision) }, "The new version could not be saved.")}>Save version {proposal.current_version + 1}</Button>
            <Button size="sm" variant="outline" onClick={() => setRevision(null)}>Cancel</Button>
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-red-700">{error}</p> : null}
    </section>
  );
}

function CreateForm({ engagementId, subjects, onCreated }: { engagementId: string; subjects: SourceSubject[]; onCreated: () => void }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setError(null);
    const { error: e } = await db.rpc("create_strategy_proposal", { p_engagement_id: engagementId, ...draftArgs(draft) });
    if (e) return setError(errorText(e.code, "The proposal could not be created."));
    setDraft(EMPTY);
    onCreated();
  };
  return (
    <details className="rounded-lg border border-input bg-background p-4 text-sm">
      <summary className="cursor-pointer font-medium">Write a strategy proposal</summary>
      <div className="mt-3 space-y-2">
        <DraftFields draft={draft} setDraft={setDraft} subjects={subjects} />
        <Button size="sm" disabled={!ready(draft)} onClick={() => void create()}>Create proposal</Button>
        {error ? <p role="alert" className="text-red-700">{error}</p> : null}
      </div>
    </details>
  );
}

export default function StrategyPage() {
  // The client comes from the one switcher at the top of the app (or the client hub address).
  const clientSlug = useSelectedClientSlug();
  const [engagements, setEngagements] = useState<EngagementOption[]>([]);
  const [engagementId, setEngagementId] = useState("");
  const [subjects, setSubjects] = useState<SourceSubject[]>([]);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEngagementId("");
    if (!clientSlug) return setEngagements([]);
    void db.from("engagements").select("id, cycle_number, status").eq("client_slug", clientSlug).order("cycle_number")
      .then(({ data }) => setEngagements(((data ?? []) as EngagementOption[]).slice().reverse()));
  }, [clientSlug]);

  const load = useCallback(async () => {
    if (!engagementId) {
      setSubjects([]);
      return setProposals(null);
    }
    const [s, p] = await Promise.all([
      db.from("approval_subjects").select("id, subject_kind, title, published_version").eq("engagement_id", engagementId).order("created_at"),
      db.from("strategy_proposals").select(SELECT).eq("engagement_id", engagementId).order("created_at"),
    ]);
    if (s.error || p.error) {
      setError("Strategy proposals could not load.");
      setProposals([]);
      return;
    }
    setError(null);
    setSubjects((s.data ?? []) as SourceSubject[]);
    setProposals(toProposals(p.data));
  }, [engagementId]);
  useEffect(() => void load(), [load]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4" data-testid="strategy">
      <PageHeader title="Strategy proposals" description="Proposals built on an approved idea or shot list. Another staff member reviews and accepts the exact version; the published version prefills handoff briefs." />
      <div className="grid gap-2 sm:grid-cols-2">
        {!clientSlug ? <div className="sm:col-span-2"><PickClientPrompt what="its strategy proposals" /></div> : null}
        <select aria-label="Engagement" className={field} value={engagementId} onChange={(e) => setEngagementId(e.target.value)} disabled={!clientSlug}>
          <option value="">Select an engagement</option>
          {engagements.map((e) => <option key={e.id} value={e.id}>Cycle {e.cycle_number} ({e.status})</option>)}
        </select>
      </div>
      {engagementId ? <CreateForm engagementId={engagementId} subjects={subjects} onCreated={() => void load()} /> : null}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {proposals && proposals.length === 0 ? <p className="text-sm text-muted-foreground">No strategy proposals for this engagement yet.</p> : null}
      {(proposals ?? []).map((p) => <ProposalCard key={`${p.id}:${p.current_version}`} proposal={p} subjects={subjects} onChanged={() => void load()} />)}
    </div>
  );
}
