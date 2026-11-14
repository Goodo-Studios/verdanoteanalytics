// Pure rules for the client Content Pipeline board (due-date line and the
// "Updated ..." time). Kept out of the component file so they can be tested alone.
import { differenceInDays, format, parseISO } from "date-fns";
import { CLIENT_REVIEW_STAGE } from "@/lib/pipelineSummary";

/**
 * The due-date line on a card. Only the Client Review column, where the client
 * is the one holding the card, gets a gently worded late note. Columns Goodo
 * owns (Preparing Content, Production, Editing) and Ready to Launch never show
 * an overdue warning; they show the plain date.
 */
export function dueDateLabel(
  dueDateStr: string | null,
  stage: string,
  now: Date = new Date(),
): { text: string; urgent: boolean } | null {
  if (!dueDateStr) return null;
  const due = parseISO(dueDateStr);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = differenceInDays(due, today);
  const clientHolds = stage === CLIENT_REVIEW_STAGE;

  if (diff < 0) {
    if (clientHolds) return { text: `Was due ${format(due, "MMM d")}. Take a look when you can.`, urgent: true };
    return { text: `Due ${format(due, "MMM d")}`, urgent: false };
  }
  if (diff === 0) return { text: "Due today", urgent: clientHolds };
  if (diff === 1) return { text: "Due tomorrow", urgent: false };
  if (diff <= 5) return { text: `Due in ${diff} days`, urgent: false };
  return { text: `Due ${format(due, "MMM d")}`, urgent: false };
}

/** The most recent sync time across the rows (`updated_at` is set by the sync). */
export function lastSyncedAt(tasks: { updated_at: string | null }[] | null | undefined): string | null {
  let latest: string | null = null;
  let latestMs = -Infinity;
  for (const t of tasks ?? []) {
    if (!t.updated_at) continue;
    const ms = Date.parse(t.updated_at);
    if (Number.isFinite(ms) && ms > latestMs) {
      latestMs = ms;
      latest = t.updated_at;
    }
  }
  return latest;
}
