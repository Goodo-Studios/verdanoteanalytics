/**
 * Shared media discovery module for Meta Graph API.
 * Unified v22.0 API — used by refresh-thumbnails, enrich-thumbnails, fetch-thumbnail.
 */

const META_API_VERSION = "v22.0";

export const NO_THUMB_SENTINEL = "no-thumbnail";
export const NO_VIDEO_SENTINEL = "no-video";

/** Fetch with a timeout — aborts if the request takes longer than timeoutMs */
export async function fetchWithTimeout(url: string, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Discover a high-res image URL from Meta Graph API.
 * Returns { thumbnailUrl, fullResUrl } where fullResUrl is the highest-resolution
 * source available (stored separately so the modal can use it without rescaling).
 */
export async function discoverImageUrl(
  adId: string,
  accountId: string,
  accessToken: string,
  timeoutMs = 30_000
): Promise<{ thumbnailUrl: string; fullResUrl: string | null } | null> {
  try {
    const res = await fetchWithTimeout(
      `https://graph.facebook.com/${META_API_VERSION}/${adId}?fields=creative{thumbnail_url,image_url,image_hash,object_story_spec}&access_token=${accessToken}`,
      timeoutMs
    );
    if (!res.ok) {
      console.log(`Meta API failed for ${adId}: ${res.status}`);
      await res.text();
      return null;
    }
    const data = await res.json();
    const creative = data?.creative;
    if (!creative) return null;

    // Strategy 1: Resolve image_hash → full-res URL
    const imageHash =
      creative.image_hash ||
      creative.object_story_spec?.link_data?.image_hash ||
      creative.object_story_spec?.photo_data?.image_hash;

    if (imageHash) {
      const imgRes = await fetchWithTimeout(
        `https://graph.facebook.com/${META_API_VERSION}/${accountId}/adimages?hashes=["${imageHash}"]&fields=url,url_128,width,height,original_width,original_height,permalink_url&access_token=${accessToken}`,
        timeoutMs
      );
      if (imgRes.ok) {
        const imgData = await imgRes.json();
        const images = imgData?.data;
        if (images && images.length > 0) {
          const img = images[0];
          const fullUrl = img.url;
          const w = img.original_width || img.width || 0;
          console.log(`image_hash for ${adId}: ${w}px wide, url length: ${fullUrl?.length}`);
          if (fullUrl && fullUrl.length > 100) {
            return { thumbnailUrl: fullUrl, fullResUrl: fullUrl };
          }
        }
      } else {
        await imgRes.text();
      }
    }

    // Strategy 2: Video thumbnail
    const spec = creative.object_story_spec;
    const videoId = spec?.video_data?.video_id || spec?.template_data?.video_data?.video_id;

    if (videoId) {
      const vidRes = await fetchWithTimeout(
        `https://graph.facebook.com/${META_API_VERSION}/${videoId}?fields=thumbnails{uri,width,height}&access_token=${accessToken}`,
        timeoutMs
      );
      if (vidRes.ok) {
        const vidData = await vidRes.json();
        const thumbs = vidData?.thumbnails?.data;
        if (thumbs && thumbs.length > 0) {
          const sorted = thumbs.sort((a: any, b: any) => (b.width || 0) - (a.width || 0));
          const best = sorted[0];
          if (best?.uri && (best.width || 0) >= 480) {
            console.log(`Video thumbnail for ${adId}: ${best.width}x${best.height}`);
            return { thumbnailUrl: best.uri, fullResUrl: null };
          } else {
            console.log(`Video thumbnail too small for ${adId}: ${best?.width}x${best?.height} — skipping`);
          }
        }
      } else {
        await vidRes.text();
      }

      const picRes = await fetchWithTimeout(
        `https://graph.facebook.com/${META_API_VERSION}/${videoId}/picture?redirect=false&width=1080&height=1080&access_token=${accessToken}`,
        timeoutMs
      );
      if (picRes.ok) {
        const picData = await picRes.json();
        if (picData?.data?.url) {
          console.log(`Video picture fallback (1080px) for ${adId}`);
          return { thumbnailUrl: picData.data.url, fullResUrl: picData.data.url };
        }
      } else {
        await picRes.text();
      }
    }

    // Strategy 3: effective_object_story_id → full_picture (high-res)
    if (creative.id) {
      const creativeRes = await fetchWithTimeout(
        `https://graph.facebook.com/${META_API_VERSION}/${creative.id}?fields=effective_object_story_id,image_url&access_token=${accessToken}`,
        timeoutMs
      );
      if (creativeRes.ok) {
        const creativeData = await creativeRes.json();

        // Try image_url from creative endpoint first — this is often full resolution
        if (creativeData.image_url) {
          console.log(`Creative image_url for ${adId}`);
          return { thumbnailUrl: creativeData.image_url, fullResUrl: creativeData.image_url };
        }

        if (creativeData.effective_object_story_id) {
          const postRes = await fetchWithTimeout(
            `https://graph.facebook.com/${META_API_VERSION}/${creativeData.effective_object_story_id}?fields=full_picture&access_token=${accessToken}`,
            timeoutMs
          );
          if (postRes.ok) {
            const postData = await postRes.json();
            if (postData.full_picture) {
              console.log(`Post full_picture for ${adId}`);
              return { thumbnailUrl: postData.full_picture, fullResUrl: postData.full_picture };
            }
          } else {
            await postRes.text();
          }
        }
      } else {
        await creativeRes.text();
      }
    }

    // Strategy 4: Direct fallback fields — image_url is usually full-res
    if (creative.image_url) {
      console.log(`Using image_url for ${adId}`);
      return { thumbnailUrl: creative.image_url, fullResUrl: creative.image_url };
    }

    if (spec) {
      const imageUrl = spec.link_data?.image_url || spec.photo_data?.url || spec.photo_data?.image_url;
      if (imageUrl) return { thumbnailUrl: imageUrl, fullResUrl: imageUrl };
    }

    // Strategy 5: creative.thumbnail_url is last resort (~130px placeholder from Meta)
    if (creative.thumbnail_url) {
      console.log(`LOW-RES FALLBACK for ${adId}: using thumbnail_url (~130px) — all higher-res strategies failed`);
      return { thumbnailUrl: creative.thumbnail_url, fullResUrl: null };
    }

    return null;
  } catch (e) {
    console.log(`Meta API error for ${adId}:`, e);
    return null;
  }
}

/**
 * Fetch ad preview URL from Meta Graph API.
 */
export async function discoverPreviewUrl(
  adId: string,
  accessToken: string,
  timeoutMs = 30_000
): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      `https://graph.facebook.com/${META_API_VERSION}/${adId}/previews?ad_format=DESKTOP_FEED_STANDARD&access_token=${accessToken}`,
      timeoutMs
    );
    if (res.ok) {
      const data = await res.json();
      const preview = data?.data?.[0];
      if (preview?.body) {
        const match = preview.body.match(/src="([^"]+)"/);
        if (match?.[1]) {
          return match[1].replace(/&amp;/g, "&");
        }
      }
    }
    const adRes = await fetchWithTimeout(
      `https://graph.facebook.com/${META_API_VERSION}/${adId}?fields=creative{effective_object_story_id}&access_token=${accessToken}`,
      timeoutMs
    );
    if (adRes.ok) {
      const adData = await adRes.json();
      const storyId = adData?.creative?.effective_object_story_id;
      if (storyId) {
        const parts = storyId.split("_");
        if (parts.length === 2) {
          return `https://www.facebook.com/${parts[0]}/posts/${parts[1]}`;
        }
      }
    }
    return null;
  } catch (e) {
    console.log(`Preview URL error for ${adId}:`, e);
    return null;
  }
}

/**
 * Discover a video source URL from Meta Graph API.
 * Covers all known creative formats (standard, carousel, DPA, Advantage+, whitelisted).
 */
export async function discoverVideoUrl(
  adId: string,
  accessToken: string,
  timeoutMs = 30_000
): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      `https://graph.facebook.com/${META_API_VERSION}/${adId}?fields=creative{id,video_id,object_story_spec,effective_object_story_id,asset_feed_spec}&access_token=${accessToken}`,
      timeoutMs
    );
    if (!res.ok) {
      console.log(`Meta video API failed for ${adId}: ${res.status}`);
      return null;
    }
    const data = await res.json();
    const creative = data?.creative;
    if (!creative) {
      const errCode = data?.error?.code;
      const errMsg = data?.error?.message;
      if (errCode || errMsg) {
        console.log(`Meta video: no creative for ${adId} — error ${errCode}: ${errMsg}`);
      }
      return null;
    }

    const spec = creative.object_story_spec;
    const videoIds: string[] = [];

    // Path 1: top-level video_id
    if (creative.video_id) videoIds.push(creative.video_id);

    // Path 2: standard video_data
    if (spec?.video_data?.video_id) videoIds.push(spec.video_data.video_id);
    if (spec?.video_data?.video_url) return spec.video_data.video_url;

    // Path 3: template / DPA video
    if (spec?.template_data?.video_data?.video_id) {
      videoIds.push(spec.template_data.video_data.video_id);
    }

    // Path 4: carousel child attachments
    const children: any[] = spec?.link_data?.child_attachments || [];
    for (const child of children) {
      if (child?.video_id) videoIds.push(child.video_id);
    }

    // Path 5: asset_feed_spec (Advantage+/dynamic creative)
    const feedVideos: any[] = creative.asset_feed_spec?.videos || [];
    for (const v of feedVideos) {
      if (v?.video_id) videoIds.push(v.video_id);
    }

    // Try fetching source from all collected video_ids
    for (const vid of [...new Set(videoIds)]) {
      const vidRes = await fetchWithTimeout(
        `https://graph.facebook.com/${META_API_VERSION}/${vid}?fields=source&access_token=${accessToken}`,
        timeoutMs
      );
      if (vidRes.ok) {
        const vidData = await vidRes.json();
        if (vidData?.source) {
          console.log(`Got video source from video_id ${vid} for ${adId}`);
          return vidData.source;
        }
      }
    }

    // Path 6: effective_object_story_id → post video
    const storyId = creative.effective_object_story_id;
    if (storyId) {
      const postRes = await fetchWithTimeout(
        `https://graph.facebook.com/${META_API_VERSION}/${storyId}?fields=attachments{media,media_type}&access_token=${accessToken}`,
        timeoutMs
      );
      if (postRes.ok) {
        const postData = await postRes.json();
        const attachments: any[] = postData?.attachments?.data || [];
        for (const att of attachments) {
          const videoId = att?.media?.video?.id;
          if (videoId) {
            const vidRes = await fetchWithTimeout(
              `https://graph.facebook.com/${META_API_VERSION}/${videoId}?fields=source&access_token=${accessToken}`,
              timeoutMs
            );
            if (vidRes.ok) {
              const vidData = await vidRes.json();
              if (vidData?.source) {
                console.log(`Got video via effective_object_story_id for ${adId}`);
                return vidData.source;
              }
            }
          }
        }
      }
    }

    // Path 7: adcreatives endpoint fallback
    if (creative.id) {
      const creativeRes = await fetchWithTimeout(
        `https://graph.facebook.com/${META_API_VERSION}/${creative.id}?fields=video_id,asset_feed_spec&access_token=${accessToken}`,
        timeoutMs
      );
      if (creativeRes.ok) {
        const creativeData = await creativeRes.json();
        const fallbackIds: string[] = [];
        if (creativeData?.video_id) fallbackIds.push(creativeData.video_id);
        const feedVids: any[] = creativeData?.asset_feed_spec?.videos || [];
        for (const v of feedVids) {
          if (v?.video_id) fallbackIds.push(v.video_id);
        }
        for (const vid of [...new Set(fallbackIds)]) {
          if (videoIds.includes(vid)) continue;
          const vidRes = await fetchWithTimeout(
            `https://graph.facebook.com/${META_API_VERSION}/${vid}?fields=source&access_token=${accessToken}`,
            timeoutMs
          );
          if (vidRes.ok) {
            const vidData = await vidRes.json();
            if (vidData?.source) {
              console.log(`Got video via adcreatives fallback for ${adId}`);
              return vidData.source;
            }
          }
        }
      }
    }

    return null;
  } catch (e) {
    console.log(`Meta video API error for ${adId}:`, e);
    return null;
  }
}
