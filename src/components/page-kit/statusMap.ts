export type StatusKey = "done" | "in_progress" | "waiting" | "late" | "blocked" | "draft";

export const STATUS_LABEL: Record<StatusKey, string> = {
  done: "Done",
  in_progress: "In progress",
  waiting: "Waiting",
  late: "Late",
  blocked: "Blocked",
  draft: "Draft",
};

// One colour per status. Red is used for "late" and nowhere else.
export const STATUS_TONE: Record<StatusKey, string> = {
  done: "border-success/30 bg-success/10 text-success",
  in_progress: "border-info/30 bg-info/10 text-info",
  waiting: "border-warning/40 bg-warning/10 text-warning-foreground",
  late: "border-destructive/30 bg-destructive/10 text-destructive",
  blocked: "border-slate/40 bg-slate/10 text-charcoal",
  draft: "border-border bg-muted text-muted-foreground",
};

const ALIASES: Record<string, StatusKey> = {
  done: "done",
  complete: "done",
  completed: "done",
  delivered: "done",
  approved: "done",
  closed: "done",
  resolved: "done",
  published: "done",
  in_progress: "in_progress",
  active: "in_progress",
  open: "in_progress",
  working: "in_progress",
  in_review: "in_progress",
  waiting: "waiting",
  waiting_on_client: "waiting",
  waiting_on_us: "waiting",
  pending: "waiting",
  queued: "waiting",
  late: "late",
  overdue: "late",
  blocked: "blocked",
  stuck: "blocked",
  draft: "draft",
  not_started: "draft",
  planned: "draft",
};

function normalise(status: string): string {
  return status.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** The status a raw value maps to, or null when it is not one of the common ones. */
export function statusKeyOf(status: string | null | undefined): StatusKey | null {
  if (!status) return null;
  return ALIASES[normalise(status)] ?? null;
}

export function humanise(status: string): string {
  const words = status.trim().replace(/[_-]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
