// Public approval boards and casting links, behind the `public-link` function.
//
// Two link types share one table (approval_boards, board_type creators or actors):
//   approval  the link a brand opens to give a thumbs up or down on shortlisted creators
//   casting   the link a client opens to do the same for actors
//
// Actions: get (the board), vote (one thumbs up or down), photo (one signed photo address).
// The database functions do the scoping (public_board_get, public_board_vote, public_board_media).
// This file turns their answers into responses, signs media with the service role, and builds each
// response from an explicit key list so a column added to a table later is never published by
// accident. Storage paths never leave this file.
import { jsonResponse, notFound, statusResponse } from "./public-link.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type BoardKind = "approval" | "casting";

export const BOARD_TYPE: Record<BoardKind, "creators" | "actors"> = { approval: "creators", casting: "actors" };

const BUCKETS = {
  creators: { video: "creator-videos" },
  actors: { video: "actor-videos", headshot: "actor-headshots" },
} as const;

export const SIGNED_URL_TTL_SECONDS = 3600;
const MAX_VOTED_BY_INPUT = 200;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];

/** Signs a list of paths in one bucket. A path that cannot be signed gets no address. */
async function signMany(db: Db, bucket: string, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(paths.filter((p) => p))];
  if (unique.length === 0) return out;
  try {
    const { data, error } = await db.storage.from(bucket).createSignedUrls(unique, SIGNED_URL_TTL_SECONDS);
    if (error || !Array.isArray(data)) return out;
    for (const row of data) {
      if (row?.path && row?.signedUrl && !row.error) out.set(row.path, row.signedUrl);
    }
  } catch {
    // An unsigned file shows as missing. The board still loads.
  }
  return out;
}

export async function getBoard(db: Db, kind: BoardKind, tokenHash: string, countOpen: boolean): Promise<Response> {
  const type = BOARD_TYPE[kind];
  const { data, error } = await db.rpc("public_board_get", {
    p_token_hash: tokenHash,
    p_board_type: type,
    p_count_open: countOpen,
  });
  if (error || !data || typeof data !== "object") return jsonResponse({ error: "server_error" }, 500);
  if (data.status !== "ok") return statusResponse(String(data.status));

  const people = arr(data.people);
  const videoPaths: string[] = [];
  const headshotPaths: string[] = [];
  for (const p of people) {
    for (const v of arr(p.videos)) {
      const vp = str(v.video_path);
      const tp = str(v.thumbnail_path);
      if (vp) videoPaths.push(vp);
      if (tp) videoPaths.push(tp);
    }
    const hp = str(p.headshot_path);
    if (hp) headshotPaths.push(hp);
  }
  const videoBucket = BUCKETS[type].video;
  const headshotBucket = type === "actors" ? BUCKETS.actors.headshot : null;
  const [videoUrls, headshotUrls] = await Promise.all([
    signMany(db, videoBucket, videoPaths),
    headshotBucket ? signMany(db, headshotBucket, headshotPaths) : Promise.resolve(new Map<string, string>()),
  ]);

  const shapeVideos = (p: Record<string, unknown>) =>
    arr(p.videos).map((v) => ({
      id: str(v.id),
      title: str(v.title),
      ...(type === "creators" ? { format: str(v.format) } : {}),
      url: videoUrls.get(str(v.video_path) ?? "") ?? null,
      thumbnail_url: videoUrls.get(str(v.thumbnail_path) ?? "") ?? null,
    }));

  const shaped = people.map((p) =>
    type === "creators"
      ? {
          assignment_id: str(p.assignment_id),
          name: str(p.name),
          videos: shapeVideos(p),
          family_pet_photos: arr(p.family_pet_photos).map((x) => ({ id: str(x.id), category: str(x.category), caption: str(x.caption) })),
          filming_location_photos: arr(p.filming_location_photos).map((x) => ({ id: str(x.id), label: str(x.label) })),
          vote: str(p.vote),
        }
      : {
          assignment_id: str(p.assignment_id),
          name: str(p.name),
          gender: str(p.gender),
          age_range: Array.isArray(p.age_range) ? p.age_range.filter((a): a is string => typeof a === "string") : [],
          headshot_url: headshotUrls.get(str(p.headshot_path) ?? "") ?? null,
          videos: shapeVideos(p),
          photos: arr(p.photos).map((x) => ({ id: str(x.id), caption: str(x.caption) })),
          social_url: str(p.social_url),
          additional_social_url: str(p.additional_social_url),
          vote: str(p.vote),
        },
  );

  return jsonResponse({
    kind,
    client_name: str(data.client_name) ?? "",
    expires_at: str(data.expires_at),
    people: shaped,
  });
}

export async function castVote(db: Db, kind: BoardKind, tokenHash: string, body: Record<string, unknown>): Promise<Response> {
  const assignmentId = str(body.assignment_id);
  const vote = str(body.vote);
  if (!assignmentId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assignmentId) || (vote !== "up" && vote !== "down")) {
    // Resolve the token first so a bad token still looks like any other bad token.
    return await invalidAfterTokenCheck(db, kind, tokenHash);
  }
  const votedBy = str(body.voted_by)?.slice(0, MAX_VOTED_BY_INPUT) ?? null;
  const { data, error } = await db.rpc("public_board_vote", {
    p_token_hash: tokenHash,
    p_board_type: BOARD_TYPE[kind],
    p_assignment_id: assignmentId,
    p_vote: vote,
    p_voted_by: votedBy,
  });
  if (error) return jsonResponse({ error: "server_error" }, 500);
  if (data === "ok") return jsonResponse({ ok: true });
  if (data === "invalid") return jsonResponse({ error: "invalid" }, 400);
  return statusResponse(String(data));
}

async function invalidAfterTokenCheck(db: Db, kind: BoardKind, tokenHash: string): Promise<Response> {
  const { data, error } = await db.rpc("public_board_vote", {
    p_token_hash: tokenHash,
    p_board_type: BOARD_TYPE[kind],
    p_assignment_id: null,
    p_vote: null,
    p_voted_by: null,
  });
  if (error) return jsonResponse({ error: "server_error" }, 500);
  if (data === "invalid" || data === "ok") return jsonResponse({ error: "invalid" }, 400);
  return statusResponse(String(data));
}

export async function getPhoto(db: Db, kind: BoardKind, tokenHash: string, body: Record<string, unknown>): Promise<Response> {
  const mediaKind = str(body.kind);
  const id = str(body.id);
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !mediaKind) return notFound();
  const { data, error } = await db.rpc("public_board_media", {
    p_token_hash: tokenHash,
    p_board_type: BOARD_TYPE[kind],
    p_kind: mediaKind,
    p_id: id,
  });
  if (error || !data) return jsonResponse({ error: "server_error" }, 500);
  if (data.status !== "ok") return data.status === "not_found" ? notFound() : statusResponse(String(data.status));
  const urls = await signMany(db, String(data.bucket), [String(data.path)]);
  const url = urls.get(String(data.path));
  if (!url) return notFound();
  return jsonResponse({ url });
}
