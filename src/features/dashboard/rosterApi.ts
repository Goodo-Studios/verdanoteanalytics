// Reads and writes for the Creators and Actors pages (step 5b). Every call runs
// as the signed-in user, so the staff-only row rules on the dashboard tables
// (migration 20261101000003) and the staff-only storage policies on the media
// buckets (migration 20261101000004) decide what comes back. Media is shown
// through signed links that expire after an hour.
import { supabase } from "@/integrations/supabase/client";
import { DashboardError, db, unwrap, unwrapOne } from "./api";
import {
  CREATOR_RECORD_COLUMNS,
  ROSTER_CREATOR_COLUMNS,
  type CreatorPatch,
  type CreatorRecord,
  type RosterCreator,
} from "./rosterModel";

const PAGE = 1000;
const SIGNED_SECONDS = 3600;

/** PostgREST caps a response at 1000 rows; the roster is bigger, so read it in pages. */
export async function loadAll<T>(table: string, columns: string, orderBy: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = await unwrap(db.from(table).select<T[]>(columns).order(orderBy).order("id").range(from, from + PAGE - 1));
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

/** path -> signed link for the objects that exist and the caller may read. */
export async function signedUrls(bucket: string, paths: (string | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(paths.filter((p): p is string => !!p))];
  const out = new Map<string, string>();
  if (!wanted.length) return out;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(wanted, SIGNED_SECONDS);
  if (error) return out;
  for (const item of data ?? []) {
    if (item.path && item.signedUrl && !item.error) out.set(item.path, item.signedUrl);
  }
  return out;
}

export interface RosterAssignment {
  id: string;
  creator_id: string;
  client_slug: string;
  stage: string;
}

export async function loadCreatorRoster(): Promise<{ creators: RosterCreator[]; assignments: RosterAssignment[] }> {
  const [creators, assignments] = await Promise.all([
    loadAll<RosterCreator>("dashboard_creators", ROSTER_CREATOR_COLUMNS, "name"),
    loadAll<RosterAssignment>("creator_assignments", "id, creator_id, client_slug, stage", "client_slug"),
  ]);
  return { creators, assignments };
}

export interface CreatorBrandRow {
  id: string;
  client_slug: string;
  stage: string;
  next_follow_up_at: string | null;
  clients: { name: string } | null;
}
export interface CreatorVideo {
  id: string;
  storage_path: string;
  thumbnail_path: string | null;
  title: string | null;
  format: string | null;
  sort_order: number;
}
export interface CreatorPhoto {
  id: string;
  storage_path: string;
  category?: string;
  caption?: string | null;
  label?: string | null;
}
export interface CreatorDetail {
  creator: CreatorRecord | null;
  brands: CreatorBrandRow[];
  videos: CreatorVideo[];
  photos: CreatorPhoto[];
  locations: CreatorPhoto[];
  links: Map<string, string>;
}

/** One creator with their brands and media. links maps a storage path to its signed link. */
export async function loadCreatorDetail(id: string): Promise<CreatorDetail> {
  const [creator, brands, videos, photos, locations] = await Promise.all([
    unwrapOne(db.from("dashboard_creators").select<CreatorRecord[]>(CREATOR_RECORD_COLUMNS).eq("id", id).maybeSingle()),
    unwrap(db.from("creator_assignments").select<CreatorBrandRow[]>("id, client_slug, stage, next_follow_up_at, clients(name)").eq("creator_id", id).order("client_slug")),
    unwrap(db.from("creator_videos").select<CreatorVideo[]>("id, storage_path, thumbnail_path, title, format, sort_order").eq("creator_id", id).order("sort_order")),
    unwrap(db.from("creator_photos").select<CreatorPhoto[]>("id, storage_path, category, caption").eq("creator_id", id).order("sort_order")),
    unwrap(db.from("creator_filming_locations").select<CreatorPhoto[]>("id, storage_path, label").eq("creator_id", id).order("sort_order")),
  ]);
  const [heads, vids, pics, locs] = await Promise.all([
    signedUrls("creator-headshots", [creator?.headshot_path, ...videos.map((v) => v.thumbnail_path)]),
    signedUrls("creator-videos", videos.map((v) => v.storage_path)),
    signedUrls("creator-family-pet-photos", photos.map((p) => p.storage_path)),
    signedUrls("creator-filming-locations", locations.map((p) => p.storage_path)),
  ]);
  return { creator, brands, videos, photos, locations, links: new Map([...heads, ...vids, ...pics, ...locs]) };
}

/** dashboard_creators has no updated_at trigger, so the write sets it. A write that matched no row is an error. */
export async function saveCreator(id: string, patch: CreatorPatch): Promise<void> {
  const row = await unwrapOne(
    db.from("dashboard_creators").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select("id").maybeSingle(),
  );
  if (!row) throw new DashboardError({ message: "That creator no longer exists or cannot be changed." });
}

/** A creator added by hand. Returns the new id. */
export async function createCreator(name: string, email: string | null): Promise<string> {
  const row = await unwrapOne(
    db.from("dashboard_creators").insert<{ id: string }[]>({ name, email, source: "manual" }).select("id").maybeSingle(),
  );
  if (!row) throw new DashboardError({ message: "The creator was not added." });
  return row.id;
}
