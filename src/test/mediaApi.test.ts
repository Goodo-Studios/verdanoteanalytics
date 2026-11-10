/**
 * Media deletes and edits (phase 6b): a delete removes the file first and the row second, so a
 * failed file delete leaves the row to retry; a new row goes after the last one and retries a
 * taken position; headshots swap and clear; "set as main photo" renumbers.
 * The staff-only rules these run under are in supabase/tests/dashboard_media_upload_test.sql.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: { code?: string; message: string } | null };
const log: string[] = [];
let results: Record<string, Result[]> = {};
let storageError: { message: string; status?: number } | null = null;

function next(key: string): Result {
  const queue = results[key] ?? [];
  return queue.length > 1 ? queue.shift()! : queue[0] ?? { data: [], error: null };
}

interface Chain {
  select(...a: unknown[]): Chain;
  insert(...a: unknown[]): Chain;
  update(...a: unknown[]): Chain;
  delete(...a: unknown[]): Chain;
  eq(...a: unknown[]): Chain;
  order(...a: unknown[]): Chain;
  maybeSingle(): Promise<Result>;
  then(ok: (r: Result) => unknown, bad: (e: unknown) => unknown): Promise<unknown>;
}

function chain(table: string, op: string): Chain {
  const parts: string[] = [`${op} ${table}`];
  const c = {} as Chain;
  const done = () => {
    log.push(parts.join(" "));
    return next(`${op} ${table}`);
  };
  for (const m of ["select", "insert", "update", "delete", "eq", "order"] as const) {
    c[m] = (...a: unknown[]) => {
      if (m === "eq") parts.push(`${a[0]}=${a[1]}`);
      if (m === "insert" || m === "update") parts.push(JSON.stringify(a[0]).replace(/"updated_at":"[^"]+"/, '"updated_at":"T"'));
      return c;
    };
  }
  c.maybeSingle = () => Promise.resolve(done());
  c.then = (ok: (r: Result) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(done()).then(ok, bad);
  return c;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => chain(table, "select").select(),
      insert: (v: unknown) => chain(table, "insert").insert(v),
      update: (v: unknown) => chain(table, "update").update(v),
      delete: () => chain(table, "delete").delete(),
    }),
    storage: {
      from: (bucket: string) => ({
        remove: (paths: string[]) => {
          log.push(`remove ${bucket} ${paths.join(",")}`);
          return Promise.resolve({ data: [], error: storageError });
        },
      }),
    },
  },
}));

import {
  deleteMediaItem,
  insertMediaRow,
  removeHeadshot,
  removeObjects,
  setHeadshot,
  setMainLocationPhoto,
} from "@/features/dashboard/media/mediaApi";
import { MEDIA_KINDS } from "@/features/dashboard/media/mediaModel";

beforeEach(() => {
  log.length = 0;
  results = {};
  storageError = null;
});

describe("delete", () => {
  it("removes the file, then the row", async () => {
    results["delete creator_videos"] = [{ data: [{ id: "v1" }], error: null }];
    await deleteMediaItem(MEDIA_KINDS["creator-video"], { id: "v1", storage_path: "c1/video-a.mp4", thumbnail_path: "c1/video-a.jpg" });
    expect(log).toEqual([
      "remove creator-videos c1/video-a.mp4",
      "remove creator-headshots c1/video-a.jpg",
      "delete creator_videos id=v1",
    ]);
  });

  it("keeps the row when storage refuses, so the delete can be tried again", async () => {
    storageError = { message: "storage is down", status: 500 };
    await expect(deleteMediaItem(MEDIA_KINDS["location-photo"], { id: "p1", storage_path: "l1/photo-a.jpg" })).rejects.toThrow("storage is down");
    expect(log).toEqual(["remove location-photos l1/photo-a.jpg"]);
  });

  it("says so when no row was deleted", async () => {
    results["delete actor_photos"] = [{ data: [], error: null }];
    await expect(deleteMediaItem(MEDIA_KINDS["actor-photo"], { id: "p9", storage_path: "a1/photo-z.jpg" })).rejects.toThrow(/could not be taken off the list/);
  });

  it("surfaces a database refusal", async () => {
    results["delete actor_photos"] = [{ data: null, error: { code: "42501", message: "permission denied" } }];
    await expect(deleteMediaItem(MEDIA_KINDS["actor-photo"], { id: "p9", storage_path: "a1/photo-z.jpg" })).rejects.toMatchObject({ code: "42501" });
  });

  it("removes nothing for an empty list of paths, and ignores a repeated path", async () => {
    await removeObjects("actor-photos", [null, undefined, ""]);
    expect(log).toEqual([]);
    await removeObjects("actor-photos", ["a/x.jpg", "a/x.jpg"]);
    expect(log).toEqual(["remove actor-photos a/x.jpg"]);
  });
});

describe("new rows", () => {
  it("adds a video after the last one with its size and type", async () => {
    results["select creator_videos"] = [{ data: [{ sort_order: 1 }, { sort_order: 4 }], error: null }];
    results["insert creator_videos"] = [{ data: { id: "new" }, error: null }];
    const id = await insertMediaRow(MEDIA_KINDS["creator-video"], "c1", "c1/video-x.mp4", { title: "Take one", size: 1234, mime: "video/mp4" });
    expect(id).toBe("new");
    expect(log[1]).toBe('insert creator_videos {"creator_id":"c1","storage_path":"c1/video-x.mp4","sort_order":5,"title":"Take one","size_bytes":1234,"mime_type":"video/mp4"}');
  });

  it("stores the family or pet choice for a creator photo and a plain caption elsewhere", async () => {
    results["insert creator_photos"] = [{ data: { id: "a" }, error: null }];
    await insertMediaRow(MEDIA_KINDS["creator-photo"], "c1", "c1/photo-x.jpg", { category: "pet" });
    expect(log.find((l) => l.startsWith("insert creator_photos"))).toContain('"category":"pet"');
    results["insert location_photos"] = [{ data: { id: "b" }, error: null }];
    await insertMediaRow(MEDIA_KINDS["location-photo"], "l1", "l1/photo-x.jpg");
    expect(log.find((l) => l.startsWith("insert location_photos"))).toBe('insert location_photos {"location_id":"l1","storage_path":"l1/photo-x.jpg","sort_order":0,"caption":null}');
  });

  it("reads the list again and retries when another upload took the position", async () => {
    results["select actor_videos"] = [{ data: [{ sort_order: 1 }], error: null }, { data: [{ sort_order: 1 }, { sort_order: 2 }], error: null }];
    results["insert actor_videos"] = [{ data: null, error: { code: "23505", message: "duplicate key" } }, { data: { id: "ok" }, error: null }];
    const id = await insertMediaRow(MEDIA_KINDS["actor-video"], "a1", "a1/video-x.mp4", { size: 1, mime: "video/mp4" });
    expect(id).toBe("ok");
    expect(log.filter((l) => l.startsWith("insert actor_videos")).map((l) => /"sort_order":(\d+)/.exec(l)![1])).toEqual(["2", "3"]);
  });

  it("gives up on another database refusal, such as the cap", async () => {
    results["insert actor_photos"] = [{ data: null, error: { code: "23514", message: "actor already has 8 gallery photos (limit is 8)" } }];
    await expect(insertMediaRow(MEDIA_KINDS["actor-photo"], "a1", "a1/photo-x.jpg")).rejects.toMatchObject({ code: "23514" });
  });
});

describe("headshots", () => {
  it("points the profile at the new file, then removes the old one", async () => {
    results["update dashboard_creators"] = [{ data: { id: "c1" }, error: null }];
    await setHeadshot(MEDIA_KINDS["creator-headshot"], "c1", "c1/headshot-new.jpg", "c1/headshot-old.jpg");
    expect(log).toEqual([
      'update dashboard_creators {"headshot_path":"c1/headshot-new.jpg","updated_at":"T"} id=c1',
      "remove creator-headshots c1/headshot-old.jpg",
    ]);
  });

  it("does not fail the change when the old file cannot be removed", async () => {
    results["update actors"] = [{ data: { id: "a1" }, error: null }];
    storageError = { message: "nope" };
    await expect(setHeadshot(MEDIA_KINDS["actor-headshot"], "a1", "a1/headshot-new.png", "a1/headshot-old.png")).resolves.toBeUndefined();
  });

  it("fails when the profile is gone", async () => {
    results["update actors"] = [{ data: null, error: null }];
    await expect(setHeadshot(MEDIA_KINDS["actor-headshot"], "a1", "a1/h.png", null)).rejects.toThrow(/could not be saved/);
  });

  it("removes the file, then clears the profile; a refused file delete leaves the profile alone", async () => {
    results["update actors"] = [{ data: { id: "a1" }, error: null }];
    await removeHeadshot(MEDIA_KINDS["actor-headshot"], "a1", "a1/h.png");
    expect(log).toEqual(["remove actor-headshots a1/h.png", 'update actors {"headshot_path":null,"updated_at":"T"} id=a1']);
    log.length = 0;
    storageError = { message: "storage is down" };
    await expect(removeHeadshot(MEDIA_KINDS["actor-headshot"], "a1", "a1/h.png")).rejects.toThrow("storage is down");
    expect(log).toEqual(["remove actor-headshots a1/h.png"]);
  });
});

describe("set as main photo", () => {
  it("renumbers the photos with the chosen one first", async () => {
    results["update location_photos"] = [{ data: { id: "x" }, error: null }];
    await setMainLocationPhoto([{ id: "a", sort_order: 0 }, { id: "b", sort_order: 1 }, { id: "c", sort_order: 2 }], "c");
    expect(log).toEqual([
      'update location_photos {"sort_order":0,"updated_at":"T"} id=c',
      'update location_photos {"sort_order":1,"updated_at":"T"} id=a',
      'update location_photos {"sort_order":2,"updated_at":"T"} id=b',
    ]);
  });

  it("does nothing when the photo is already first, and reports a photo that was not saved", async () => {
    await setMainLocationPhoto([{ id: "a", sort_order: 0 }, { id: "b", sort_order: 1 }], "a");
    expect(log).toEqual([]);
    results["update location_photos"] = [{ data: null, error: null }];
    await expect(setMainLocationPhoto([{ id: "a", sort_order: 0 }, { id: "b", sort_order: 1 }], "b")).rejects.toThrow(/could not be reordered/);
  });
});
