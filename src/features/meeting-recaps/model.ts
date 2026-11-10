// Meeting recaps page model (consolidation step 4a, port of the Goodo OS
// MeetingRecaps page). Rows come from meeting_recaps, meeting_recap_items and
// meeting_recap_reviews (staff-only row rules, migration 20261110000002).

export interface RecapCitation {
  excerpt_id: string;
  start: number;
  end: number;
  quote: string;
  speaker: string | null;
  started_at: string | null;
}

export interface RecapReview {
  id: string;
  decision: "confirmed" | "rejected";
  reviewer_id: string;
  note: string;
  created_at: string;
}

export interface RecapItem {
  id: string;
  position: number;
  kind: "decision" | "question" | "action";
  summary: string;
  citations: RecapCitation[];
  date_status: "stated" | "uncertain" | "missing" | "not_applicable";
  date_text: string | null;
  date_value: string | null;
  missing_information: string[];
  proposed_action: "add_internal_note" | "set_due_date" | null;
  item_hash: string;
  review: RecapReview | null;
}

export interface Recap {
  id: string;
  client_slug: string;
  engagement_id: string | null;
  transcript_id: string;
  meeting_started_at: string | null;
  status: "prepared" | "unavailable" | "quarantined" | "failed";
  model: string | null;
  limitation: string | null;
  clean_excerpts: number;
  withheld_excerpts: number;
  rejected_candidates: number;
  created_at: string;
  items: RecapItem[];
}

export const STATUS_LABEL: Record<Recap["status"], string> = {
  prepared: "Prepared",
  unavailable: "Transcript unavailable",
  quarantined: "Withheld",
  failed: "Failed",
};

export const KIND_LABEL: Record<RecapItem["kind"], string> = { decision: "Decision", question: "Open question", action: "Action" };

const MISSING_LABEL: Record<string, string> = { owner: "owner", due_date: "due date", approval_owner: "approval owner", task_reference: "task reference" };
export const missingLabel = (items: string[]) => items.map((m) => MISSING_LABEL[m] ?? m).join(", ");

export function dateLabel(item: Pick<RecapItem, "date_status" | "date_text" | "date_value">): string | null {
  if (item.date_status === "stated") return `Due ${item.date_value}`;
  if (item.date_status === "uncertain") return `Timing not exact: "${item.date_text ?? ""}"`;
  if (item.date_status === "missing") return "No due date said";
  return null;
}

export const ACTION_LABEL: Record<string, string> = { add_internal_note: "Proposed: internal note", set_due_date: "Proposed: set the due date" };

/** Questions stay open; decisions and actions get one review. */
export const reviewable = (item: Pick<RecapItem, "kind" | "review">) => item.kind !== "question" && item.review === null;

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v && typeof v === "object" ? [v as T] : []);

/** Shapes the nested select (meeting_recaps -> meeting_recap_items -> meeting_recap_reviews). */
export function toRecaps(rows: unknown): Recap[] {
  return asArray<Record<string, unknown>>(rows).map((r) => {
    const items = asArray<Record<string, unknown>>(r.meeting_recap_items)
      .map((i) => {
        const review = asArray<RecapReview>(i.meeting_recap_reviews)[0] ?? null;
        const { meeting_recap_reviews: _ignored, ...rest } = i;
        return {
          ...(rest as unknown as RecapItem),
          citations: asArray<RecapCitation>(i.citations),
          missing_information: asArray<string>(i.missing_information),
          review,
        };
      })
      .sort((a, b) => a.position - b.position);
    const { meeting_recap_items: _items, ...recap } = r;
    return { ...(recap as unknown as Recap), items };
  });
}
