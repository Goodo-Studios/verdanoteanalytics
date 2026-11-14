// Types for scripts/publish-brain-lib.mjs, so the Vitest suite can import it.

export const STAGING_REF: string;
export const DEFAULT_ROOT: string;
export const SECTIONS: string[];
export const SECTION_BY_FOLDER: Readonly<Record<string, string>>;
export const UNASSIGNED: string;
export const REVIEW_KEYS: string[];

export interface KnowledgeFile {
  relPath: string;
  text: string;
  mtime?: number | null;
}
export interface BrainPage {
  section: string;
  slug: string;
  title: string;
  body_md: string;
  owner: string;
  last_reviewed: string | null;
  last_reviewed_source: string | null;
  source_path: string;
  content_hash: string;
}
export interface Skip {
  path: string;
  reason: string;
}
export interface Published {
  section: string;
  slug: string;
}

export function parseArgs(argv: string[]): { dryRun: boolean; allowProduction: boolean; overwriteEdited: boolean; help: boolean; root: string };
export function assertTarget(url: string | undefined, opts?: { allowProduction?: boolean }): string;
export function toPosix(relPath: string): string;
export function hasSlackSegment(relPath: string): boolean;
export function sectionFor(relPath: string): { section: string; skip?: undefined } | { skip: string; section?: undefined };
export function parseFrontmatter(text: string): { data: Record<string, unknown>; body: string };
export function unpublishedReason(data: Record<string, unknown>): string | null;
export function slugify(value: string): string;
export function slugForPath(relPath: string): string;
export function lastReviewedFor(data: Record<string, unknown>, mtime?: number | null): { date: string | null; source: string | null };
export function brainHref(section: string, slug: string): string;
export function stripHqBits(body: string, opts: { relPath: string; published: Map<string, Published> }): string;
export function contentHash(page: Omit<BrainPage, "content_hash">): string;
export function buildPages(files: KnowledgeFile[]): { pages: BrainPage[]; skipped: Skip[]; notes: { path: string; note: string }[] };
export function diffPages(
  existing: { source_path: string; content_hash: string; edited_in_app?: boolean }[],
  pages: BrainPage[],
  opts?: { overwriteEdited?: boolean },
): { add: BrainPage[]; update: BrainPage[]; unchanged: number; remove: string[]; kept: string[] };
export function readKnowledge(root: string): Promise<{ files: KnowledgeFile[]; skipped: Skip[] }>;
export function summariseSkips(skipped: { reason: string }[]): [string, number][];
export function unmatchedOwnerLines(rows: { owner: string; pages: number }[] | null): string[];
export interface BrainFixRow {
  brain_page_id: string;
  source_path: string;
  page_content_hash: string;
  created_at: string;
  brain_page_correction_reviews: { decision: string }[] | { decision: string } | null;
}
export function pendingFixes<T extends BrainFixRow>(fixes: T[] | null, pages: { id: string; content_hash: string }[] | null): T[];
