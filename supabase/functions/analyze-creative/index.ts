// analyze-creative — Creative Intelligence WS1 (US-002 + US-003).
//
// Analyzes ONE account creative the same way the Creative Vault analyzes a saved
// item — same prompts, same OUTPUT shape (transcript + framework + hooks + script/
// visual analysis) — so moving a live creative into the Vault is a data copy, not
// a re-analysis (US-013). The ONLY difference from the vault is model routing:
// the LLM/vision calls go through cheap OpenRouter models (US-000 lock) instead of
// Claude direct. Transcription stays on Groq Whisper. Embeddings stay on
// openai/text-embedding-3-small @ 512d.
//
// The queue is creatives.analysis_status itself (no separate table): 'pending'
// rows are claimed spend-first in batches (FOR UPDATE SKIP LOCKED via
// claim_creatives_for_analysis), analyzed, then marked 'done'. The function
// self-chains a fresh invocation while 'pending' rows remain and the per-account
// $ cap (creative_analysis_spend) is not hit — mirrors drain-media-queue.
//
// Auth model: internal / service-role only (verify_jwt = false). Poked manually
// with { account_id } for the builder-account-first rollout, or by pg_cron once
// rollout widens (US-012). NOT linked from any client.
//
// Body (all optional except account_id):
//   { account_id: string, limit?: number, force?: boolean, chain?: number }
//     • account_id — REQUIRED. Restrict to one account (builder-first + spend safety).
//     • limit      — creatives claimed per invocation (default 25, max 100).
//     • force      — re-analyze creatives already 'done' (bounded by limit).
//     • chain      — internal self-chain depth (do not set by hand).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "../_shared/cors.ts";
import { parseLooseJson } from "../_shared/vault-analyze-logic.ts";
import { NO_VIDEO_SENTINEL } from "../_shared/media-discovery.ts";
import {
  BRAND_METADATA_PROMPT,
  CLEAN_TRANSCRIPT_PROMPT,
  FRAME_ANALYSIS_SYSTEM,
  frameAnalysisUserText,
  FRAMEWORK_PROMPT,
  IMAGE_ANALYSIS_PROMPT,
  SCRIPT_ANALYSIS_PROMPT,
  VISUAL_ANALYSIS_PROMPT,
} from "../_shared/creative-analysis-prompts.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const GROQ_KEY = Deno.env.get("GROQ_API_KEY")!;

// US-000 locked model mix (2026-07-16). Refresh prices if models change.
const VISION_MODEL = "google/gemini-2.5-flash-lite";
const TEXT_MODEL = "openai/gpt-oss-120b";
const EMBED_MODEL = "openai/text-embedding-3-small";

// Per-token USD prices for the locked models (from OpenRouter, US-000 snapshot).
// Used to charge the per-account budget ledger from real token usage.
const PRICES: Record<string, { in: number; out: number; img: number }> = {
  "google/gemini-2.5-flash-lite": { in: 0.10e-6, out: 0.40e-6, img: 0.0000001 },
  "openai/gpt-oss-120b": { in: 0.037e-6, out: 0.17e-6, img: 0 },
  "openai/text-embedding-3-small": { in: 0.02e-6, out: 0, img: 0 },
};
const WHISPER_FLAT_USD = 0.0004; // ~30s @ $0.04/hr; flat estimate per transcription

const BATCH_DEFAULT = 25;
const BATCH_MAX = 100;
const MAX_CHAIN = 200; // safety bound on self-chain depth
const FRAME_LIMIT = 8;

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ── OpenRouter chat/vision call. Returns text + the USD cost from real usage. ──
async function orChat(
  model: string,
  system: string,
  userContent: unknown,
  maxTokens: number,
  imageCount = 0,
): Promise<{ text: string; costUsd: number }> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
      "X-Title": "Verdanote",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter ${model} error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const text: string = data?.choices?.[0]?.message?.content ?? "";
  const p = PRICES[model] ?? { in: 0, out: 0, img: 0 };
  const usage = data?.usage ?? {};
  const inTok = Number(usage.prompt_tokens ?? 0);
  const outTok = Number(usage.completion_tokens ?? 0);
  const costUsd = inTok * p.in + outTok * p.out + imageCount * p.img;
  return { text, costUsd };
}

// ── OpenRouter embedding (mirrors creative-embed / vault-embed). ──
async function embed(text: string): Promise<{ vec: number[]; costUsd: number }> {
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
      "X-Title": "Verdanote",
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 8000), dimensions: 512 }),
  });
  if (!res.ok) throw new Error(`Embedding error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const usage = data?.usage ?? {};
  const inTok = Number(usage.prompt_tokens ?? usage.total_tokens ?? 0);
  const costUsd = inTok * (PRICES[EMBED_MODEL]?.in ?? 0);
  return { vec: data.data[0].embedding as number[], costUsd };
}

// ── Fetch an image URL as a base64 data-URL for a vision call (verbatim from
//    vault-analyze). Returns null on any failure so callers degrade gracefully. ──
async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) return null;
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return `data:${contentType};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

// ── Groq Whisper transcription of a cached video URL. Skips gracefully (returns
//    null) on oversized / no-audio, mirroring vault-transcribe's short-circuits. ──
async function transcribe(videoUrl: string): Promise<{ text: string | null; costUsd: number }> {
  try {
    const vres = await fetch(videoUrl);
    if (!vres.ok) return { text: null, costUsd: 0 };
    const bytes = new Uint8Array(await vres.arrayBuffer());
    const ext = videoUrl.toLowerCase().includes(".webm") ? "webm" : "mp4";
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: `video/${ext}` }), `video.${ext}`);
    form.append("model", "whisper-large-v3-turbo");
    const gres = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GROQ_KEY}` },
      body: form,
    });
    if (!gres.ok) {
      // 413 (too large) / 400 (no audio track / could not process) → skip, not fail.
      return { text: null, costUsd: 0 };
    }
    const gdata = await gres.json();
    return { text: (gdata.text ?? "").trim() || null, costUsd: WHISPER_FLAT_USD };
  } catch {
    return { text: null, costUsd: 0 };
  }
}

interface CreativeRow {
  ad_id: string;
  account_id: string;
  transcript: string | null;
  thumbnail_url: string | null;
  full_res_url: string | null;
  video_url: string | null;
}

interface TagSuggestion {
  value: string;
  confidence: number;
  signal: "script" | "visual" | "destination";
}

// Build the review-gated tag_suggestions blob from the analysis outputs.
function buildTagSuggestions(
  fw: Record<string, unknown>,
  brand: Record<string, unknown>,
  fromVision: boolean,
): Record<string, TagSuggestion> {
  const out: Record<string, TagSuggestion> = {};
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const put = (dim: string, value: string | null, confidence: number, signal: TagSuggestion["signal"]) => {
    if (value) out[dim] = { value, confidence, signal };
  };
  const adFormat = str(brand.ad_format);
  put("ad_type", adFormat, 0.6, fromVision ? "visual" : "script");
  put("style", adFormat, 0.5, fromVision ? "visual" : "script");
  put("product", str(brand.brand_name), 0.5, "script");
  put("hook", str(fw.hook_type), 0.7, "script");
  put("theme", str(brand.industry), 0.5, "script");
  put("angle", str(fw.value_structure), 0.5, "script");
  return out;
}

// Analyze one claimed creative. Returns the columns to write + the USD spent.
async function analyzeOne(c: CreativeRow): Promise<{ update: Record<string, unknown>; costUsd: number }> {
  let cost = 0;
  // Respect the media sentinels: video_url can be the "no-video" sentinel (an
  // image ad or an uncached video) and thumbnail_url can be "no-thumbnail". A
  // real video is a cached, non-sentinel video_url; anything else = image branch.
  const NO_THUMB_SENTINEL = "no-thumbnail";
  const rawThumb = c.full_res_url || c.thumbnail_url;
  const thumb = rawThumb && rawThumb !== NO_THUMB_SENTINEL ? rawThumb : null;
  const hasVideo = !!c.video_url && c.video_url !== NO_VIDEO_SENTINEL;

  // ── STATIC IMAGE branch: no video → single vision call (framework + metadata
  //    + visual + copy analysis together). ──
  if (!hasVideo) {
    let visualNotes = "";
    const fw: Record<string, unknown> = {};
    const brand: Record<string, unknown> = {};
    if (thumb) {
      const dataUrl = await fetchImageAsDataUrl(thumb);
      if (dataUrl) {
        const { text, costUsd } = await orChat(
          VISION_MODEL,
          IMAGE_ANALYSIS_PROMPT,
          [{ type: "image_url", image_url: { url: dataUrl, detail: "low" } }],
          2048,
          1,
        );
        cost += costUsd;
        const parsed = parseLooseJson(text);
        Object.assign(fw, parsed);
        Object.assign(brand, parsed);
        visualNotes = (parsed.visual_analysis as string) ?? "";
      }
    }
    const hookAnalysis = [fw.hook_text, fw.hook_type, fw.hook_formula].filter(Boolean).join(" | ");
    return {
      update: {
        ai_analysis: (fw.copy_analysis as string) ?? null,
        ai_hook_analysis: hookAnalysis || null,
        ai_cta_notes: [fw.cta_type, fw.cta_formula].filter(Boolean).join(" | ") || null,
        ai_visual_notes: visualNotes || null,
        tag_suggestions: buildTagSuggestions(fw, brand, true),
        analysis_status: "done",
        analyzed_at: new Date().toISOString(),
        _script_text: null,
        _visual_text: visualNotes,
      },
      costUsd: cost,
    };
  }

  // ── VIDEO branch: transcribe → clean → framework(vision) → brand/script/visual
  //    → frame vision. ──
  let raw = c.transcript;
  if (!raw && c.video_url) {
    const t = await transcribe(c.video_url);
    cost += t.costUsd;
    raw = t.text;
  }

  let cleaned = "";
  if (raw) {
    const { text, costUsd } = await orChat(TEXT_MODEL, CLEAN_TRANSCRIPT_PROMPT, raw, 2048);
    cost += costUsd;
    cleaned = text.trim();
  }

  // Framework (vision + script + thumbnail).
  const fw: Record<string, unknown> = {};
  {
    const dataUrl = thumb ? await fetchImageAsDataUrl(thumb) : null;
    const userContent: unknown = dataUrl
      ? [
        { type: "text", text: `Cleaned script:\n${cleaned}` },
        { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
      ]
      : `Cleaned script:\n${cleaned}`;
    const { text, costUsd } = await orChat(
      VISION_MODEL,
      FRAMEWORK_PROMPT,
      userContent,
      2048,
      dataUrl ? 1 : 0,
    );
    cost += costUsd;
    Object.assign(fw, parseLooseJson(text));
  }

  // Brand metadata + script analysis + visual (script-inferred) analysis.
  const [brandR, scriptR, visualR] = await Promise.all([
    orChat(TEXT_MODEL, BRAND_METADATA_PROMPT, cleaned, 1024),
    orChat(TEXT_MODEL, SCRIPT_ANALYSIS_PROMPT, cleaned, 1024),
    orChat(TEXT_MODEL, VISUAL_ANALYSIS_PROMPT, cleaned, 512),
  ]);
  cost += brandR.costUsd + scriptR.costUsd + visualR.costUsd;
  const brand = parseLooseJson(brandR.text);

  // Frame vision → ai_visual_notes (preferred over the script-only inference).
  // Resolve cached frame image URLs in two steps (creative_frames.asset_id →
  // media_assets.public_url) to avoid a PostgREST embed on an unknown FK name.
  let visualNotes = visualR.text.trim();
  const { data: frameAssetRows } = await db
    .from("creative_frames")
    .select("asset_id")
    .eq("ad_id", c.ad_id)
    .order("frame_index", { ascending: true })
    .limit(FRAME_LIMIT);
  const assetIds = (frameAssetRows ?? [])
    .map((r: { asset_id: string | null }) => r.asset_id)
    .filter((id: unknown): id is string => typeof id === "string");
  let frameUrls: string[] = [];
  if (assetIds.length) {
    const { data: assets } = await db
      .from("media_assets")
      .select("id, public_url")
      .in("id", assetIds);
    const byId = new Map((assets ?? []).map((a: { id: string; public_url: string }) => [a.id, a.public_url]));
    frameUrls = assetIds
      .map((id) => byId.get(id))
      .filter((u): u is string => typeof u === "string");
  }
  if (frameUrls.length) {
    const dataUrls = (await Promise.all(frameUrls.map(fetchImageAsDataUrl))).filter(
      (d): d is string => !!d,
    );
    if (dataUrls.length) {
      const ts = dataUrls.map((_, i) => `${i}s`).join(", ");
      const content: unknown[] = [
        { type: "text", text: frameAnalysisUserText(dataUrls.length, ts) },
        ...dataUrls.map((url) => ({ type: "image_url", image_url: { url, detail: "low" } })),
      ];
      const { text, costUsd } = await orChat(VISION_MODEL, FRAME_ANALYSIS_SYSTEM, content, 1024, dataUrls.length);
      cost += costUsd;
      const parsedFrames = parseLooseJson(text) as unknown;
      const arr = Array.isArray(parsedFrames)
        ? parsedFrames
        : (parsedFrames as { frames?: unknown[] })?.frames;
      if (Array.isArray(arr)) {
        visualNotes = arr.map((f: { description?: string }) => f.description).filter(Boolean).join(" ");
      }
    }
  }

  const hookAnalysis = [fw.hook_verbal, fw.hook_text, fw.hook_type, fw.hook_formula]
    .filter(Boolean)
    .join(" | ");

  return {
    update: {
      transcript: cleaned || raw || null,
      transcript_status: cleaned || raw ? "ready" : "none",
      ai_analysis: scriptR.text.trim() || null,
      ai_hook_analysis: hookAnalysis || null,
      ai_cta_notes: [fw.cta_type, fw.cta_formula].filter(Boolean).join(" | ") || null,
      ai_visual_notes: visualNotes || null,
      tag_suggestions: buildTagSuggestions(fw, brand, frameUrls.length > 0),
      analysis_status: "done",
      analyzed_at: new Date().toISOString(),
      _script_text: cleaned || raw,
      _visual_text: visualNotes,
    },
    costUsd: cost,
  };
}

// US-003: multi-modal embeddings — visual-description text + script text.
async function embedCreative(
  c: CreativeRow,
  scriptText: string | null,
  visualText: string | null,
): Promise<number> {
  let cost = 0;
  const payload: Record<string, unknown> = {
    ad_id: c.ad_id,
    account_id: c.account_id,
    model: EMBED_MODEL,
    updated_at: new Date().toISOString(),
  };
  if (visualText && visualText.trim()) {
    const { vec, costUsd } = await embed(visualText);
    payload.visual_embedding = vec;
    cost += costUsd;
  }
  if (scriptText && scriptText.trim()) {
    const { vec, costUsd } = await embed(scriptText);
    payload.script_embedding = vec;
    cost += costUsd;
  }
  if (payload.visual_embedding || payload.script_embedding) {
    await db.from("creative_embeddings").upsert(payload, { onConflict: "ad_id" });
  }
  return cost;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}));
  const accountId: string | undefined = body.account_id;
  if (!accountId) return json({ error: "account_id required" }, 400);
  const limit = Math.min(Math.max(Number(body.limit) || BATCH_DEFAULT, 1), BATCH_MAX);
  const force: boolean = body.force === true;
  // no_chain: process a single bounded batch and stop (controlled validation runs).
  const noChain: boolean = body.no_chain === true;
  const chainDepth = Number(body.chain ?? url.searchParams.get("chain") ?? 0);

  // Budget gate: stop before doing any work if the account is already at its cap.
  const { data: ledger } = await db
    .from("creative_analysis_spend")
    .select("spent_usd, cap_usd")
    .eq("account_id", accountId)
    .maybeSingle();
  const cap = Number(ledger?.cap_usd ?? 10);
  let spent = Number(ledger?.spent_usd ?? 0);
  if (spent >= cap) {
    return json({ ok: true, capped: true, account_id: accountId, spent_usd: spent, cap_usd: cap, analyzed: 0 });
  }

  // force: re-queue up to `limit` already-done creatives back to 'pending' first.
  if (force) {
    const { data: doneRows } = await db
      .from("creatives")
      .select("ad_id")
      .eq("account_id", accountId)
      .in("analysis_status", ["done", "analyzed", "failed", "skipped"])
      .limit(limit);
    const ids = (doneRows ?? []).map((r: { ad_id: string }) => r.ad_id);
    if (ids.length) {
      await db.from("creatives").update({ analysis_status: "pending" }).in("ad_id", ids);
    }
  }

  // Claim a spend-first batch (atomic, SKIP LOCKED). Marks them 'analyzing'.
  const { data: claimed, error: claimErr } = await db.rpc("claim_creatives_for_analysis", {
    p_account_id: accountId,
    p_limit: limit,
  });
  if (claimErr) return json({ error: claimErr.message }, 500);
  const batch: CreativeRow[] = (claimed ?? []) as CreativeRow[];

  let analyzed = 0;
  let failed = 0;
  let cappedMid = false;
  const errors: string[] = [];
  const unprocessed: string[] = [];

  for (let i = 0; i < batch.length; i++) {
    const c = batch[i];
    if (spent >= cap) {
      // Budget hit mid-batch: release the rest back to 'pending' and stop.
      cappedMid = true;
      unprocessed.push(...batch.slice(i).map((r) => r.ad_id));
      break;
    }
    try {
      const { update, costUsd } = await analyzeOne(c);
      const scriptText = update._script_text as string | null;
      const visualText = update._visual_text as string | null;
      delete update._script_text;
      delete update._visual_text;

      const { error: upErr } = await db.from("creatives").update(update).eq("ad_id", c.ad_id);
      if (upErr) throw new Error(upErr.message);

      const embedCost = await embedCreative(c, scriptText, visualText);
      const total = costUsd + embedCost;
      const { data: newTotal } = await db.rpc("add_creative_analysis_spend", {
        p_account_id: accountId,
        p_usd: total,
      });
      spent = Number(newTotal ?? spent + total);
      analyzed++;
    } catch (e) {
      failed++;
      errors.push(`${c.ad_id}: ${e instanceof Error ? e.message : String(e)}`);
      await db.from("creatives").update({ analysis_status: "failed" }).eq("ad_id", c.ad_id);
    }
  }

  if (unprocessed.length) {
    await db.from("creatives").update({ analysis_status: "pending" }).in("ad_id", unprocessed);
  }

  // Remaining pending for this account (drives the self-chain decision).
  const { count: pending } = await db
    .from("creatives")
    .select("ad_id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("analysis_status", "pending");

  // US-003: surface embedding coverage % (visual + script) for this account.
  const { count: totalCreatives } = await db
    .from("creatives")
    .select("ad_id", { count: "exact", head: true })
    .eq("account_id", accountId);
  const { count: visualEmbedded } = await db
    .from("creative_embeddings")
    .select("ad_id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .not("visual_embedding", "is", null);
  const { count: scriptEmbedded } = await db
    .from("creative_embeddings")
    .select("ad_id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .not("script_embedding", "is", null);
  const pct = (n: number | null) =>
    totalCreatives && totalCreatives > 0 ? Math.round((1000 * (n ?? 0)) / totalCreatives) / 10 : 0;

  let chained = false;
  if (
    !noChain &&
    !cappedMid &&
    spent < cap &&
    (pending ?? 0) > 0 &&
    chainDepth < MAX_CHAIN &&
    !Deno.env.get("ANALYZE_NO_CHAIN")
  ) {
    chained = true;
    const nextUrl = `${SUPABASE_URL}/functions/v1/analyze-creative?chain=${chainDepth + 1}`;
    // Fire-and-forget a FRESH top-level invocation (new worker, fresh memory) —
    // NOT EdgeRuntime.waitUntil (per verdanote-edge-fn-no-waituntil-for-http-calls).
    fetch(nextUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ account_id: accountId, limit }),
    }).catch((e: Error) => console.error("analyze-creative self-chain error:", e.message));
  }

  return json({
    ok: true,
    account_id: accountId,
    analyzed,
    failed,
    capped: cappedMid || spent >= cap,
    spent_usd: Math.round(spent * 10000) / 10000,
    cap_usd: cap,
    pending_remaining: pending ?? 0,
    embedding_coverage: {
      total_creatives: totalCreatives ?? 0,
      visual_pct: pct(visualEmbedded),
      script_pct: pct(scriptEmbedded),
    },
    chained,
    chain_depth: chainDepth,
    errors: errors.slice(0, 20),
    error_count: errors.length,
  });
});
