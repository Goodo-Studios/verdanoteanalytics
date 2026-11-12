// Brain (OS-014): rules for the staff Brain page. Pages come from HQ knowledge through
// scripts/publish-brain.mjs and are read only in the app.

export const BRAIN_SECTIONS = ["Handbook", "Playbooks", "Clients", "Insights"] as const;
export type BrainSection = (typeof BRAIN_SECTIONS)[number];

export const SECTION_BLURB: Record<BrainSection, string> = {
  Handbook: "How Goodo works: company, roles, policies and brand.",
  Playbooks: "How we do the work, step by step.",
  Clients: "What we know about each client.",
  Insights: "What we have learned from the work.",
};

/** A page is marked stale when it has not been reviewed for this many days. */
export const STALE_DAYS = 180;

export interface BrainListRow {
  id: string;
  section: BrainSection;
  slug: string;
  title: string;
  owner: string;
  last_reviewed: string | null;
}

export interface BrainPageRow extends BrainListRow {
  body_md: string;
  published_at: string;
}

/** Section from the address (?section=playbooks), Handbook when missing or unknown. */
export function sectionFromParam(value: string | null): BrainSection {
  const hit = BRAIN_SECTIONS.find((s) => s.toLowerCase() === (value ?? "").toLowerCase());
  return hit ?? "Handbook";
}

/** Days between a YYYY-MM-DD review date and today (UTC days). Null when there is no date. */
export function daysSince(date: string | null, now: Date = new Date()): number | null {
  if (!date) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return null;
  const then = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - then) / 86_400_000);
}

/** Not reviewed for more than STALE_DAYS, or never reviewed. */
export function isStale(date: string | null, now: Date = new Date()): boolean {
  const days = daysSince(date, now);
  return days === null || days > STALE_DAYS;
}

/** A link between Brain pages, written by the publish script as #brain/<section>/<slug>. */
export function parseBrainHref(href: string | undefined): { section: BrainSection; slug: string } | null {
  const m = /^#brain\/([a-z]+)\/([a-z0-9-]+)$/.exec(href ?? "");
  if (!m) return null;
  const section = BRAIN_SECTIONS.find((s) => s.toLowerCase() === m[1]);
  return section ? { section, slug: m[2] } : null;
}

export function matchesSearch(row: BrainListRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return row.title.toLowerCase().includes(q) || row.owner.toLowerCase().includes(q);
}
