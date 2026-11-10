// Handoffs model (consolidation step 4b, port of the Goodo OS staff page
// HandoffPacket.tsx). Rows come from handoff_packets with their versions and
// acknowledgements (staff-only row rules, migration 20261110120004). The rules here
// mirror the checked database functions so the page only offers actions the
// database will accept; the database stays the authority.

export type ReceivingRole = "strategist" | "editor" | "qa_reviewer" | "delivery_owner";
export type PacketStatus = "ready" | "acknowledged" | "returned";
export type SourceStatus = "current" | "stale" | "blocked";

export interface SnapshotAsset {
  deliverableId: string;
  title: string;
  revision: number;
  stage: string;
  reviewUrl: string | null;
  finalDownloadUrl: string | null;
}

export interface PacketVersion {
  revision: number;
  brief: string;
  angle: string;
  goal: string;
  required_inputs: string[];
  assets: SnapshotAsset[];
  receiving_role: ReceivingRole;
  receiver_id: string;
  due_date: string;
  action: "created" | "reassigned";
  reason: string | null;
  created_at: string;
}

export interface Acknowledgement {
  revision: number;
  action: "acknowledged" | "returned";
  reason: string | null;
  actor_id: string;
  created_at: string;
}

export interface Packet {
  id: string;
  engagement_id: string;
  client_slug: string;
  current_revision: number;
  status: PacketStatus;
  receiving_role: ReceivingRole;
  receiver_id: string;
  accountable_owner_id: string;
  due_date: string;
  created_by: string;
  versions: PacketVersion[];
  acknowledgements: Acknowledgement[];
}

export interface StaffOption {
  user_id: string;
  display_name: string | null;
  email: string;
  role: string;
}

export const ROLE_LABEL: Record<ReceivingRole, string> = {
  strategist: "Strategist",
  editor: "Editor",
  qa_reviewer: "QA reviewer",
  delivery_owner: "Delivery owner",
};

export const STATUS_LABEL: Record<PacketStatus, string> = {
  ready: "Waiting for the receiver",
  acknowledged: "Acknowledged",
  returned: "Returned",
};

export const SOURCE_LABEL: Record<SourceStatus, string> = {
  current: "Deliverables match the packet",
  stale: "Deliverables changed since this packet was written",
  blocked: "The deliverables no longer fit this role; return the packet with a reason",
};

export const currentVersion = (p: Packet) => p.versions.find((v) => v.revision === p.current_revision);
export const canAcknowledge = (p: Packet, me: string | undefined) => !!me && p.receiver_id === me && p.status === "ready";
export const canReassign = (p: Packet, me: string | undefined, isBuilder: boolean) =>
  !!me && (isBuilder || p.accountable_owner_id === me || p.created_by === me);

export const staffName = (staff: StaffOption[], id: string) => {
  const s = staff.find((x) => x.user_id === id);
  return s ? s.display_name || s.email : "someone";
};

/** Required inputs, one per line. */
export function parseInputs(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

export function errorText(code: string | undefined, fallback: string): string {
  switch (code) {
    case "40001":
      return "This handoff changed since you opened it. Reload and try again.";
    case "42501":
      return "You are not allowed to do that here.";
    case "22023":
      return "Not allowed: the deliverables do not fit that role (QA needs internal QA, delivery needs final), the person is not staff, or a reason is missing.";
    case "23514":
      return "Check the fields: a return needs a reason and text cannot be empty.";
    default:
      return fallback;
  }
}

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v && typeof v === "object" ? [v as T] : []);

export function toPackets(rows: unknown): Packet[] {
  return asArray<Record<string, unknown>>(rows).map((r) => ({
    ...(r as unknown as Packet),
    versions: asArray<PacketVersion>(r.handoff_packet_versions).sort((a, b) => b.revision - a.revision),
    acknowledgements: asArray<Acknowledgement>(r.handoff_acknowledgements).sort((a, b) => b.revision - a.revision),
  }));
}
