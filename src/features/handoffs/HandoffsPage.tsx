// Handoffs: staff page (consolidation step 4b, port of the Goodo OS page
// HandoffPacket.tsx). A strategist writes a packet for the next role (editor, QA
// reviewer, delivery owner or another strategist): brief, angle, goal, required
// inputs and a snapshot of the engagement's deliverables. The receiver acknowledges
// it or returns it with a reason; the owner reassigns it as a new revision. "Waiting
// for me" lists packets addressed to the signed-in person. Every write goes through
// a checked database function (migration 20261110120004); clients see none of it.
// Acknowledging does not complete any ClickUp task, and nothing is sent outward.
// A new packet starts from the engagement's published strategy proposal when there is
// one (step 4c, migration 20261110200001); staff edit it before saving and the packet
// keeps the reference.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSelectedClientSlug } from "@/contexts/ClientSelectionContext";
import { PickClientPrompt } from "@/components/PickClientPrompt";
import { useAuth } from "@/contexts/AuthContext";
import { EmptyState, ErrorState, PageHeader, PageShell, SelectField, TextField, TextareaField } from "@/components/page-kit";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/formatters";
import {
  canAcknowledge,
  canReassign,
  currentVersion,
  errorText,
  type Packet,
  parseInputs,
  prefillFromStrategy,
  type PublishedStrategy,
  type ReceivingRole,
  ROLE_LABEL,
  SOURCE_LABEL,
  type SourceStatus,
  type StaffOption,
  staffName,
  STATUS_LABEL,
  toPackets,
} from "./model";

// The handoff tables and functions are not in the generated types yet.
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
const SELECT = "*, handoff_packet_versions(*), handoff_acknowledgements(*)";
const ROLES = Object.keys(ROLE_LABEL) as ReceivingRole[];

interface ClientOption {
  slug: string;
  name: string;
}
interface EngagementOption {
  id: string;
  cycle_number: number;
  status: string;
}

function StaffSelect({ label, staff, value, onChange }: { label: string; staff: StaffOption[]; value: string; onChange: (v: string) => void }) {
  return (
    <SelectField
      label={label}
      hideLabel
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={label}
      options={staff.map((s) => ({ value: s.user_id, label: s.display_name || s.email }))}
    />
  );
}

function PacketCard({ packet, staff, onChanged }: { packet: Packet; staff: StaffOption[]; onChanged: () => void }) {
  const { user, isBuilder } = useAuth();
  const v = currentVersion(packet);
  const [source, setSource] = useState<SourceStatus | null>(null);
  const [reason, setReason] = useState("");
  const [move, setMove] = useState({ receiver: "", role: packet.receiving_role as string, due: packet.due_date, reason: "" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void db.rpc("handoff_source_status", { p_packet_id: packet.id }).then(({ data }) => setSource((data as SourceStatus) ?? null));
  }, [packet]);

  const call = async (name: string, args: Record<string, unknown>, fallback: string) => {
    setError(null);
    const { error: e } = await db.rpc(name, args);
    if (e) return setError(errorText(e.code, fallback));
    onChanged();
  };
  const answer = (action: "acknowledged" | "returned") => {
    if (action === "returned" && !reason.trim()) return setError("Say what is missing before returning the packet.");
    void call("acknowledge_handoff", { p_packet_id: packet.id, p_expected_revision: packet.current_revision, p_action: action, p_reason: reason.trim() || null }, "The answer could not be saved.");
  };

  return (
    <section aria-label={`Handoff to ${ROLE_LABEL[packet.receiving_role]}`} className="space-y-2 rounded-lg border border-input bg-background p-4 text-sm">
      <h3 className="text-base font-semibold">To {staffName(staff, packet.receiver_id)} as {ROLE_LABEL[packet.receiving_role]} · due {fmtDate(packet.due_date)}</h3>
      <p className="text-[12px] text-muted-foreground" data-testid={`packet-${packet.id}`}>
        {STATUS_LABEL[packet.status]} · revision {packet.current_revision} · owner {staffName(staff, packet.accountable_owner_id)}{source ? ` · ${SOURCE_LABEL[source]}` : ""}
      </p>
      {v ? (
        <div className="space-y-1">
          <p><span className="font-medium">Goal:</span> {v.goal}</p>
          <p><span className="font-medium">Angle:</span> {v.angle}</p>
          <p className="whitespace-pre-wrap rounded bg-muted/40 p-2">{v.brief}</p>
          <p className="font-medium">Required inputs</p>
          <ul className="list-disc pl-5">{v.required_inputs.map((i) => <li key={i}>{i}</li>)}</ul>
          {v.assets.length ? (
            <>
              <p className="font-medium">Deliverables when written</p>
              <ul className="list-disc pl-5">
                {v.assets.map((a) => (
                  <li key={a.deliverableId}>
                    {a.title}, revision {a.revision} ({a.stage.replace(/_/g, " ")}){a.reviewUrl ? <> · <a className="underline" href={a.reviewUrl} target="_blank" rel="noopener noreferrer">open</a></> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : <p className="text-muted-foreground">No deliverable revisions when written.</p>}
          {v.strategy_proposal_id ? <p className="text-muted-foreground">Brief started from the published strategy proposal, version {v.strategy_proposal_version}.</p> : null}
          {v.reason ? <p className="text-muted-foreground">Reassigned: {v.reason}</p> : null}
        </div>
      ) : null}
      {packet.acknowledgements.map((a) => (
        <p key={a.revision} className="text-muted-foreground">Revision {a.revision} {a.action}{a.reason ? `: ${a.reason}` : ""}</p>
      ))}
      {canAcknowledge(packet, user?.id) ? (
        <div className="space-y-2">
          <TextField label="Return reason" hideLabel placeholder="What is missing (needed to return)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => answer("acknowledged")}>Acknowledge</Button>
            <Button size="sm" variant="outline" onClick={() => answer("returned")}>Return with reason</Button>
          </div>
        </div>
      ) : null}
      {canReassign(packet, user?.id, isBuilder) ? (
        <details>
          <summary className="cursor-pointer font-medium">Reassign</summary>
          <div className="mt-2 grid items-end gap-2 grid-cols-1 sm:grid-cols-3">
            <StaffSelect label="New receiver" staff={staff} value={move.receiver} onChange={(receiver) => setMove({ ...move, receiver })} />
            <SelectField
              label="New role"
              hideLabel
              value={move.role}
              onChange={(e) => setMove({ ...move, role: e.target.value })}
              options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
            />
            <TextField label="New due date" hideLabel type="date" value={move.due} onChange={(e) => setMove({ ...move, due: e.target.value })} />
            <TextField label="Reassign reason" hideLabel className="sm:col-span-2" placeholder="Why" value={move.reason} onChange={(e) => setMove({ ...move, reason: e.target.value })} />
            <Button size="sm" disabled={!move.receiver || !move.due || !move.reason.trim()} onClick={() => void call("reassign_handoff", {
              p_packet_id: packet.id, p_expected_revision: packet.current_revision, p_receiver_id: move.receiver, p_receiving_role: move.role, p_due_date: move.due, p_reason: move.reason.trim(),
            }, "The handoff could not be reassigned.")}>Reassign as revision {packet.current_revision + 1}</Button>
          </div>
        </details>
      ) : null}
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    </section>
  );
}

function CreateForm({ engagementId, staff, onCreated }: { engagementId: string; staff: StaffOption[]; onCreated: () => void }) {
  const { user } = useAuth();
  const [form, setForm] = useState({ role: "editor", receiver: "", owner: user?.id ?? "", due: "", brief: "", angle: "", goal: "", inputs: "" });
  const [strategy, setStrategy] = useState<PublishedStrategy | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setStrategy(null);
    void db.rpc("published_strategy_for_engagement", { p_engagement_id: engagementId }).then(({ data, error: e }) => {
      const row = !e && Array.isArray(data) ? (data[0] as PublishedStrategy | undefined) : undefined;
      if (!live || !row) return;
      setStrategy(row);
      setForm((f) => ({ ...f, ...prefillFromStrategy(row) }));
    });
    return () => {
      live = false;
    };
  }, [engagementId]);
  const startBlank = () => {
    setStrategy(null);
    setForm((f) => ({ ...f, brief: "", angle: "", goal: "", inputs: "" }));
  };
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const inputs = parseInputs(form.inputs);
  const ready = form.receiver && form.owner && form.due && form.brief.trim() && form.angle.trim() && form.goal.trim() && inputs.length;
  const create = async () => {
    setError(null);
    const { error: e } = await db.rpc("create_handoff_packet", {
      p_engagement_id: engagementId, p_receiving_role: form.role, p_receiver_id: form.receiver, p_accountable_owner_id: form.owner,
      p_due_date: form.due, p_brief: form.brief.trim(), p_angle: form.angle.trim(), p_goal: form.goal.trim(), p_required_inputs: inputs,
      p_strategy_proposal_id: strategy?.proposal_id ?? null, p_strategy_proposal_version: strategy?.version ?? null,
    });
    if (e) return setError(errorText(e.code, "The handoff could not be created."));
    setForm({ ...form, brief: "", angle: "", goal: "", inputs: "" });
    setStrategy(null);
    onCreated();
  };
  return (
    <details className="rounded-lg border border-input bg-background p-4 text-sm">
      <summary className="cursor-pointer font-medium">Create a handoff packet</summary>
      <div className="mt-3 space-y-2">
        {strategy ? (
          <p className="rounded bg-muted/40 p-2" data-testid="strategy-prefill">
            Prefilled from the published strategy proposal "{strategy.title}", version {strategy.version}. Edit anything before creating.{" "}
            <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={startBlank}>Start blank</Button>
          </p>
        ) : null}
        <div className="grid items-end gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField
            label="Receiving role"
            hideLabel
            value={form.role}
            onChange={set("role")}
            options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
          />
          <StaffSelect label="Receiver" staff={staff} value={form.receiver} onChange={(receiver) => setForm({ ...form, receiver })} />
          <StaffSelect label="Accountable owner" staff={staff} value={form.owner} onChange={(owner) => setForm({ ...form, owner })} />
          <TextField label="Due date" hideLabel type="date" value={form.due} onChange={set("due")} />
        </div>
        <TextField label="Goal" hideLabel placeholder="Goal" value={form.goal} onChange={set("goal")} />
        <TextField label="Angle" hideLabel placeholder="Angle" value={form.angle} onChange={set("angle")} />
        <TextareaField label="Brief" hideLabel inputClassName="min-h-[100px]" placeholder="Brief for the receiving role" value={form.brief} onChange={set("brief")} />
        <TextareaField label="Required inputs" hideLabel placeholder="Required inputs, one per line" value={form.inputs} onChange={set("inputs")} />
        <Button size="sm" disabled={!ready} onClick={() => void create()}>Create handoff</Button>
        {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      </div>
    </details>
  );
}

export default function HandoffsPage() {
  const { user } = useAuth();
  const [staff, setStaff] = useState<StaffOption[]>([]);
  // The client comes from the one switcher at the top of the app (or the client hub address).
  const clientSlug = useSelectedClientSlug();
  const [engagements, setEngagements] = useState<EngagementOption[]>([]);
  const [engagementId, setEngagementId] = useState("");
  const [mine, setMine] = useState(false);
  const [packets, setPackets] = useState<Packet[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void db.rpc("handoff_staff_options", {}).then(({ data }) => setStaff((data ?? []) as StaffOption[]));
  }, []);
  useEffect(() => {
    setEngagementId("");
    if (!clientSlug) return setEngagements([]);
    void db.from("engagements").select("id, cycle_number, status").eq("client_slug", clientSlug).order("cycle_number")
      .then(({ data }) => setEngagements(((data ?? []) as EngagementOption[]).slice().reverse()));
  }, [clientSlug]);

  const load = useCallback(async () => {
    if (!mine && !engagementId) return setPackets(null);
    const query = mine && user ? db.from("handoff_packets").select(SELECT).eq("receiver_id", user.id).eq("status", "ready") : db.from("handoff_packets").select(SELECT).eq("engagement_id", engagementId);
    const { data, error: e } = await query.order("due_date");
    if (e) {
      setError("Handoffs could not load.");
      setPackets([]);
    } else setPackets(toPackets(data));
  }, [mine, engagementId, user]);
  useEffect(() => void load(), [load]);

  return (
    <PageShell data-testid="handoffs">
      <PageHeader title="Handoffs" description="Packets that hand work to the next role. The receiver acknowledges or returns each exact revision." />
      <div className="flex gap-2">
        <Button size="sm" variant={mine ? "default" : "outline"} onClick={() => setMine(true)}>Waiting for me</Button>
        <Button size="sm" variant={mine ? "outline" : "default"} onClick={() => setMine(false)}>By engagement</Button>
      </div>
      {!mine ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {!clientSlug ? <div className="sm:col-span-2"><PickClientPrompt what="its handoffs" /></div> : null}
          <SelectField
            label="Engagement"
            hideLabel
            value={engagementId}
            onChange={(e) => setEngagementId(e.target.value)}
            disabled={!clientSlug}
            placeholder="Select an engagement"
            options={engagements.map((e) => ({ value: e.id, label: `Cycle ${e.cycle_number} (${e.status})` }))}
          />
        </div>
      ) : null}
      {!mine && engagementId ? <CreateForm engagementId={engagementId} staff={staff} onCreated={() => void load()} /> : null}
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {packets && packets.length === 0 && !error ? <EmptyState title={mine ? "Nothing is waiting for you." : "No handoffs for this engagement yet."} /> : null}
      {(packets ?? []).map((p) => <PacketCard key={`${p.id}:${p.current_revision}:${p.status}`} packet={p} staff={staff} onChanged={() => void load()} />)}
    </PageShell>
  );
}
