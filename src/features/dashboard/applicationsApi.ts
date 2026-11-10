// Reads and decisions for the Applications page (step 5b). Reads run as the
// signed-in user under the staff-only row rules. Approving and rejecting go
// through the checked database functions from migration 20261101000002, which
// refuse anyone who is not builder or employee, lock the row, refuse an
// application that was already decided and stamp the reviewer. Approving
// copies the applicant into the roster (and their files into the roster
// buckets); neither function sends anything to the applicant.
import { DashboardError, db, unwrap, unwrapOne } from "./api";
import { loadAll, signedUrls } from "./rosterApi";
import { APPLICATION_COLUMNS, APPLICATION_SOURCES, rosterMatches, type Application, type ApplicationKind } from "./applicationsModel";

export interface RosterContact {
  id: string;
  name: string;
  email: string | null;
}

export async function loadApplications(kind: ApplicationKind): Promise<{ rows: Application[]; roster: RosterContact[] }> {
  const src = APPLICATION_SOURCES[kind];
  const [rows, roster] = await Promise.all([
    loadAll<Application>(src.table, APPLICATION_COLUMNS[kind], "submitted_at"),
    loadAll<RosterContact>(src.roster, "id, name, email", "name"),
  ]);
  return { rows, roster };
}

export interface ApplicationVideo {
  id: string;
  storage_path: string;
  thumbnail_path: string | null;
  title: string | null;
  sort_order: number;
}

export interface ApplicationDetail {
  application: Application | null;
  videos: ApplicationVideo[];
  roster: RosterContact[];
  links: Map<string, string>;
}

export async function loadApplicationDetail(kind: ApplicationKind, id: string): Promise<ApplicationDetail> {
  const src = APPLICATION_SOURCES[kind];
  const [application, videos] = await Promise.all([
    unwrapOne(db.from(src.table).select<Application[]>(APPLICATION_COLUMNS[kind]).eq("id", id).maybeSingle()),
    unwrap(db.from(src.videos).select<ApplicationVideo[]>("id, storage_path, thumbnail_path, title, sort_order").eq("application_id", id).order("sort_order")),
  ]);
  // ilike for a case-insensitive match; the wildcards an email can contain (_ and %) are escaped,
  // and rosterMatches keeps only exact matches.
  const email = application?.email?.trim() ?? "";
  const roster = email
    ? rosterMatches(email, await unwrap(db.from(src.roster).select<RosterContact[]>("id, name, email").ilike("email", email.replace(/[\\%_]/g, (c) => `\\${c}`))))
    : [];
  const [images, clips] = await Promise.all([
    signedUrls(src.headshots, [application?.headshot_path, ...videos.map((v) => v.thumbnail_path)]),
    signedUrls(src.videoBucket, videos.map((v) => v.storage_path)),
  ]);
  return { application, videos, roster, links: new Map([...images, ...clips]) };
}

/** Returns the new roster id (dashboard_creators.id or actors.id). */
export async function approveApplication(kind: ApplicationKind, id: string): Promise<string> {
  const newId = await unwrapOne(db.rpc<string>(APPLICATION_SOURCES[kind].approve, { application_id: id }));
  if (!newId) throw new DashboardError({ message: "The application was not approved." });
  return newId;
}

export async function rejectApplication(kind: ApplicationKind, id: string, reason: string): Promise<void> {
  await unwrap(db.rpc(APPLICATION_SOURCES[kind].reject, { application_id: id, reason }));
}
