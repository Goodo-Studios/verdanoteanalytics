// ClickUp write-back (OS-017): the shape clickup_writeback_overview() returns, and labels.

export interface WritebackCounts {
  queued: number;
  retrying: number;
  sent: number;
  failed: number;
  held: number;
  clash: number;
  skipped: number;
}

export interface WritebackFailure {
  id: number;
  clickupTaskId: string;
  kind: string;
  field: string;
  state: "queued" | "failed";
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  updatedAt: string;
}

export interface WritebackClash {
  id: number;
  clickupTaskId: string;
  kind: string;
  field: string;
  appValue: string | null;
  clickupValue: string | null;
  winner: "app" | "clickup";
  createdAt: string;
}

export interface WritebackOverview {
  enabled: boolean;
  allowedListIds: string[];
  blockedReason: string | null;
  lastRunAt: string | null;
  counts: WritebackCounts;
  failures: WritebackFailure[];
  clashes: WritebackClash[];
}

export const COUNT_LABELS: [keyof WritebackCounts, string][] = [
  ["queued", "Waiting"],
  ["retrying", "Retrying"],
  ["sent", "Sent"],
  ["failed", "Failed"],
  ["held", "Held"],
  ["clash", "Clashes, ClickUp kept"],
  ["skipped", "Skipped"],
];

export const FIELD_LABEL: Record<string, string> = {
  status: "Status",
  due_date: "Due date",
  strategist: "Strategist",
  producer: "Producer",
  editor: "Editor",
  comment: "Comment",
  decision: "Client decision",
};

export function isOverview(v: unknown): v is WritebackOverview {
  const o = v as WritebackOverview | null;
  return !!o && typeof o === "object" && typeof o.enabled === "boolean" && !!o.counts && Array.isArray(o.failures) && Array.isArray(o.clashes);
}
