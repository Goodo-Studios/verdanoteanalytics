// Learning: staff page (consolidation step 4c, port of the Goodo OS staff pages
// LearningEditor, LearningReview, LearningWithdraw and LearningSelfService). Lessons
// tab: staff write a client lesson as numbered drafts and name a reviewer; the reviewer
// accepts it for review, then approves or rejects it; a builder publishes an approved
// lesson that passes the checks, or withdraws it with a reason. Self-service tab: the
// weekly tally of recurring how-to questions per engagement and a baseline against
// pilot snapshot. Every write goes through a checked database function (migration
// 20261110200005). Clients see none of it: the client learning library is phase 2.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSelectedClientSlug } from "@/contexts/ClientSelectionContext";
import { PickClientPrompt } from "@/components/PickClientPrompt";
import { useAuth } from "@/contexts/AuthContext";
import { EmptyState, ErrorState, PageHeader, PageShell, SelectField, TextField, TextareaField } from "@/components/page-kit";
import { fmtDate } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import {
  canAccept,
  canDecide,
  currentVersion,
  errorText,
  type Lesson,
  lines,
  MODULE_SELECT,
  mondayOf,
  publicationBlockers,
  reviewStage,
  type Snapshot,
  STAGE_LABEL,
  type SupportWeek,
  toLessons,
} from "./model";

// The learning tables and functions are not in the generated types yet.
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

interface ClientOption {
  slug: string;
  name: string;
}
interface StaffOption {
  user_id: string;
  display_name: string | null;
  email: string;
}
interface EngagementOption {
  id: string;
  cycle_number: number;
  status: string;
}

type Draft = { summary: string; steps: string; checklist: string; sources: string; standard: boolean; custom: boolean; clearance: string; rights: string; gaps: string; reviewer: string };
const blankDraft: Draft = { summary: "", steps: "", checklist: "", sources: "", standard: true, custom: false, clearance: "pending", rights: "internal_draft_only", gaps: "", reviewer: "" };

function DraftEditor({ lesson, staff, onSaved }: { lesson: Lesson; staff: StaffOption[]; onSaved: () => void }) {
  const { user } = useAuth();
  const v = currentVersion(lesson);
  const [d, setD] = useState<Draft>(v ? {
    summary: v.summary, steps: v.steps.join("\n"), checklist: v.checklist.join("\n"), sources: v.source_refs.join("\n"),
    standard: v.applicability.includes("standard"), custom: v.applicability.includes("custom"), clearance: v.source_clearance,
    rights: v.client_use_rights, gaps: v.blocking_gaps.join("\n"), reviewer: v.assigned_reviewer ?? "",
  } : blankDraft);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  const save = async () => {
    setError(null);
    const { error: e } = await db.rpc("save_learning_draft", {
      p_module_id: lesson.id, p_expected_version: lesson.current_version, p_summary: d.summary.trim(), p_steps: lines(d.steps),
      p_checklist: lines(d.checklist), p_source_refs: lines(d.sources),
      p_applicability: [d.standard ? "standard" : null, d.custom ? "custom" : null].filter(Boolean),
      p_source_clearance: d.clearance, p_client_use_rights: d.rights, p_blocking_gaps: lines(d.gaps), p_assigned_reviewer: d.reviewer || null,
    });
    if (e) return setError(errorText(e.code, "The draft could not be saved."));
    onSaved();
  };
  return (
    <details>
      <summary className="cursor-pointer font-medium">Write version {lesson.current_version + 1}</summary>
      <div className="mt-2 space-y-2">
        <TextField label="Summary" hideLabel placeholder="Summary" value={d.summary} onChange={set("summary")} />
        <TextareaField label="Steps" hideLabel placeholder="Steps, one per line" value={d.steps} onChange={set("steps")} />
        <TextareaField label="Checklist" hideLabel placeholder="Checklist, one per line" value={d.checklist} onChange={set("checklist")} />
        <TextareaField label="Source links" hideLabel placeholder="Source links (https), one per line" value={d.sources} onChange={set("sources")} />
        <TextareaField label="Blocking gaps" hideLabel placeholder="Blocking gaps, one per line (publication needs none)" value={d.gaps} onChange={set("gaps")} />
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-1"><input type="checkbox" checked={d.standard} onChange={(e) => setD({ ...d, standard: e.target.checked })} /> Standard engagements</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={d.custom} onChange={(e) => setD({ ...d, custom: e.target.checked })} /> Custom engagements</label>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <SelectField label="Source clearance" hideLabel value={d.clearance} onChange={set("clearance")} options={[{ value: "pending", label: "Sources pending" }, { value: "cleared", label: "Sources cleared" }, { value: "source_blocked", label: "Source blocked" }]} />
          <SelectField label="Client use rights" hideLabel value={d.rights} onChange={set("rights")} options={[{ value: "internal_draft_only", label: "Internal draft only" }, { value: "client_approved", label: "Client approved" }, { value: "prohibited", label: "Prohibited" }]} />
          <SelectField label="Reviewer" hideLabel value={d.reviewer} onChange={set("reviewer")} placeholder="No reviewer yet" options={staff.filter((s) => s.user_id !== user?.id).map((s) => ({ value: s.user_id, label: s.display_name || s.email }))} />
        </div>
        <Button size="sm" disabled={!d.summary.trim()} onClick={() => void save()}>Save version {lesson.current_version + 1}</Button>
        {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      </div>
    </details>
  );
}

function LessonCard({ lesson, staff, onChanged }: { lesson: Lesson; staff: StaffOption[]; onChanged: () => void }) {
  const { user, isBuilder } = useAuth();
  const v = currentVersion(lesson);
  const blockers = publicationBlockers(lesson);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const call = async (name: string, args: Record<string, unknown>, fallback: string) => {
    setError(null);
    const { error: e } = await db.rpc(name, args);
    if (e) return setError(errorText(e.code, fallback));
    onChanged();
  };
  const review = (action: string) => void call("review_learning_version", { p_module_id: lesson.id, p_version: lesson.current_version, p_action: action, p_note: note.trim() || null }, "The review could not be saved.");
  return (
    <section aria-label={`Lesson ${lesson.title}`} className="space-y-2 rounded-lg border border-input bg-background p-4 text-sm">
      <h3 className="text-base font-semibold">{lesson.title} <span className="text-[12px] font-normal text-muted-foreground">({lesson.module_key})</span></h3>
      <p className="text-[12px] text-muted-foreground" data-testid={`lesson-${lesson.id}`}>
        {v ? `Version ${lesson.current_version} · ${STAGE_LABEL[reviewStage(lesson)]}` : "No draft yet"}
        {lesson.active ? ` · published version ${lesson.published_version}` : lesson.published_version ? " · withdrawn" : ""}
      </p>
      {v ? (
        <div className="space-y-1">
          <p>{v.summary}</p>
          {v.steps.length ? <ol className="list-decimal pl-5">{v.steps.map((s) => <li key={s}>{s}</li>)}</ol> : null}
          {v.checklist.length ? <ul className="list-disc pl-5">{v.checklist.map((s) => <li key={s}>{s}</li>)}</ul> : null}
          {v.source_refs.map((r) => <p key={r} className="text-[12px]">Source: {r}</p>)}
        </div>
      ) : null}
      {lesson.history.map((h) => <p key={h.id} className="text-muted-foreground">Version {h.version} {h.action}{h.reason ? `: ${h.reason}` : ""}</p>)}
      {canAccept(lesson, user?.id) ? <Button size="sm" variant="outline" onClick={() => review("accepted")}>Accept for review</Button> : null}
      {canDecide(lesson, user?.id) ? (
        <div className="space-y-2">
          <TextField label="Review note" hideLabel placeholder="Review note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => review("approved")}>Approve</Button>
            <Button size="sm" variant="outline" onClick={() => review("rejected")}>Reject</Button>
          </div>
        </div>
      ) : null}
      {isBuilder && v ? (
        blockers.length ? <p className="text-[12px] text-muted-foreground" data-testid={`blockers-${lesson.id}`}>Cannot publish yet: {blockers.join(", ")}.</p>
          : <Button size="sm" onClick={() => void call("publish_learning_version", { p_module_id: lesson.id, p_version: lesson.current_version }, "It could not be published.")}>Publish version {lesson.current_version}</Button>
      ) : null}
      {isBuilder && lesson.active ? (
        <div className="flex gap-2">
          <TextField label="Withdrawal reason" hideLabel placeholder="Why it is withdrawn" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="sm" variant="outline" disabled={!reason.trim()} onClick={() => void call("withdraw_learning_module", { p_module_id: lesson.id, p_reason: reason.trim() }, "It could not be withdrawn.")}>Withdraw</Button>
        </div>
      ) : null}
      <DraftEditor key={lesson.current_version} lesson={lesson} staff={staff} onSaved={onChanged} />
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    </section>
  );
}

function LessonsTab({ staff }: { staff: StaffOption[] }) {
  const clientSlug = useSelectedClientSlug();
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [form, setForm] = useState({ key: "", title: "" });
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!clientSlug) return setLessons(null);
    const { data, error: e } = await db.from("learning_modules").select(MODULE_SELECT).eq("client_slug", clientSlug).order("title");
    if (e) {
      setError("Lessons could not load.");
      return setLessons([]);
    }
    setError(null);
    setLessons(toLessons(data));
  }, [clientSlug]);
  useEffect(() => void load(), [load]);
  const create = async () => {
    setError(null);
    const { error: e } = await db.rpc("create_learning_module", { p_client_slug: clientSlug, p_module_key: form.key.trim(), p_title: form.title.trim() });
    if (e) return setError(errorText(e.code, "The lesson could not be created."));
    setForm({ key: "", title: "" });
    void load();
  };
  return (
    <div className="space-y-3">
      {!clientSlug ? <PickClientPrompt what="its lessons" /> : null}
      {clientSlug ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <TextField label="Lesson key" hideLabel placeholder="lesson-key" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
          <TextField label="Lesson title" hideLabel placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Button size="sm" disabled={!form.key.trim() || !form.title.trim()} onClick={() => void create()}>Add lesson</Button>
        </div>
      ) : null}
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {lessons && !error && lessons.length === 0 ? <EmptyState title="No lessons for this client yet." /> : null}
      {(lessons ?? []).map((l) => <LessonCard key={`${l.id}:${l.current_version}:${l.reviews.length}:${l.history.length}`} lesson={l} staff={staff} onChanged={() => void load()} />)}
    </div>
  );
}

function SelfServiceTab() {
  const clientSlug = useSelectedClientSlug();
  const [engagements, setEngagements] = useState<EngagementOption[]>([]);
  const [engagementId, setEngagementId] = useState("");
  const [weeks, setWeeks] = useState<SupportWeek[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [week, setWeek] = useState({ date: "", status: "observed", count: "0", origin: "pilot_observation" });
  const [win, setWin] = useState({ bs: "", be: "", ps: "", pe: "" });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setEngagementId("");
    if (!clientSlug) return setEngagements([]);
    void db.from("engagements").select("id, cycle_number, status").eq("client_slug", clientSlug).order("cycle_number")
      .then(({ data }) => setEngagements(((data ?? []) as EngagementOption[]).slice().reverse()));
  }, [clientSlug]);
  const load = useCallback(async () => {
    if (!engagementId) return;
    const [w, s] = await Promise.all([
      db.from("learning_support_weeks").select("*").eq("engagement_id", engagementId).order("week_start"),
      db.from("learning_self_service_snapshots").select("*").eq("engagement_id", engagementId).order("created_at"),
    ]);
    setWeeks((w.data ?? []) as SupportWeek[]);
    setSnapshots(((s.data ?? []) as Snapshot[]).slice().reverse());
  }, [engagementId]);
  useEffect(() => void load(), [load]);
  const call = async (name: string, args: Record<string, unknown>, fallback: string) => {
    setError(null);
    const { error: e } = await db.rpc(name, args);
    if (e) return setError(errorText(e.code, fallback));
    void load();
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {!clientSlug ? <div className="sm:col-span-2"><PickClientPrompt what="its self-service tally" /></div> : null}
        <SelectField label="Engagement" hideLabel value={engagementId} onChange={(e) => setEngagementId(e.target.value)} disabled={!clientSlug} placeholder="Select an engagement" options={engagements.map((e) => ({ value: e.id, label: `Cycle ${e.cycle_number} (${e.status})` }))} />
      </div>
      {engagementId ? (
        <>
          <div className="space-y-2 rounded-lg border border-input p-4 text-sm">
            <p className="font-medium">Weekly tally of recurring how-to questions that reached people</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <TextField label="Week" hideLabel type="date" value={week.date} onChange={(e) => setWeek({ ...week, date: e.target.value })} />
              <SelectField label="Observation" hideLabel value={week.status} onChange={(e) => setWeek({ ...week, status: e.target.value })} options={[{ value: "observed", label: "Observed" }, { value: "missing", label: "Missing" }, { value: "unknown", label: "Unknown" }]} />
              <TextField label="Questions" hideLabel type="number" min={0} value={week.count} disabled={week.status !== "observed"} onChange={(e) => setWeek({ ...week, count: e.target.value })} />
              <SelectField label="Data origin" hideLabel value={week.origin} onChange={(e) => setWeek({ ...week, origin: e.target.value })} options={[{ value: "pilot_observation", label: "Pilot observation" }, { value: "synthetic_fixture", label: "Made-up test data" }]} />
            </div>
            <Button size="sm" disabled={!week.date} onClick={() => void call("record_learning_support_week", {
              p_engagement_id: engagementId, p_week_start: mondayOf(week.date), p_observation_status: week.status,
              p_recurring_how_to_questions: week.status === "observed" ? Number(week.count) : 0, p_data_origin: week.origin,
            }, "The week could not be recorded.")}>Record week of {week.date ? mondayOf(week.date) : "..."}</Button>
            <ul className="text-[12px]">{weeks.map((w) => <li key={w.week_start}>{fmtDate(w.week_start)}: {w.observation_status === "observed" ? `${w.recurring_how_to_questions} questions` : w.observation_status}{w.data_origin === "synthetic_fixture" ? " (made up)" : ""}</li>)}</ul>
          </div>
          <div className="space-y-2 rounded-lg border border-input p-4 text-sm">
            <p className="font-medium">Snapshot: baseline against pilot</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <TextField label="Baseline start" hideLabel type="date" value={win.bs} onChange={(e) => setWin({ ...win, bs: e.target.value })} />
              <TextField label="Baseline end" hideLabel type="date" value={win.be} onChange={(e) => setWin({ ...win, be: e.target.value })} />
              <TextField label="Pilot start" hideLabel type="date" value={win.ps} onChange={(e) => setWin({ ...win, ps: e.target.value })} />
              <TextField label="Pilot end" hideLabel type="date" value={win.pe} onChange={(e) => setWin({ ...win, pe: e.target.value })} />
            </div>
            <Button size="sm" disabled={!win.bs || !win.be || !win.ps || !win.pe} onClick={() => void call("snapshot_learning_self_service", {
              p_engagement_id: engagementId, p_baseline_start: win.bs, p_baseline_end: win.be, p_pilot_start: win.ps, p_pilot_end: win.pe,
            }, "The snapshot could not be taken.")}>Take snapshot</Button>
            {snapshots.map((s) => (
              <div key={s.id} className="rounded bg-muted/40 p-2 text-[12px]" data-testid={`snapshot-${s.id}`}>
                <p>Baseline {fmtDate(s.baseline_start)} to {fmtDate(s.baseline_end)}: {s.baseline_questions} questions over {s.baseline_weeks_observed} observed weeks ({s.baseline_weeks_missing} missing), rate {s.baseline_rate ?? "n/a"} per week.</p>
                <p>Pilot {fmtDate(s.pilot_start)} to {fmtDate(s.pilot_end)}: {s.pilot_questions} questions over {s.pilot_weeks_observed} observed weeks ({s.pilot_weeks_missing} missing), rate {s.pilot_rate ?? "n/a"} per week.</p>
                <p>Repeat support: {s.comparison} · pilot {s.pilot_status} · data {s.data_origin.replace("_", " ")}. {s.usage_note}</p>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

export default function LearningPage() {
  const [tab, setTab] = useState<"lessons" | "self-service">("lessons");
  const [staff, setStaff] = useState<StaffOption[]>([]);
  useEffect(() => {
    void db.rpc("handoff_staff_options", {}).then(({ data }) => setStaff((data ?? []) as StaffOption[]));
  }, []);
  return (
    <PageShell data-testid="learning">
      <PageHeader title="Learning" description="Client lessons with a named reviewer and builder publication, and the weekly tally of recurring how-to questions. Clients see nothing here yet." />
      <div className="flex gap-2">
        <Button size="sm" variant={tab === "lessons" ? "default" : "outline"} onClick={() => setTab("lessons")}>Lessons</Button>
        <Button size="sm" variant={tab === "self-service" ? "default" : "outline"} onClick={() => setTab("self-service")}>Self-service</Button>
      </div>
      {tab === "lessons" ? <LessonsTab staff={staff} /> : <SelfServiceTab />}
    </PageShell>
  );
}
