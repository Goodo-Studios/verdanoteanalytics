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

/**
 * A page needs review when it was last reviewed more than this many days ago, or never. Matches
 * public.brain_page_needs_review in migration 20261129080001 (OS-016).
 */
export const NEEDS_REVIEW_DAYS = 90;

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
  content_hash: string;
  source_path: string;
  /** The staff login the owner text matched at publish time, or null. */
  owner_user_id: string | null;
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

/** Not reviewed for more than NEEDS_REVIEW_DAYS (91 days or more), or never reviewed. */
export function needsReview(date: string | null, now: Date = new Date()): boolean {
  const days = daysSince(date, now);
  return days === null || days > NEEDS_REVIEW_DAYS;
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

/** Address of a Brain page inside the staff area, for links from other pages. */
export function brainPagePath(prefix: string, section: BrainSection, slug: string, anchor?: string | null): string {
  const path = `${prefix}/knowledge/brain?section=${section.toLowerCase()}&page=${encodeURIComponent(slug)}`;
  return anchor ? `${path}#${encodeURIComponent(anchor)}` : path;
}

/**
 * Heading text to an anchor: lower case, runs of anything but letters and digits become "-".
 * Matches public.brain_anchor in migration 20261204080001 (OS-026).
 */
export function brainAnchor(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// ------------------------------------------------------------------ ask the Brain (OS-026)

/** The answer when no Brain page matches. Same text as NO_MATCH in supabase/functions/brain-ask. */
export const BRAIN_NO_MATCH = "Nothing in the Brain answers that yet.";

export interface BrainCitation {
  section: string;
  slug: string;
  title: string;
}

export interface BrainAnswer {
  answer: string | null;
  mode: "answer" | "passages" | "none";
  citations: BrainCitation[];
  passages: Array<{ section: string; slug: string; title: string; text: string }>;
}

/** Shapes the brain-ask reply; anything unexpected becomes the no-match answer. */
export function toBrainAnswer(data: unknown): BrainAnswer {
  const d = (data ?? {}) as Partial<BrainAnswer>;
  const citations = Array.isArray(d.citations)
    ? d.citations.filter((c): c is BrainCitation => !!c && typeof c.slug === "string" && typeof c.title === "string" && typeof c.section === "string")
    : [];
  const passages = Array.isArray(d.passages) ? d.passages.filter((p) => !!p && typeof p.text === "string") : [];
  if (d.mode === "none" || citations.length === 0) return { answer: BRAIN_NO_MATCH, mode: "none", citations: [], passages: [] };
  return { answer: typeof d.answer === "string" && d.answer.trim() ? d.answer : null, mode: d.mode === "answer" ? "answer" : "passages", citations, passages };
}

// ------------------------------------------------------------------ suggested fixes (OS-016)

export type FixClass = "content" | "procedure" | "permission" | "factual";

export interface FixReview {
  decision: "accepted" | "rejected";
  reason: string;
  reviewer_id: string;
  created_at: string;
}

export interface BrainFix {
  id: string;
  brain_page_id: string;
  source_path: string;
  page_title: string;
  page_content_hash: string;
  proposed_body: string;
  reason: string;
  classification: FixClass;
  submitted_by: string;
  created_at: string;
  review: FixReview | null;
}

export type FixStatus = "open" | "accepted" | "applied" | "rejected";

export const FIX_STATUS_LABEL: Record<FixStatus, string> = {
  open: "Waiting for the owner",
  accepted: "Accepted, to apply in HQ",
  applied: "Accepted, page published again since",
  rejected: "Rejected",
};

/**
 * Where a fix stands. Accepting never edits the page here (HQ is the source), so an accepted fix
 * counts as applied once the page has been published with different content.
 */
export function fixStatus(fix: BrainFix, currentHash: string): FixStatus {
  if (!fix.review) return "open";
  if (fix.review.decision === "rejected") return "rejected";
  return fix.page_content_hash === currentHash ? "accepted" : "applied";
}

/** The page owner or a builder reviews an open fix, never their own. Mirrors review_brain_page_correction. */
export function canReviewFix(fix: BrainFix, page: Pick<BrainPageRow, "owner_user_id">, me: string | undefined, isBuilder: boolean): boolean {
  if (!me || fix.review || fix.submitted_by === me) return false;
  return isBuilder || page.owner_user_id === me;
}

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v && typeof v === "object" ? [v as T] : []);

/** Shapes the nested select (fix plus its review) into fixes, newest first. */
export function toFixes(rows: unknown): BrainFix[] {
  return asArray<Record<string, unknown>>(rows)
    .map((r) => ({ ...(r as unknown as BrainFix), review: asArray<FixReview>(r.brain_page_correction_reviews)[0] ?? null }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Drops a leading "# Title" line when it repeats the page title already shown in the page header. */
export function withoutRepeatedTitle(body: string, title: string): string {
  const m = /^\s*#\s+(.+?)\s*#*\s*(?:\r?\n|$)/.exec(body);
  if (!m) return body;
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return norm(m[1]) === norm(title) ? body.slice(m[0].length) : body;
}
