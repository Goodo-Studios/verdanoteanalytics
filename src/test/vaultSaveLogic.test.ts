// save-ad-to-vault US-005 — Vitest unit coverage for the vault-save-creative
// save logic. The edge function (US-002) is Deno/server code; its pure decisions
// are extracted into supabase/functions/_shared/vault-save-logic.ts so they can be
// exercised here with no Deno globals and no live network/DB. Deterministic.
import { describe, it, expect, vi } from "vitest";
import {
  SENTINELS,
  buildPerformanceSnapshot,
  buildRecoveryRequest,
  cleanUrl,
  dedupeDecision,
  extFor,
  isDurableStorageUrl,
  isMediaContentType,
  needsMediaRecovery,
  normalizeVaultPlatform,
  selectMediaSources,
} from "../../supabase/functions/_shared/vault-save-logic.ts";

// ─── Sentinel filtering ('no-thumbnail' / 'no-video') ───────────────────────
describe("sentinel filtering (cleanUrl)", () => {
  it("treats the analytics sentinels as absent media", () => {
    expect(SENTINELS.has("no-thumbnail")).toBe(true);
    expect(SENTINELS.has("no-video")).toBe(true);
    expect(cleanUrl("no-thumbnail")).toBeNull();
    expect(cleanUrl("no-video")).toBeNull();
  });

  it("filters sentinels even with surrounding whitespace", () => {
    expect(cleanUrl("  no-thumbnail  ")).toBeNull();
    expect(cleanUrl("\tno-video\n")).toBeNull();
  });

  it("returns a real media URL untouched (trimmed)", () => {
    expect(cleanUrl("https://cdn.example.com/ad.mp4")).toBe(
      "https://cdn.example.com/ad.mp4",
    );
    expect(cleanUrl("  https://cdn.example.com/t.jpg  ")).toBe(
      "https://cdn.example.com/t.jpg",
    );
  });

  it("returns null for empty/whitespace/non-string inputs", () => {
    expect(cleanUrl("")).toBeNull();
    expect(cleanUrl("   ")).toBeNull();
    expect(cleanUrl(null)).toBeNull();
    expect(cleanUrl(undefined)).toBeNull();
    expect(cleanUrl(42)).toBeNull();
    expect(cleanUrl({})).toBeNull();
  });

  it("a fully-sentinel payload yields no usable media (all null)", () => {
    const fullRes = cleanUrl("no-video");
    const video = cleanUrl("no-video");
    const thumb = cleanUrl("no-thumbnail");
    expect(fullRes ?? video).toBeNull();
    expect(thumb).toBeNull();
  });
});

describe("extFor (storage extension selection)", () => {
  it("maps video content-types", () => {
    expect(extFor("video/webm", "video")).toBe("webm");
    expect(extFor("video/quicktime", "video")).toBe("mov");
    expect(extFor("video/mp4", "video")).toBe("mp4");
    expect(extFor("application/octet-stream", "video")).toBe("mp4");
  });

  it("maps image content-types", () => {
    expect(extFor("image/png", "image")).toBe("png");
    expect(extFor("image/webp", "image")).toBe("webp");
    expect(extFor("image/gif", "image")).toBe("gif");
    expect(extFor("image/jpeg", "image")).toBe("jpg");
  });
});

// ─── Media-source selection (video vs still image) ──────────────────────────
//
// Regression: a save previously copied `full_res_url ?? video_url` as the VIDEO.
// full_res_url is a full-resolution IMAGE (rendered as <img> in the analytics UI),
// so when it was a facebook.com page URL the copy stored ~151KB of HTML as
// media.mp4 → an unplayable vault item. video_url must be the only video source.
describe("selectMediaSources (video vs still image)", () => {
  it("uses video_url as the video source — never full_res_url", () => {
    const { videoSrc, imageSrc } = selectMediaSources({
      full_res_url: "https://www.facebook.com/ads/library/?id=123", // page/img URL
      video_url: "https://cdn.example.com/real.mp4",
      thumbnail_url: "https://cdn.example.com/thumb.jpg",
    });
    expect(videoSrc).toBe("https://cdn.example.com/real.mp4");
    // full_res_url is the still image, NOT the video
    expect(imageSrc).toBe("https://www.facebook.com/ads/library/?id=123");
  });

  it("prefers full_res_url for the still, falling back to thumbnail_url", () => {
    expect(
      selectMediaSources({ full_res_url: "https://cdn/x.jpg", thumbnail_url: "https://cdn/t.jpg" }).imageSrc,
    ).toBe("https://cdn/x.jpg");
    expect(
      selectMediaSources({ thumbnail_url: "https://cdn/t.jpg" }).imageSrc,
    ).toBe("https://cdn/t.jpg");
  });

  it("has no video source for an image-only creative", () => {
    const { videoSrc, imageSrc } = selectMediaSources({
      full_res_url: "https://cdn/x.jpg",
      video_url: "no-video",
    });
    expect(videoSrc).toBeNull();
    expect(imageSrc).toBe("https://cdn/x.jpg");
  });

  it("filters sentinels / blanks from every slot", () => {
    expect(
      selectMediaSources({ full_res_url: "no-thumbnail", video_url: "no-video", thumbnail_url: "" }),
    ).toEqual({ videoSrc: null, imageSrc: null });
  });
});

// ─── Server-side media recovery gate (US-004 "Saved 0, 1 failed" bulk-save fix) ─
//
// Regression: the Creatives-page bulk save passed RAW `creatives` rows whose
// video_url / thumbnail_url were expired Meta CDN links, ad-page URLs, or nulls —
// none downloadable by copyMedia — so every grid save failed. vault-save-creative
// now recovers durable media via cache-creative-image first, gated by this
// predicate. A save is "settled" only when a slot is a durable Supabase Storage
// URL or a confirmed-absent sentinel; anything else triggers recovery.
describe("isDurableStorageUrl (durable Supabase Storage URL detection)", () => {
  it("recognizes a public Supabase Storage object URL", () => {
    expect(
      isDurableStorageUrl(
        "https://x.supabase.co/storage/v1/object/public/ad-videos/acc/ad.mp4",
      ),
    ).toBe(true);
  });

  it("rejects raw CDN links, ad-page URLs, sentinels, blanks, and non-strings", () => {
    expect(isDurableStorageUrl("https://video.fbcdn.net/v/abc.mp4")).toBe(false);
    expect(isDurableStorageUrl("https://www.facebook.com/ads/library/?id=1")).toBe(false);
    expect(isDurableStorageUrl("no-video")).toBe(false);
    expect(isDurableStorageUrl("")).toBe(false);
    expect(isDurableStorageUrl(null)).toBe(false);
    expect(isDurableStorageUrl(undefined)).toBe(false);
    expect(isDurableStorageUrl(42)).toBe(false);
  });
});

describe("needsMediaRecovery (gate the cache-creative-image recovery)", () => {
  const storageVideo =
    "https://x.supabase.co/storage/v1/object/public/ad-videos/acc/ad.mp4";
  const storageImage =
    "https://x.supabase.co/storage/v1/object/public/ad-thumbnails/acc/ad.jpg";

  it("needs recovery for raw CDN media (the bulk-save failure case)", () => {
    expect(
      needsMediaRecovery({
        video_url: "https://video.fbcdn.net/v/abc.mp4", // expired CDN — not downloadable
        thumbnail_url: "https://scontent.fbcdn.net/t.jpg",
      }),
    ).toBe(true);
  });

  it("needs recovery for null / blank / missing media", () => {
    expect(needsMediaRecovery({ video_url: null, thumbnail_url: null })).toBe(true);
    expect(needsMediaRecovery({})).toBe(true);
    expect(needsMediaRecovery({ video_url: "", thumbnail_url: "" })).toBe(true);
  });

  it("needs recovery when only ONE slot is settled (the other is unsettled)", () => {
    expect(
      needsMediaRecovery({ video_url: storageVideo, thumbnail_url: null }),
    ).toBe(true);
    expect(
      needsMediaRecovery({
        video_url: "no-video",
        thumbnail_url: "https://scontent.fbcdn.net/t.jpg",
      }),
    ).toBe(true);
  });

  it("skips recovery when BOTH slots are durable storage URLs", () => {
    expect(
      needsMediaRecovery({ video_url: storageVideo, thumbnail_url: storageImage }),
    ).toBe(false);
  });

  it("skips recovery when both slots are settled via sentinel (confirmed absent)", () => {
    expect(
      needsMediaRecovery({ video_url: "no-video", thumbnail_url: "no-thumbnail" }),
    ).toBe(false);
    // mixed durable + sentinel is also fully settled
    expect(
      needsMediaRecovery({ video_url: storageVideo, thumbnail_url: "no-thumbnail" }),
    ).toBe(false);
  });

  it("settles a sentinel even with surrounding whitespace", () => {
    expect(
      needsMediaRecovery({ video_url: "  no-video  ", thumbnail_url: storageImage }),
    ).toBe(false);
  });
});

describe("isMediaContentType (reject page/HTML stored as media)", () => {
  it("rejects an HTML page passed as video (the won't-play regression)", () => {
    expect(isMediaContentType("text/html; charset=utf-8", "video")).toBe(false);
    expect(isMediaContentType("text/plain", "video")).toBe(false);
  });

  it("accepts real media content-types for their kind", () => {
    expect(isMediaContentType("video/mp4", "video")).toBe(true);
    expect(isMediaContentType("video/quicktime", "video")).toBe(true);
    expect(isMediaContentType("image/jpeg", "image")).toBe(true);
    expect(isMediaContentType("image/webp", "image")).toBe(true);
  });

  it("allows application/octet-stream (CDNs serve media generically)", () => {
    expect(isMediaContentType("application/octet-stream", "video")).toBe(true);
    expect(isMediaContentType("application/octet-stream", "image")).toBe(true);
  });

  it("does not accept an image type for a video copy (kind mismatch)", () => {
    expect(isMediaContentType("image/png", "video")).toBe(false);
    expect(isMediaContentType("video/mp4", "image")).toBe(false);
  });

  it("rejects missing / non-string content-types", () => {
    expect(isMediaContentType(null, "video")).toBe(false);
    expect(isMediaContentType(undefined, "image")).toBe(false);
    expect(isMediaContentType("", "video")).toBe(false);
    expect(isMediaContentType(42, "image")).toBe(false);
  });
});

// ─── Platform normalization (analytics creative → vault platform key) ───────
//
// Regression: a saved analytics creative was stored with platform
// "analytics_creative", which is NOT in the vault UI's PLATFORM_LABELS, so the
// card rendered an "Unknown" badge. Verdanote analytics creatives are Meta ads,
// so any unknown/missing platform must default to "facebook_ad" ("Meta Ad").
describe("normalizeVaultPlatform (analytics → vault platform key)", () => {
  it("passes through platform keys the vault UI already labels", () => {
    for (const k of ["tiktok", "instagram", "youtube", "twitter", "facebook_ad", "upload"]) {
      expect(normalizeVaultPlatform(k)).toBe(k);
    }
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(normalizeVaultPlatform("  TikTok  ")).toBe("tiktok");
    expect(normalizeVaultPlatform("INSTAGRAM")).toBe("instagram");
  });

  it("maps Meta aliases to facebook_ad", () => {
    for (const a of ["facebook", "meta", "fb", "meta_ad", "Meta", "FB"]) {
      expect(normalizeVaultPlatform(a)).toBe("facebook_ad");
    }
  });

  it("defaults unknown / missing / non-string to facebook_ad (never 'Unknown')", () => {
    // 'analytics_creative' was the exact value that rendered as 'Unknown'.
    expect(normalizeVaultPlatform("analytics_creative")).toBe("facebook_ad");
    expect(normalizeVaultPlatform("some_other_source")).toBe("facebook_ad");
    expect(normalizeVaultPlatform("")).toBe("facebook_ad");
    expect(normalizeVaultPlatform(null)).toBe("facebook_ad");
    expect(normalizeVaultPlatform(undefined)).toBe("facebook_ad");
    expect(normalizeVaultPlatform(42)).toBe("facebook_ad");
  });
});

// ─── Performance-snapshot shaping from a creatives row ──────────────────────
describe("buildPerformanceSnapshot (shaping from a creatives row)", () => {
  it("captures the headline metrics + retention curve from a full row", () => {
    const row = {
      ad_id: "ad-1",
      ad_name: "Winner",
      spend: 1234.56,
      roas: 3.2,
      cpa: 12.5,
      thumb_stop_rate: 0.41,
      hold_rate: 0.18,
      retention_p25: 0.8,
      retention_p50: 0.55,
      retention_p75: 0.3,
      retention_p100: 0.12,
      play_curve: [100, 80, 55, 30, 12],
      // non-snapshot fields must be ignored
      ai_analysis: "long text",
      thumbnail_url: "https://cdn.example.com/t.jpg",
    };
    const snap = buildPerformanceSnapshot(row);
    expect(snap).toMatchObject({
      spend: 1234.56,
      roas: 3.2,
      cpa: 12.5,
      thumb_stop_rate: 0.41,
      hold_rate: 0.18,
      retention_p25: 0.8,
      retention_p50: 0.55,
      retention_p75: 0.3,
      retention_p100: 0.12,
      play_curve: [100, 80, 55, 30, 12],
    });
    // non-metric fields are not carried into the snapshot
    expect("ai_analysis" in snap).toBe(false);
    expect("thumbnail_url" in snap).toBe(false);
    expect("ad_name" in snap).toBe(false);
  });

  it("drops null/undefined/NaN metrics rather than coercing to 0", () => {
    const row = {
      spend: 500,
      roas: null,
      cpa: undefined,
      thumb_stop_rate: Number.NaN,
      hold_rate: 0, // a real zero IS captured
    };
    const snap = buildPerformanceSnapshot(row as never);
    expect(snap.spend).toBe(500);
    expect(snap.hold_rate).toBe(0);
    expect("roas" in snap).toBe(false);
    expect("cpa" in snap).toBe(false);
    expect("thumb_stop_rate" in snap).toBe(false);
  });

  it("returns an empty object for a null/empty row", () => {
    expect(buildPerformanceSnapshot(null)).toEqual({});
    expect(buildPerformanceSnapshot(undefined)).toEqual({});
    expect(buildPerformanceSnapshot({})).toEqual({});
  });

  it("omits play_curve when absent but keeps it when null-distinct", () => {
    expect("play_curve" in buildPerformanceSnapshot({ spend: 10 })).toBe(false);
    const withNull = buildPerformanceSnapshot({ spend: 10, play_curve: null });
    expect("play_curve" in withNull).toBe(false);
    const withCurve = buildPerformanceSnapshot({ spend: 10, play_curve: { p: 1 } });
    expect(withCurve.play_curve).toEqual({ p: 1 });
  });
});

// ─── Dedupe-by-ad_id decision against the GLOBAL library ────────────────────
describe("dedupeDecision (dedupe by source ad_id)", () => {
  it("short-circuits when an existing item is found (already saved)", () => {
    const d = dedupeDecision({ id: "existing-item-123" });
    expect(d.alreadySaved).toBe(true);
    expect(d.itemId).toBe("existing-item-123");
  });

  it("proceeds to insert when no existing item is found", () => {
    expect(dedupeDecision(null)).toEqual({ alreadySaved: false, itemId: null });
    expect(dedupeDecision(undefined)).toEqual({ alreadySaved: false, itemId: null });
  });

  it("treats a row missing an id as no-match (proceed to insert)", () => {
    const d = dedupeDecision({} as never);
    expect(d.alreadySaved).toBe(false);
    expect(d.itemId).toBeNull();
  });
});

// ─── Best-effort analyze contract: analyze failure must NOT fail the save ───
//
// The edge function commits the item, then fires vault-analyze fire-and-forget
// inside EdgeRuntime.waitUntil(...), catching any rejection. This models that
// contract: the save resolves successfully even when the analyze call rejects.
describe("best-effort analyze contract", () => {
  // Mirror of the edge-fn save path's tail: the item is already committed; the
  // analyze chain is fired and its failure is swallowed (non-fatal).
  async function saveThenBestEffortAnalyze(
    itemId: string,
    analyze: () => Promise<unknown>,
  ): Promise<{ ok: true; item_id: string; already_saved: false }> {
    // analyze runs best-effort; a rejection is caught and never propagated.
    void Promise.resolve()
      .then(analyze)
      .catch((e) => {
        // mirrors console.error("vault-analyze chain failed (non-fatal):", e)
        void e;
      });
    return { ok: true, item_id: itemId, already_saved: false };
  }

  it("save succeeds even when vault-analyze rejects", async () => {
    const analyze = vi.fn().mockRejectedValue(new Error("vault-analyze 500"));
    const result = await saveThenBestEffortAnalyze("item-abc", analyze);
    expect(result).toEqual({ ok: true, item_id: "item-abc", already_saved: false });
    // analyze was attempted (fire-and-forget) but its failure didn't surface.
    await Promise.resolve();
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it("save succeeds when vault-analyze succeeds (happy path)", async () => {
    const analyze = vi.fn().mockResolvedValue({ ok: true });
    const result = await saveThenBestEffortAnalyze("item-xyz", analyze);
    expect(result.ok).toBe(true);
    expect(result.item_id).toBe("item-xyz");
  });

  it("a rejected analyze promise does not throw out of the save path", async () => {
    const analyze = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(saveThenBestEffortAnalyze("item-1", analyze)).resolves.toBeTruthy();
  });
});

// ─── cache-creative-image recovery request ("Saved 0, 1 failed" — 401 regression) ─
//
// Root bug: vault-save-creative recovered durable media by calling
// cache-creative-image with `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}`.
// After Supabase's API-key migration that env is the opaque `sb_secret_` format —
// supabase-js / PostgREST accept it, but cache-creative-image runs with
// verify_jwt=true and the Edge Function gateway validates only real JWTs, so it
// rejected the sb_secret bearer with HTTP 401. Recovery silently failed, no durable
// URL was applied, and every save with unsettled media fell through to 422
// "No usable creative media to copy". The fix forwards the CALLER's user JWT (a
// real JWT the gateway accepts), never the service-role / sb_secret key. These
// tests pin that so a service-role bearer can't sneak back in.
describe("buildRecoveryRequest (forward the caller JWT, never the service key)", () => {
  const supabaseUrl = "https://gwyxaqoaldnaavkjqquv.supabase.co";
  const callerJwt = "Bearer eyJhbGciOiJIUzI1Ni.user-access-token.signature";
  const req = buildRecoveryRequest({
    supabaseUrl,
    callerAuthHeader: callerJwt,
    ad_id: "120239121592170248",
    account_id: "act_2223094124606317",
  });

  it("targets the cache-creative-image function endpoint", () => {
    expect(req.url).toBe(`${supabaseUrl}/functions/v1/cache-creative-image`);
  });

  it("forwards the caller's user JWT verbatim as the Authorization header", () => {
    expect(req.headers.Authorization).toBe(callerJwt);
  });

  it("NEVER sends the service-role / sb_secret key (the 401 root cause)", () => {
    const sbSecret = "sb_secret_aBcD1234efGh5678ijKl9012";
    const legacyServiceRole = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service_role.sig";
    expect(req.headers.Authorization).not.toContain("sb_secret_");
    expect(req.headers.Authorization).not.toContain(sbSecret);
    expect(req.headers.Authorization).not.toContain("service_role");
    expect(req.headers.Authorization).not.toBe(`Bearer ${sbSecret}`);
    expect(req.headers.Authorization).not.toBe(`Bearer ${legacyServiceRole}`);
  });

  it("sends JSON content with the ad_id + account_id body", () => {
    expect(req.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(req.body)).toEqual({
      ad_id: "120239121592170248",
      account_id: "act_2223094124606317",
    });
  });
});
