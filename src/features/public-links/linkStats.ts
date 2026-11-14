// What staff see about a public link: how often it was opened and when someone last answered.
// The counts live in public_link_registry (staff can read it). Pure helpers, no network.

export interface LinkStat {
  open_count: number;
  last_opened_at: string | null;
}

export const NO_ACTIVITY: LinkStat = { open_count: 0, last_opened_at: null };

/** "Opened 3 times, last on Nov 10, 2026. Last response Nov 11, 2026." */
export function describeActivity(stat: LinkStat | undefined, lastResponseAt: string | null, formatDay: (iso: string) => string): string {
  const s = stat ?? NO_ACTIVITY;
  const opened = s.open_count === 0 ? "Not opened yet." : `Opened ${s.open_count} time${s.open_count === 1 ? "" : "s"}${s.last_opened_at ? `, last on ${formatDay(s.last_opened_at)}` : ""}.`;
  return `${opened} ${lastResponseAt ? `Last response ${formatDay(lastResponseAt)}.` : "No responses yet."}`;
}

/** The newest voted_at, or null. */
export function lastResponse(votes: { voted_at: string }[]): string | null {
  return votes.reduce<string | null>((a, v) => (a === null || v.voted_at > a ? v.voted_at : a), null);
}

/** "Opened 3 times, last on Nov 10, 2026." for links that have no responses. */
export function describeOpens(stat: LinkStat | undefined, formatDay: (iso: string) => string): string {
  const s = stat ?? NO_ACTIVITY;
  if (s.open_count === 0) return "Not opened yet.";
  return `Opened ${s.open_count} time${s.open_count === 1 ? "" : "s"}${s.last_opened_at ? `, last on ${formatDay(s.last_opened_at)}` : ""}.`;
}
