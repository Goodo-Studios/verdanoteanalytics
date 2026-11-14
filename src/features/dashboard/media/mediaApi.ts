// Deletes and edits for creator, actor and location media (phase 6b). Everything runs as the
// signed-in user: the staff-only row rules on the media tables (migration 20261101000003)
// and the staff-only write policies on the media buckets (migration 20261101000004) decide
// what is allowed, so a client login is refused by the database and by storage, not only by
// the page. Uploads are in mediaUpload.ts.
import { supabase } from "@/integrations/supabase/client";
import { DashboardError, db, unwrap, unwrapOne } from "../api";
import { MediaError, nextSortOrder, type MediaKindConfig } from "./mediaModel";

export interface MediaItemRef {
  id: string;
  storage_path: string;
  thumbnail_path?: string | null;
}

/** Removes files from a bucket. A path with no file is not an error; a storage refusal is. */
export async function removeObjects(bucket: string, paths: (string | null | undefined)[]): Promise<void> {
  const wanted = [...new Set(paths.filter((p): p is string => !!p))];
  if (!wanted.length) return;
  const { error } = await supabase.storage.from(bucket).remove(wanted);
  if (error) {
    const e = error as { message: string; status?: number; statusCode?: number | string };
    throw new MediaError(e.message, { status: e.status ?? (Number(e.statusCode) || undefined) });
  }
}

/** Fields to store with a new row, by kind. */
export interface NewRowDetails {
  title?: string | null;
  size?: number;
  mime?: string;
  /** creator_photos only: family or pet. */
  category?: "family" | "pet";
}

function rowFor(cfg: MediaKindConfig, ownerId: string, path: string, sort: number, d: NewRowDetails): Record<string, unknown> {
  const base: Record<string, unknown> = { [cfg.ownerColumn as string]: ownerId, storage_path: path, sort_order: sort };
  if (cfg.type === "video") return { ...base, title: d.title ?? null, size_bytes: d.size ?? null, mime_type: d.mime ?? null };
  if (cfg.kind === "creator-photo") return { ...base, category: d.category ?? "family", caption: null };
  if (cfg.kind === "creator-location") return { ...base, label: null };
  return { ...base, caption: null };
}

/**
 * Adds the row for a file that is now in storage, at the end of the list. Rows with a unique
 * position (videos) can collide when two uploads finish together, so a taken position is
 * read again and retried.
 */
export async function insertMediaRow(cfg: MediaKindConfig, ownerId: string, path: string, details: NewRowDetails = {}): Promise<string> {
  if (!cfg.table || !cfg.ownerColumn) throw new MediaError("This kind of file has no list to add to.");
  for (let attempt = 0; ; attempt++) {
    const rows = await unwrap(db.from(cfg.table).select<{ sort_order: number }[]>("sort_order").eq(cfg.ownerColumn, ownerId));
    const sort = nextSortOrder(rows.map((r) => r.sort_order));
    const res = await db.from(cfg.table).insert<{ id: string }[]>(rowFor(cfg, ownerId, path, sort, details)).select("id").maybeSingle();
    if (!res.error && res.data) return res.data.id;
    if (res.error?.code === "23505" && attempt < 3) continue;
    throw new DashboardError(res.error ?? { message: "The file was uploaded but could not be added to the list." });
  }
}

/** Deletes one file and its row. The file goes first, so a failed delete leaves the row in place to retry. */
export async function deleteMediaItem(cfg: MediaKindConfig, item: MediaItemRef): Promise<void> {
  if (!cfg.table) throw new MediaError("Use remove for a headshot.");
  await removeObjects(cfg.bucket, [item.storage_path]);
  if (cfg.thumbBucket && item.thumbnail_path) await removeObjects(cfg.thumbBucket, [item.thumbnail_path]);
  const gone = await unwrap(db.from(cfg.table).delete<{ id: string }[]>().eq("id", item.id).select("id"));
  if (!gone.length) throw new MediaError("That file could not be taken off the list. Reload the page and look again.");
}

/** Points the owner at a new headshot, then removes the old file. The old file is cleaned up best effort. */
export async function setHeadshot(cfg: MediaKindConfig, ownerId: string, newPath: string, oldPath: string | null): Promise<void> {
  const h = cfg.headshot;
  if (!h) throw new MediaError("This kind of file is not a headshot.");
  const row = await unwrapOne(
    db.from(h.table).update({ [h.column]: newPath, updated_at: new Date().toISOString() }).eq("id", ownerId).select("id").maybeSingle(),
  );
  if (!row) throw new MediaError("The headshot was uploaded but could not be saved. The profile may no longer exist.");
  if (oldPath && oldPath !== newPath) await removeObjects(cfg.bucket, [oldPath]).catch(() => undefined);
}

/** Removes the headshot file, then clears it on the profile. */
export async function removeHeadshot(cfg: MediaKindConfig, ownerId: string, path: string): Promise<void> {
  const h = cfg.headshot;
  if (!h) throw new MediaError("This kind of file is not a headshot.");
  await removeObjects(cfg.bucket, [path]);
  const row = await unwrapOne(
    db.from(h.table).update({ [h.column]: null, updated_at: new Date().toISOString() }).eq("id", ownerId).select("id").maybeSingle(),
  );
  if (!row) throw new MediaError("The headshot could not be cleared. The profile may no longer exist.");
}

/**
 * The positions that make one photo the main one: it goes first and the rest keep their order
 * behind it. Only photos whose position changes are returned.
 */
export function mainFirstOrder(photos: { id: string; sort_order: number }[], mainId: string): { id: string; sort_order: number }[] {
  const ordered = [...photos].sort((a, b) => a.sort_order - b.sort_order);
  const main = ordered.find((p) => p.id === mainId);
  if (!main) throw new MediaError("That photo is no longer on this location.");
  const next = [main, ...ordered.filter((p) => p.id !== mainId)];
  return next
    .map((p, i) => ({ id: p.id, sort_order: i }))
    .filter((n) => photos.find((p) => p.id === n.id)?.sort_order !== n.sort_order);
}

/** Makes one location photo the main one (the first photo shown). */
export async function setMainLocationPhoto(photos: { id: string; sort_order: number }[], mainId: string): Promise<void> {
  const changes = mainFirstOrder(photos, mainId);
  for (const c of changes) {
    const row = await unwrapOne(
      db.from("location_photos").update({ sort_order: c.sort_order, updated_at: new Date().toISOString() }).eq("id", c.id).select("id").maybeSingle(),
    );
    if (!row) throw new MediaError("A photo could not be reordered. Reload the page and try again.");
  }
}
