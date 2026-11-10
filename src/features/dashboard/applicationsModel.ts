// Application review (consolidation step 5b, port of the old dashboard's
// Applications and Actor applications pages). Rows come from
// creator_applications and actor_applications (migration 20261101000001,
// staff-only row rules; clients read none). The public forms that fill them
// stay on the old dashboard. Pure helpers only.

export type ApplicationKind = "creators" | "actors";
export type QueueStatus = "pending" | "rejected";

export const OLD_DASHBOARD_URL = "https://goodostudios-production.vercel.app";
/** The public application forms, which stay on the old dashboard. */
export const APPLY_LINKS: Record<ApplicationKind, string> = {
  creators: `${OLD_DASHBOARD_URL}/creatorapply`,
  actors: `${OLD_DASHBOARD_URL}/actorapply`,
};

interface ApplicationBase {
  id: string;
  status: "pending" | "approved" | "rejected";
  name: string;
  email: string;
  gender: string | null;
  age_range: string[];
  headshot_path: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  review_notes: string | null;
  app_users: { name: string } | null;
}

export interface CreatorApplication extends ApplicationBase {
  socials: Record<string, string> | null;
  website: string | null;
  categories: string[];
  location: string | null;
  shipping_address: string | null;
  alcohol_ok: boolean;
  cbd_ok: boolean;
  thc_ok: boolean;
  family_inclusive_ok: boolean;
}

export interface ActorApplication extends ApplicationBase {
  phone: string | null;
  notes: string | null;
  dog_owner: boolean | null;
  kids_in_videos: string | null;
  social_url: string | null;
  additional_social_url: string | null;
}

export type Application = CreatorApplication | ActorApplication;

const BASE_COLUMNS = "id, status, name, email, gender, age_range, headshot_path, submitted_at, reviewed_at, review_notes, app_users(name)";
export const APPLICATION_COLUMNS: Record<ApplicationKind, string> = {
  creators: `${BASE_COLUMNS}, socials, website, categories, location, shipping_address, alcohol_ok, cbd_ok, thc_ok, family_inclusive_ok`,
  actors: `${BASE_COLUMNS}, phone, notes, dog_owner, kids_in_videos, social_url, additional_social_url`,
};

/** Tables, functions and buckets per kind. Video thumbnails live in the headshot bucket. */
export const APPLICATION_SOURCES: Record<ApplicationKind, {
  table: string; videos: string; approve: string; reject: string; headshots: string; videoBucket: string; roster: string;
}> = {
  creators: {
    table: "creator_applications", videos: "application_videos", approve: "approve_application", reject: "reject_application",
    headshots: "creator-application-headshots", videoBucket: "creator-application-videos", roster: "dashboard_creators",
  },
  actors: {
    table: "actor_applications", videos: "actor_application_videos", approve: "approve_actor_application", reject: "reject_actor_application",
    headshots: "actor-application-headshots", videoBucket: "actor-application-videos", roster: "actors",
  },
};

export function parseKind(v: string | null | undefined): ApplicationKind {
  return v === "actors" ? "actors" : "creators";
}

export function parseQueueStatus(v: string | null | undefined): QueueStatus {
  return v === "rejected" ? "rejected" : "pending";
}

/** Rows of one status, newest first, matching the search over name, email and location. */
export function queue<T extends Application>(rows: T[], status: QueueStatus, query: string): T[] {
  const q = query.trim().toLowerCase();
  return rows
    .filter((r) => r.status === status)
    .filter((r) => !q || [r.name, r.email, "location" in r ? r.location : null].some((v) => (v ?? "").toLowerCase().includes(q)))
    .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
}

export function countByStatus(rows: Application[]): Record<"pending" | "approved" | "rejected", number> {
  const out = { pending: 0, approved: 0, rejected: 0 };
  for (const r of rows) out[r.status] += 1;
  return out;
}

/** Roster rows whose email matches the applicant's, case and space insensitive. */
export function rosterMatches<T extends { id: string; name: string; email: string | null }>(email: string, roster: T[]): T[] {
  const e = email.trim().toLowerCase();
  if (!e) return [];
  return roster.filter((r) => (r.email ?? "").trim().toLowerCase() === e);
}

export function socialLines(socials: Record<string, string> | null): string[] {
  if (!socials || typeof socials !== "object") return [];
  return Object.entries(socials)
    .filter(([, v]) => typeof v === "string" && v.trim() !== "")
    .map(([k, v]) => `${k}: ${v.trim()}`);
}

export interface BulkOutcome {
  id: string;
  name: string;
  ok: boolean;
  error?: string;
}

export function summarizeBulkReject(outcomes: BulkOutcome[]): string {
  if (outcomes.length === 0) return "No applications were selected.";
  const failed = outcomes.filter((o) => !o.ok);
  const ok = outcomes.length - failed.length;
  if (failed.length === 0) return `Rejected ${ok} application${ok === 1 ? "" : "s"}.`;
  if (ok === 0) return `Could not reject ${failed.map((f) => f.name).join(", ")}.`;
  return `Rejected ${ok} of ${outcomes.length} applications. Failed: ${failed.map((f) => f.name).join(", ")}.`;
}

/** Database refusals in plain words. */
export function reviewErrorText(code: string | undefined, message: string): string {
  if (code === "42501") return "You do not have permission to do that.";
  if (code === "55000") return "This application was already decided. Reload to see the outcome.";
  if (code === "P0002") return "This application no longer exists.";
  if (code === "22023") return "A rejection reason is required.";
  return message || "The change could not be saved.";
}

export function formatSubmitted(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}
