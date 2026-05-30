// save-ad-to-vault US-005 — Vitest unit coverage for the vault-save-creative
// save logic. The edge function (US-002) is Deno/server code; its pure decisions
// are extracted into supabase/functions/_shared/vault-save-logic.ts so they can be
// exercised here with no Deno globals and no live network/DB. Deterministic.
import { describe, it, expect, vi } from "vitest";
import {
  SENTINELS,
  cleanUrl,
  extFor,
  buildPerformanceSnapshot,
  dedupeDecision,
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
