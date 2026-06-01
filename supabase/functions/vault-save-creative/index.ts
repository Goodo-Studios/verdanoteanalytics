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

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Download a remote URL and upload it into inspiration-media. Throws on failure. */
async function copyMedia(
  // deno-lint-ignore no-explicit-any
  db: any,
  srcUrl: string,
  storageBase: string,
  kind: "image" | "video",
): Promise<{ path: string; contentType: string }> {
  const res = await fetch(srcUrl, { headers: { "User-Agent": CHROME_UA } });
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
  const bytes = await res.arrayBuffer();
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

    // ─── Best-effort fire-and-forget AI pipeline. Enter at vault-transcribe ───
    // (NOT vault-analyze): transcribe downloads the stored media, writes the
    // raw transcript, then chains to vault-analyze itself. Calling analyze
    // directly throws "No transcript found for item" and marks the item errored.
    // A failed pipeline must NOT fail the save — the item is already committed.
    EdgeRuntime.waitUntil(
      fetch(`${supabaseUrl}/functions/v1/vault-transcribe`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ item_id: item.id }),
      }).catch((e) => console.error("vault-transcribe chain failed (non-fatal):", e)),
    );

    return json({ ok: true, item_id: item.id, already_saved: false });
  } catch (err) {
    console.error("vault-save-creative error:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
