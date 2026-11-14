// Client home and the Briefs, Review and Assets pages (OS-019). Pure rules over the cards that
// os_client_task_cards() returns. Nothing here reads or writes data.
//
// A card holds only what a client may see: the task id, the allow-listed fields (title, stage,
// due date, brief, asset link) and the client's current decision. The pages pick cards with these
// rules and render only the fields named in CLIENT_CARD_FIELDS.
import { format, parseISO } from "date-fns";
import { isLateDue } from "@/lib/myWork";
import { shortDate } from "@/lib/homeData";

export type ClientDecisionKind = "approved" | "changes_requested";

export interface ClientCardDecision {
  decision: ClientDecisionKind;
  note: string | null;
  decided_by_label: string;
  decided_at: string;
}

export interface ClientCard {
  id: string;
  title: string;
  stage: string | null;
  due_date: string | null;
  brief: string | null;
  asset_url: string | null;
  decision: ClientCardDecision | null;
}

/** The fields the pages render. Matches the database allow-list (os_client_visible_fields). */
export const CLIENT_CARD_FIELDS = ["title", "stage", "due_date", "brief", "asset_url"] as const;

export const BRIEF_STAGE = "Preparing Content";
export const REVIEW_STAGE = "Client Review";
export const DELIVERED_STAGE = "Ready to Launch";
export const MAX_NOTE = 1000;

/**
 * Keep only known keys, so a field the server sends by mistake is never kept in memory or drawn.
 * Anything that is not a plain object with an id is dropped.
 */
export function toClientCards(rows: unknown): ClientCard[] {
  if (!Array.isArray(rows)) return [];
  const out: ClientCard[] = [];
  for (const raw of rows) {
    const r = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
    if (!r || typeof r.id !== "string") continue;
    const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : null);
    const d = r.decision && typeof r.decision === "object" ? (r.decision as Record<string, unknown>) : null;
    out.push({
      id: r.id,
      title: str(r.title) ?? "Untitled",
      stage: str(r.stage),
      due_date: str(r.due_date),
      brief: str(r.brief),
      asset_url: str(r.asset_url) && /^https?:\/\//i.test(String(r.asset_url)) ? String(r.asset_url) : null,
      decision:
        d && (d.decision === "approved" || d.decision === "changes_requested")
          ? {
              decision: d.decision,
              note: str(d.note),
              decided_by_label: str(d.decided_by_label) ?? "You",
              decided_at: String(d.decided_at ?? ""),
            }
          : null,
    });
  }
  return out;
}

/** Oldest due first, no date last, then by title so the order is steady. */
export function byDueDate<T extends Pick<ClientCard, "due_date" | "title">>(cards: T[]): T[] {
  return cards.slice().sort((a, b) => {
    const ad = a.due_date?.slice(0, 10) ?? null;
    const bd = b.due_date?.slice(0, 10) ?? null;
    if (ad && bd && ad !== bd) return ad.localeCompare(bd);
    if (ad && !bd) return -1;
    if (!ad && bd) return 1;
    return a.title.localeCompare(b.title);
  });
}

/** Tasks waiting for the client's review, oldest due first. */
export const reviewCards = (cards: ClientCard[]): ClientCard[] => byDueDate(cards.filter((c) => c.stage === REVIEW_STAGE));

/** Briefs: tasks still in the brief stage that have brief text, oldest due first. */
export const briefCards = (cards: ClientCard[]): ClientCard[] =>
  byDueDate(cards.filter((c) => c.stage === BRIEF_STAGE && c.brief !== null));

/** Approved or delivered work with an asset link. */
export const assetCards = (cards: ClientCard[]): ClientCard[] =>
  cards.filter((c) => c.stage === DELIVERED_STAGE && c.asset_url !== null);

export type NextItem =
  | { kind: "review"; card: ClientCard }
  | { kind: "brief"; card: ClientCard }
  | { kind: "none" };

/**
 * The one thing that needs the client: a task in Client Review (oldest due first), else the next
 * brief to read, else nothing.
 */
export function nextItem(cards: ClientCard[]): NextItem {
  const review = reviewCards(cards)[0];
  if (review) return { kind: "review", card: review };
  const brief = briefCards(cards)[0];
  if (brief) return { kind: "brief", card: brief };
  return { kind: "none" };
}

/** The short list under the lead: the rest of the review and brief items, at most `max`. */
export function upNext(cards: ClientCard[], lead: NextItem, max = 4): ClientCard[] {
  const leadId = lead.kind === "none" ? null : lead.card.id;
  return [...reviewCards(cards), ...briefCards(cards)].filter((c) => c.id !== leadId).slice(0, max);
}

export interface AssetMonth {
  key: string;
  label: string;
  cards: ClientCard[];
}

/**
 * Delivered assets grouped by the month of their due date, newest month first. Within a month the
 * newest due date comes first. Cards with no due date go in a last group, "No date".
 */
export function groupAssetsByMonth(cards: ClientCard[]): AssetMonth[] {
  const groups = new Map<string, ClientCard[]>();
  for (const c of assetCards(cards)) {
    const key = c.due_date ? c.due_date.slice(0, 7) : "none";
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }
  const keys = [...groups.keys()].filter((k) => k !== "none").sort((a, b) => b.localeCompare(a));
  if (groups.has("none")) keys.push("none");
  return keys.map((key) => ({
    key,
    label: key === "none" ? "No date" : format(parseISO(`${key}-01`), "MMMM yyyy"),
    cards: key === "none" ? groups.get(key)!.slice().sort((a, b) => a.title.localeCompare(b.title)) : byDueDate(groups.get(key)!).reverse(),
  }));
}

/** Why a note cannot be sent, or null when it can. A change request needs one. */
export function noteProblem(decision: ClientDecisionKind, note: string): string | null {
  if (decision === "approved") return null;
  const text = note.trim();
  if (!text) return "Please tell us what to change.";
  if (text.length > MAX_NOTE) return `Please keep it under ${MAX_NOTE} characters.`;
  return null;
}

/** "Due Nov 12", with whether it is late. */
export function dueText(due: string | null, today: string): { text: string; late: boolean } {
  if (!due) return { text: "No due date", late: false };
  return { text: `Due ${shortDate(due)}`, late: isLateDue(due, today) };
}

/** "You approved this on Nov 10." */
export function decisionText(d: ClientCardDecision): string {
  const when = d.decided_at ? ` on ${shortDate(d.decided_at)}` : "";
  return d.decision === "approved" ? `${d.decided_by_label} approved this${when}.` : `${d.decided_by_label} asked for changes${when}.`;
}
