// vault-extract-webhook — port from Creative Vault (US-002). User-scoped only.
// Receives Apify ACTOR.RUN.* callbacks; updates inspiration_items + kicks off vault-transcribe.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { ACTOR_CONFIGS } from "../_shared/actor-configs.ts";

const APIFY_BASE = "https://api.apify.com/v2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const apifyToken = Deno.env.get("APIFY_TOKEN")!;
  const db = createClient(supabaseUrl, serviceRoleKey);

  let itemId = "";
  try {
    // itemId comes from the query string (embedded in the webhook URL by vault-extract).
    // eventType and runId come from Apify's default payload body — no template engine needed.
    const url = new URL(req.url);
    itemId = url.searchParams.get("item_id") ?? "";

    const body = await req.json();
    const eventType = (body.eventType ?? "") as string;
    // Apify's default payload: resource.id = run ID; fallback to eventData.actorRunId
    const runId = (body.resource?.id ?? body.eventData?.actorRunId ?? "") as string;

    console.log(`vault-extract-webhook: itemId=${itemId} eventType=${eventType} runId=${runId}`);
    console.log("Apify webhook body:", JSON.stringify(body).slice(0, 500));

    if (!itemId) return json({ error: "itemId required" }, 400);

    // Non-success events — mark the item as failed so the UI shows an error.
    if (eventType !== "ACTOR.RUN.SUCCEEDED") {
      const reason = eventType === "ACTOR.RUN.TIMED_OUT"
        ? "Apify run timed out. The video may be too long — try downloading it and using the Upload tab instead."
        : `Apify run did not succeed (${eventType}). Try downloading the video and using the Upload tab instead.`;
      await db.from("inspiration_items").update({
        status: "error",
        error_message: reason,
      }).eq("id", itemId);
      return json({ ok: true });
    }

    // Fetch the item to get platform + user_id.
    const { data: item, error: fetchError } = await db
      .from("inspiration_items")
      .select("id, user_id, platform")
      .eq("id", itemId)
      .single();

    if (fetchError || !item) {
      console.error("Item not found for webhook:", itemId);
      return json({ error: "Item not found" }, 404);
    }

    const config = ACTOR_CONFIGS[item.platform ?? "unknown"];
    if (!config) {
      await db.from("inspiration_items").update({
        status: "error",
        error_message: `Unsupported platform "${item.platform}". Download the video and use the Upload tab instead.`,
      }).eq("id", itemId);
      return json({ ok: true });
    }

    // Retrieve the dataset items produced by this run.
    const datasetRes = await fetch(
      `${APIFY_BASE}/actor-runs/${runId}/dataset/items?token=${apifyToken}`
    );
    if (!datasetRes.ok) {
      throw new Error(`Failed to fetch Apify dataset for run ${runId}: status ${datasetRes.status}`);
    }

    const items = await datasetRes.json();
    if (!items?.length) {
      throw new Error(
        "Apify returned no results. The post may be private or deleted. " +
        "Try downloading the video and using the Upload tab instead."
      );
    }

    // Detect actor-level error responses. The facebook-ads-scraper (and some other actors)
    // return a single item with {url, error, errorDescription} when the ad is expired,
    // private, or not found — rather than returning an empty dataset.
    const firstItem = items[0] as Record<string, unknown>;
    if (firstItem?.error) {
      throw new Error(
        `Could not retrieve this ad (${String(firstItem.error)}). ` +
        `${firstItem.errorDescription ? String(firstItem.errorDescription) + " " : ""}` +
        `The ad may have expired or been removed from the Ad Library. ` +
        `Try a different ad URL, or use the Upload tab if you have the video file.`
      );
    }

    const videoUrl = config.extractVideoUrl(items[0]);
    if (!videoUrl) {
      // Metadata-only platforms: Instagram image/carousel posts have no videoUrl,
      // and YouTube CDN is not downloadable. Save the thumbnail + title and mark ready.
      // facebook_ad image-only: save metadata + ad copy, then kick off vault-analyze.
      const METADATA_ONLY_PLATFORMS = ["instagram", "youtube", "twitter", "facebook_ad"];
      if (METADATA_ONLY_PLATFORMS.includes(item.platform ?? "")) {
        const thumbnailUrl = config.extractThumbnailUrl(items[0]);
        const creatorHandle = config.extractCreatorHandle(items[0]);
        // Guard against marielise.dev actor's "Unknown" sentinel (returned when
        // the download fails). Treat "Unknown" as absent so we don't overwrite a
        // real title that may already exist on the item.
        const rawTitle = config.extractTitle?.(items[0]) ?? undefined;
        const title = rawTitle && rawTitle !== "Unknown" ? rawTitle : undefined;

        let thumbnailPath: string | undefined;
        if (thumbnailUrl) {
          try {
            const platformReferer =
              item.platform === "instagram" ? "https://www.instagram.com/" :
              item.platform === "facebook_ad" ? "https://www.facebook.com/" :
              "https://www.youtube.com/";
            const thumbRes = await fetch(thumbnailUrl, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                Referer: platformReferer,
                Accept: "image/webp,image/jpeg,image/*,*/*;q=0.8",
              },
            });
            if (thumbRes.ok) {
              const thumbBytes = await thumbRes.arrayBuffer();
              const thumbContentType = thumbRes.headers.get("content-type") ?? "image/jpeg";
              const thumbExt = thumbContentType.includes("webp") ? "webp" : "jpg";
              thumbnailPath = `thumbnails/${item.user_id}/${itemId}.${thumbExt}`;
              const { error: thumbUploadError } = await db.storage
                .from("inspiration-media")
                .upload(thumbnailPath, thumbBytes, { contentType: thumbContentType, upsert: true });
              if (thumbUploadError) thumbnailPath = undefined;
            }
          } catch (_err) {
            // Best-effort thumbnail — continue without it
          }
        }

        // facebook_ad image-only: store thumbnail as file_path so vault-analyze can
        // resolve it from Supabase Storage (CDN thumbnail_url may expire before the
        // user clicks "Run analysis"). Fire vault-analyze with media_kind="image" so
        // it takes the image-only branch (no transcript required).
        const isFacebookAd = item.platform === "facebook_ad";
        await db.from("inspiration_items").update({
          thumbnail_url: thumbnailUrl ?? undefined,
          thumbnail_path: thumbnailPath ?? undefined,
          // For FB image ads, promote the stored thumbnail to file_path so vault-analyze
          // can resolve a signed URL from storage when the CDN link has expired.
          ...(isFacebookAd && thumbnailPath ? { file_path: thumbnailPath } : {}),
          creator_handle: creatorHandle ?? undefined,
          ...(title ? { title } : {}),
          status: isFacebookAd ? "analyzing" : "ready",
        }).eq("id", itemId);

        if (isFacebookAd) {
          // Await synchronously rather than EdgeRuntime.waitUntil — for image-only FB ads
          // vault-analyze completes in <1s (no image → instant graceful fallback) or <20s
          // (Claude vision on thumbnail). waitUntil was silently dropping the call.
          await fetch(`${supabaseUrl}/functions/v1/vault-analyze`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${serviceRoleKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ item_id: itemId, media_kind: "image" }),
          }).catch(console.error);
        }

        return json({ ok: true, item_id: itemId, type: "metadata_only" });
      }

      throw new Error(
        `Could not find a video URL in the Apify response. ` +
        `Available keys: ${Object.keys(items[0]).join(", ")}. ` +
        `Try downloading the video and using the Upload tab instead.`
      );
    }

    const thumbnailUrl = config.extractThumbnailUrl(items[0]);
    const creatorHandle = config.extractCreatorHandle(items[0]);
    // Extract title for platforms that provide one (YouTube, Twitter).
    // Guard against the marielise.dev sentinel value returned on download failure.
    const rawExtractedTitle = config.extractTitle?.(items[0]) ?? undefined;
    const extractedTitle = rawExtractedTitle && rawExtractedTitle !== "Unknown"
      ? rawExtractedTitle
      : undefined;

    // Download the thumbnail and store it in Supabase Storage so the UI can
    // load it via a signed URL — external CDN URLs (Instagram, TikTok) have
    // hotlink protection that blocks direct <img> embedding from other domains.
    let thumbnailPath: string | undefined;
    if (thumbnailUrl) {
      try {
        const thumbRes = await fetch(thumbnailUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            Referer: "https://www.instagram.com/",
            Accept: "image/webp,image/jpeg,image/*,*/*;q=0.8",
          },
        });
        if (thumbRes.ok) {
          const thumbBytes = await thumbRes.arrayBuffer();
          const thumbContentType = thumbRes.headers.get("content-type") ?? "image/jpeg";
          const thumbExt = thumbContentType.includes("webp") ? "webp" : "jpg";
          thumbnailPath = `thumbnails/${item.user_id}/${itemId}.${thumbExt}`;
          const { error: thumbUploadError } = await db.storage
            .from("inspiration-media")
            .upload(thumbnailPath, thumbBytes, { contentType: thumbContentType, upsert: true });
          if (thumbUploadError) {
            console.error("Thumbnail upload failed:", thumbUploadError);
            thumbnailPath = undefined;
          }
        } else {
          console.warn(`Thumbnail download returned ${thumbRes.status} for item ${itemId}`);
        }
      } catch (err) {
        console.error("Thumbnail download/upload failed, will fall back to CDN URL:", err);
      }
    }

    // Download the video and store it permanently in Supabase Storage.
    // Apify KV store URLs need the token appended; CDN URLs need browser-like headers.
    const isApifyStorage = videoUrl.includes("api.apify.com");
    const downloadUrl = isApifyStorage
      ? `${videoUrl}${videoUrl.includes("?") ? "&" : "?"}token=${apifyToken}`
      : videoUrl;

    const videoRes = await fetch(downloadUrl, {
      headers: isApifyStorage
        ? {}
        : {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            Referer: "https://www.tiktok.com/",
            Accept: "video/webm,video/mp4,video/*;q=0.9,*/*;q=0.8",
          },
    });

    if (!videoRes.ok) {
      throw new Error(
        `Could not download video from ${item.platform} CDN (status ${videoRes.status}). ` +
        `The CDN URL may require a logged-in session. Download the video manually and use the Upload tab instead.`
      );
    }

    const contentType = videoRes.headers.get("content-type") ?? "video/mp4";
    if (
      !contentType.startsWith("video/") &&
      !contentType.startsWith("audio/") &&
      !contentType.startsWith("application/octet")
    ) {
      throw new Error(
        `CDN returned non-video content (${contentType}). The download URL may have expired — try submitting the URL again.`
      );
    }

    const videoBytes = await videoRes.arrayBuffer();
    const ext = contentType.includes("webm") ? "webm" : "mp4";
    const storagePath = `uploads/${item.user_id}/${Date.now()}.${ext}`;

    const { error: uploadError } = await db.storage
      .from("inspiration-media")
      .upload(storagePath, videoBytes, { contentType, upsert: false });

    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

    await db
      .from("inspiration_items")
      .update({
        video_url: videoUrl,
        file_path: storagePath,
        thumbnail_url: thumbnailUrl ?? undefined,
        thumbnail_path: thumbnailPath ?? undefined,
        creator_handle: creatorHandle ?? undefined,
        ...(extractedTitle ? { title: extractedTitle } : {}),
        status: "transcribing",
      })
      .eq("id", itemId);

    // Kick off transcription asynchronously — don't block the webhook response.
    EdgeRuntime.waitUntil(
      fetch(`${supabaseUrl}/functions/v1/vault-transcribe`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ item_id: itemId }),
      }).catch(console.error)
    );

    return json({ ok: true, item_id: itemId });
  } catch (err) {
    console.error("vault-extract-webhook error:", err);
    if (itemId) {
      await db
        .from("inspiration_items")
        .update({ status: "error", error_message: String(err) })
        .eq("id", itemId);
    }
    return json({ error: String(err) }, 500);
  }
});
