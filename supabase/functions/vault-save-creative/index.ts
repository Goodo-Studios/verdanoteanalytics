// vault-save-creative — save an analytics creative into the global Creative Vault.
//
// save-ad-to-vault US-002. Modeled on the vault-ads POST SAVE block (download
// media → insert inspiration_items → best-effort chain to vault-analyze), NOT on
// vault-save (which needs an Apify URL or a pre-uploaded file_path).
//
// The Creative Vault library (inspiration_items) is GLOBAL — readable by all
// authenticated users. `saved_by` records attribution; dedupe is against the
// whole library by source_ad_id (NOT per-user). Writes still pass user_id =
// auth.uid() so the owner-scoped INSERT RLS policy from US-001 is satisfied.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
// Pure save logic (sentinel filtering, snapshot shaping, dedupe decision) lives in
// a dependency-free module so it can be unit-tested under Vitest (US-005).
import {
  buildRecoveryRequest,
  dedupeDecision,
  extFor,
  isMediaContentType,
  needsMediaRecovery,
  normalizeVaultPlatform,
  selectMediaSources,
} from "../_shared/vault-save-logic.ts";
import { errorMessage } from "../_shared/error-message.ts";

// Supabase Edge Runtime global (not in Deno's lib types).
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Cap on a single downloaded media file. Meta ad videos are far below this;
// anything larger is either abuse or something we don't want in the bucket.
const MAX_MEDIA_BYTES = 200 * 1024 * 1024; // 200MB

/**
 * SSRF / arbitrary-download guard: only fetch media from hosts that
 * legitimately flow in from the analytics frontend (src/lib/vaultSave.ts and
 * the CreativeDetailModal pass `creatives` row URLs, optionally rewritten by
 * cache-creative-image):
 *   • *.fbcdn.net — the only host Meta serves creative media from
 *     (see _shared/media-discovery.ts)
 *   • *.cdninstagram.com — Meta's Instagram CDN
 *   • this project's own Supabase storage (cache-creative-image rewrites
 *     recovered URLs to /storage/v1/object/public/ on SUPABASE_URL)
 */
function isAllowedMediaUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  try {
    const supaHost = new URL(Deno.env.get("SUPABASE_URL")!).hostname.toLowerCase();
    if (host === supaHost) return true;
  } catch { /* no SUPABASE_URL — fall through to CDN allowlist */ }
  return (
    host === "fbcdn.net" || host.endsWith(".fbcdn.net") ||
    host === "cdninstagram.com" || host.endsWith(".cdninstagram.com")
  );
}

/** Read a response body into one Uint8Array, aborting past MAX_MEDIA_BYTES. */
async function readBodyCapped(res: Response, srcUrl: string): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_MEDIA_BYTES) {
      await reader.cancel();
      throw new Error(`Refusing to store media from ${srcUrl}: exceeds ${MAX_MEDIA_BYTES} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Download a remote URL and upload it into inspiration-media. Throws on failure. */
async function copyMedia(
  // deno-lint-ignore no-explicit-any
  db: any,
  srcUrl: string,
  storageBase: string,
  kind: "image" | "video",
): Promise<{ path: string; contentType: string }> {
  if (!isAllowedMediaUrl(srcUrl)) {
    throw new Error(`Refusing to download ${kind}: ${srcUrl} is not an allowed media host`);
  }
  const fetchAbort = new AbortController();
  const fetchTimeout = setTimeout(() => fetchAbort.abort(), 60_000);
  let res: Response;
  try {
    res = await fetch(srcUrl, { headers: { "User-Agent": CHROME_UA }, signal: fetchAbort.signal });
  } finally {
    clearTimeout(fetchTimeout);
  }
  if (!res.ok) {
    throw new Error(`Failed to download ${kind} (${res.status}) from ${srcUrl}`);
  }
  const contentType = res.headers.get("content-type") ||
    (kind === "video" ? "video/mp4" : "image/jpeg");
  // Guard: a page URL (e.g. a facebook.com ad page passed instead of a media URL)
  // returns HTML. Storing that as media.<ext> produces an unplayable vault item,
  // so reject any non-media content-type rather than persisting garbage.
  if (!isMediaContentType(contentType, kind)) {
    throw new Error(
      `Refusing to store ${kind}: ${srcUrl} returned non-${kind} content (${contentType})`,
    );
  }
  // Size cap: trust content-length when present, but always enforce while
  // streaming (content-length can be absent or lie).
  const declaredLength = Number(res.headers.get("content-length") || "0");
  if (declaredLength > MAX_MEDIA_BYTES) {
    fetchAbort.abort();
    throw new Error(`Refusing to store ${kind} from ${srcUrl}: declared size exceeds ${MAX_MEDIA_BYTES} bytes`);
  }
  const bytes = await readBodyCapped(res, srcUrl);
  const path = `${storageBase}.${extFor(contentType, kind)}`;
  const { error: uploadErr } = await db.storage
    .from("inspiration-media")
    .upload(path, bytes, { contentType, upsert: true });
  if (uploadErr) {
    throw new Error(`Failed to store ${kind}: ${uploadErr.message}`);
  }
  return { path, contentType };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const db = createClient(supabaseUrl, serviceRoleKey);

  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: "Unauthorized" }, 401);

  if (req.method !== "POST") return json({ error: "Not found" }, 404);

  try {
    const body = await req.json();
    const {
      ad_id,
      account_id,
      ad_name,
      platform,
      full_res_url,
      video_url,
      thumbnail_url,
      performance_snapshot,
    } = body ?? {};

    if (!ad_id) return json({ error: "ad_id required" }, 400);

    // ─── Dedupe against the GLOBAL library (not per-user) ─────────────────────
    const { data: existing } = await db
      .from("inspiration_items")
      .select("id")
      .eq("source_ad_id", ad_id)
      .limit(1)
      .maybeSingle();

    const dedupe = dedupeDecision(existing);
    if (dedupe.alreadySaved) {
      return json({ ok: true, item_id: dedupe.itemId, already_saved: true });
    }

    // ─── Recover durable media URLs server-side (US-004 bulk-save fix) ────────
    // Bulk save (CreativesPage) passes RAW `creatives` rows whose video_url /
    // thumbnail_url are commonly expired Meta CDN links, ad-page URLs, or nulls —
    // none of which copyMedia can download, so every grid save failed ("Saved 0,
    // 1 failed"). The single CreativeDetailModal save dodged this only because the
    // modal recovers media via cache-creative-image before saving. We perform that
    // recovery here so BOTH paths work with no client duplication. Best-effort:
    // any failure falls back to the passed URLs (which copyMedia may still reject).
    let resolvedFullRes = full_res_url;
    let resolvedVideo = video_url;
    let resolvedThumb = thumbnail_url;
    if (account_id && needsMediaRecovery({ video_url, thumbnail_url })) {
      try {
        // Forward the caller's USER JWT (authHeader) — NOT serviceRoleKey. Since the
        // new API-key migration, SUPABASE_SERVICE_ROLE_KEY is the opaque `sb_secret_`
        // format: PostgREST/supabase-js accept it (so our `db` client works), but the
        // Edge Function gateway's verify_jwt only validates real JWTs and rejects the
        // sb_secret form with 401 — silently killing recovery and forcing a 422
        // "No usable creative media" on every save. The incoming user JWT is a valid
        // JWT the gateway accepts (same path the CreativeDetailModal already uses), and
        // cache-creative-image uses its OWN service-role client internally, so the
        // caller's token only needs to clear the gateway. This also survives future
        // key rotations (user JWTs are always JWTs). See buildRecoveryRequest.
        const recoveryReq = buildRecoveryRequest({
          supabaseUrl,
          callerAuthHeader: authHeader,
          ad_id,
          account_id,
        });
        const recovery = await fetch(recoveryReq.url, {
          method: "POST",
          headers: recoveryReq.headers,
          body: recoveryReq.body,
        });
        if (recovery.ok) {
          const r = await recovery.json();
          resolvedFullRes = r.full_res_url ?? resolvedFullRes;
          resolvedVideo = r.video_url ?? resolvedVideo;
          resolvedThumb = r.thumbnail_url ?? resolvedThumb;
        } else {
          console.error(
            `cache-creative-image recovery failed (${recovery.status}) for ${ad_id} — using passed URLs`,
          );
        }
      } catch (e) {
        console.error("cache-creative-image recovery threw (non-fatal):", e);
      }
    }

    // ─── Pick the source URLs to copy (sentinels filtered) ────────────────────
    // video_url is the ONLY video source; full_res_url is a full-resolution IMAGE
    // (the analytics UI renders it with <img>, not <video>) and is used as the
    // still/thumbnail, with thumbnail_url as fallback. See selectMediaSources.
    const { videoSrc, imageSrc } = selectMediaSources({
      full_res_url: resolvedFullRes,
      video_url: resolvedVideo,
      thumbnail_url: resolvedThumb,
    });

    // ─── Copy media into inspiration-media (durable vault-owned copy) ─────────
    // The private bucket is read by the vault UI via signed URLs keyed on
    // file_path / thumbnail_path — never a public URL. At least one media copy
    // must succeed — a download (or content-type) failure fails the save.
    const storageBase = `analytics/${user.id}/${ad_id}`;
    let filePath: string | null = null;
    let thumbnailPath: string | null = null;

    if (videoSrc) {
      const { path } = await copyMedia(db, videoSrc, `${storageBase}/media`, "video");
      filePath = path;
    }

    if (imageSrc) {
      const { path } = await copyMedia(db, imageSrc, `${storageBase}/thumb`, "image");
      thumbnailPath = path;
      // Image-only creative (no video): the still image is the primary file.
      if (!filePath) filePath = path;
    }

    // Media copy is required: if we had no usable URL, or nothing landed, fail.
    if (!filePath) {
      return json(
        { error: "No usable creative media to copy (all URLs missing or sentinels)" },
        422,
      );
    }

    // ─── Insert the global vault item with the frozen perf snapshot ───────────
    const { data: item, error: insertErr } = await db
      .from("inspiration_items")
      .insert({
        user_id: user.id,
        saved_by: user.id,
        platform: normalizeVaultPlatform(platform),
        title: ad_name || null,
        thumbnail_path: thumbnailPath,
        file_path: filePath,
        source_ad_id: ad_id,
        source_account_id: account_id ?? null,
        performance_snapshot: performance_snapshot ?? null,
        status: "pending",
      })
      .select("id")
      .single();

    if (insertErr || !item) {
      throw new Error(insertErr?.message || "Failed to create inspiration item");
    }

    // ─── AI pipeline kick-off. Enter at vault-transcribe ───────────────────────
    // (NOT vault-analyze): transcribe downloads the stored media, writes the
    // raw transcript, then chains to vault-analyze itself. Calling analyze
    // directly throws "No transcript found for item" and marks the item errored.
    // A failed pipeline must NOT fail the save — the item is already committed.
    //
    // Per policy (verdanote-edge-fn-no-waituntil-for-required-calls), don't rely
    // on a bare EdgeRuntime.waitUntil(fetch(...)) — it can silently drop the call,
    // leaving the item stuck at status='pending' while looking saved. Initiate the
    // fetch eagerly and await it for a bounded ack window (so the request is
    // guaranteed dispatched and fast failures surface); a kick-off failure marks
    // the item status='error' with an error_message, which the vault UI's
    // useItemStatus polling surfaces. If transcription is still running past the
    // window, the remainder rides on waitUntil — downstream owns the item status
    // from the moment it receives the request.
    const KICKOFF_ACK_TIMEOUT_MS = 10_000;

    const markKickoffFailed = async (reason: string) => {
      console.error(`vault-save-creative: vault-transcribe kick-off failed for item ${item.id}:`, reason);
      const { error: markError } = await db
        .from("inspiration_items")
        .update({ status: "error", error_message: `Pipeline kick-off failed: ${reason}` })
        .eq("id", item.id);
      if (markError) console.error("vault-save-creative: failed to mark item errored:", markError);
    };

    const kickoff = (async () => {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/vault-transcribe`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ item_id: item.id }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          await markKickoffFailed(`vault-transcribe responded ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`);
        }
      } catch (e) {
        await markKickoffFailed(errorMessage(e));
      }
    })();

    const TIMED_OUT = Symbol("kickoff-ack-timeout");
    let ackTimer: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      kickoff,
      new Promise((resolve) => {
        ackTimer = setTimeout(() => resolve(TIMED_OUT), KICKOFF_ACK_TIMEOUT_MS);
      }),
    ]);
    if (ackTimer !== undefined) clearTimeout(ackTimer);
    if (settled === TIMED_OUT) {
      EdgeRuntime.waitUntil(kickoff);
    }

    return json({ ok: true, item_id: item.id, already_saved: false });
  } catch (err) {
    console.error("vault-save-creative error:", errorMessage(err));
    return json({ error: errorMessage(err) }, 500);
  }
});
