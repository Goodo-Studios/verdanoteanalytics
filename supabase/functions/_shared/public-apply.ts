// Public creator and actor application forms, behind the `public-apply` function.
//
// begin       makes a draft (one per form fill) and returns its id
// upload_url  checks size and type, then makes a signed upload address for one file inside
//             applications/<draft id>/ in the application's own bucket
// submit      validates and writes the application and its videos, status pending
//
// There is no token, so the protection is the draft id (two hours, used once), the limits per
// address, a hidden field and a minimum fill time. The database functions do the validation and
// the writes; this file only shapes requests and answers.
import { jsonResponse, rateHit, tooMany } from "./public-link.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type ApplyKind = "creator" | "actor";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
};
export const HONEYPOT_FIELD = "company_website";

const BUCKETS: Record<ApplyKind, { headshot: string; video: string }> = {
  creator: { headshot: "creator-application-headshots", video: "creator-application-videos" },
  actor: { headshot: "actor-application-headshots", video: "actor-application-videos" },
};

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function randomName(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function begin(db: Db, kind: ApplyKind, ip: string): Promise<Response> {
  if (!(await rateHit(db, `apply-begin:${ip}`, 10, 3600))) return tooMany(3600);
  const { data, error } = await db.rpc("public_application_begin", { p_kind: kind, p_ip_hash: ip });
  if (error) return jsonResponse({ error: "server_error" }, 500);
  if (!data) return tooMany(3600);
  return jsonResponse({ draft_id: data });
}

export async function uploadUrl(db: Db, kind: ApplyKind, ip: string, body: Record<string, unknown>): Promise<Response> {
  const draftId = str(body.draft_id);
  const fileKind = str(body.file_kind);
  const mime = str(body.mime)?.toLowerCase() ?? "";
  const size = typeof body.size === "number" && Number.isFinite(body.size) ? Math.floor(body.size) : 0;
  if (!draftId || !UUID.test(draftId) || (fileKind !== "headshot" && fileKind !== "video")) return jsonResponse({ error: "invalid" }, 400);
  if (!(await rateHit(db, `apply-upload:${ip}`, 40, 3600))) return tooMany(3600);
  if (!(await rateHit(db, `apply-upload-draft:${draftId}`, 25, 7200))) return tooMany(600);
  const { data, error } = await db.rpc("public_application_reserve_file", {
    p_draft_id: draftId, p_kind: kind, p_file_kind: fileKind, p_size: size, p_mime: mime,
  });
  if (error || !data) return jsonResponse({ error: "server_error" }, 500);
  switch (data.status) {
    case "ok": break;
    case "not_found": return jsonResponse({ error: "not_found" }, 404);
    case "expired": case "used": return jsonResponse({ error: "expired" }, 410);
    case "too_many": return jsonResponse({ error: "too_many_files" }, 400);
    case "too_large": return jsonResponse({ error: "too_large" }, 413);
    default: return jsonResponse({ error: "bad_type" }, 400);
  }
  const path = `applications/${draftId}/${fileKind}/${randomName()}.${EXT[mime]}`;
  const { data: signed, error: signError } = await db.storage.from(String(data.bucket)).createSignedUploadUrl(path);
  if (signError || !signed?.signedUrl) return jsonResponse({ error: "server_error" }, 500);
  return jsonResponse({ path, bucket: String(data.bucket), upload_url: signed.signedUrl, token: signed.token ?? null });
}

/** The names of the files an application folder holds, so a submit can only name real files. */
async function filesIn(db: Db, bucket: string, folder: string): Promise<Set<string>> {
  const { data } = await db.storage.from(bucket).list(folder, { limit: 100 });
  return new Set((Array.isArray(data) ? data : []).map((o: { name?: string }) => `${folder}/${o.name}`));
}

export async function submit(db: Db, kind: ApplyKind, ip: string, body: Record<string, unknown>): Promise<Response> {
  const draftId = str(body.draft_id);
  if (!draftId || !UUID.test(draftId)) return jsonResponse({ error: "invalid" }, 400);
  // The hidden field: a person never fills it in. A bot gets the same thank you and nothing is written.
  const trap = body[HONEYPOT_FIELD];
  if (trap !== undefined && trap !== null && String(trap).trim() !== "") return jsonResponse({ ok: true });
  if (!(await rateHit(db, `apply-submit:${ip}`, 6, 3600))) return tooMany(3600);
  const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? (body.payload as Record<string, unknown>) : null;
  if (!payload) return jsonResponse({ error: "invalid", field: "payload" }, 400);

  // Every file the application names has to exist in this draft's own folder.
  const buckets = BUCKETS[kind];
  const videos = Array.isArray(payload.videos) ? (payload.videos as Record<string, unknown>[]) : [];
  const head = new Set<string>(await filesIn(db, buckets.headshot, `applications/${draftId}/headshot`));
  const vids = new Set<string>(await filesIn(db, buckets.video, `applications/${draftId}/video`));
  const headshot = str(payload.headshot_path);
  const missing = (headshot && !head.has(headshot)) ||
    videos.some((v) => !vids.has(str(v?.storage_path) ?? "") || (str(v?.thumbnail_path) && !head.has(str(v?.thumbnail_path)!)));
  if (missing) return jsonResponse({ error: "invalid", field: "files" }, 400);

  const { data, error } = await db.rpc("public_application_submit", { p_kind: kind, p_draft_id: draftId, p_ip_hash: ip, p_payload: payload });
  if (error || typeof data !== "string") return jsonResponse({ error: "server_error" }, 500);
  if (data === "ok") return jsonResponse({ ok: true });
  if (data === "too_fast") return jsonResponse({ ok: true });
  if (data === "not_found") return jsonResponse({ error: "not_found" }, 404);
  if (data === "expired" || data === "used") return jsonResponse({ error: "expired" }, 410);
  if (data === "too_many") return tooMany(3600);
  if (data.startsWith("invalid:")) return jsonResponse({ error: "invalid", field: data.slice(8) }, 400);
  return jsonResponse({ error: "server_error" }, 500);
}
