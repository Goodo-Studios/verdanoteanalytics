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

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Sentinel placeholders the analytics side stores when a media URL is absent.
const SENTINELS = new Set(["no-thumbnail", "no-video"]);

/** Returns the URL if it is a real, usable media URL — else null. */
function cleanUrl(u: unknown): string | null {
  if (typeof u !== "string") return null;
  const v = u.trim();
  if (!v || SENTINELS.has(v)) return null;
  return v;
}

/** Pick a storage extension from a content-type, defaulting per media kind. */
function extFor(contentType: string, kind: "image" | "video"): string {
  const ct = contentType.toLowerCase();
  if (kind === "video") {
    if (ct.includes("webm")) return "webm";
    if (ct.includes("quicktime") || ct.includes("mov")) return "mov";
    return "mp4";
  }
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  return "jpg";
}

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
  const bytes = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") ||
    (kind === "video" ? "video/mp4" : "image/jpeg");
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

    if (existing) {
      return json({ ok: true, item_id: existing.id, already_saved: true });
    }

    // ─── Filter sentinels out of the media URLs before any use ────────────────
    const fullRes = cleanUrl(full_res_url);
    const video = cleanUrl(video_url);
    const thumb = cleanUrl(thumbnail_url);

    // ─── Copy media into inspiration-media (durable vault-owned copy) ─────────
    // Prefer a video copy (full_res or video_url), then a thumbnail. At least one
    // media copy must succeed — a download failure fails the save (per AC).
    const storageBase = `analytics/${user.id}/${ad_id}`;
    let filePath: string | null = null;
    let storedThumbnailUrl: string | null = null;

    const videoSrc = fullRes ?? video;
    if (videoSrc) {
      const { path } = await copyMedia(db, videoSrc, `${storageBase}/media`, "video");
      filePath = path;
    }

    if (thumb) {
      const { path } = await copyMedia(db, thumb, `${storageBase}/thumb`, "image");
      const { data: pub } = db.storage.from("inspiration-media").getPublicUrl(path);
      storedThumbnailUrl = pub?.publicUrl ?? null;
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
        platform: platform || "analytics_creative",
        title: ad_name || null,
        thumbnail_url: storedThumbnailUrl ?? thumb ?? null,
        file_path: filePath,
        source_ad_id: ad_id,
        source_account_id: account_id ?? null,
        performance_snapshot: performance_snapshot ?? null,
        status: "analyzing",
      })
      .select("id")
      .single();

    if (insertErr || !item) {
      throw new Error(insertErr?.message || "Failed to create inspiration item");
    }

    // ─── Best-effort fire-and-forget AI analysis. A failed analyze must NOT ───
    // fail the save — the item is already committed above.
    EdgeRuntime.waitUntil(
      fetch(`${supabaseUrl}/functions/v1/vault-analyze`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ item_id: item.id }),
      }).catch((e) => console.error("vault-analyze chain failed (non-fatal):", e)),
    );

    return json({ ok: true, item_id: item.id, already_saved: false });
  } catch (err) {
    console.error("vault-save-creative error:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
