// analyze-creative — Creative Intelligence WS1 (US-002 + US-003).
//
// Analyzes ONE account creative the same way the Creative Vault analyzes a saved
// item — same prompts, same OUTPUT shape (transcript + framework + hooks + script/
// visual analysis) — so moving a live creative into the Vault is a data copy, not
// a re-analysis (US-013). The ONLY difference from the vault is model routing:
// the LLM/vision calls go through cheap OpenRouter models (US-000 lock) instead of
// Claude direct. Transcription is Deepgram-by-URL first (no per-day audio cap,
// server-side extraction) with Groq Whisper as fallback — same provider order as
// vault-transcribe. Embeddings stay on openai/text-embedding-3-small @ 512d.
//
// The queue is creatives.analysis_status itself (no separate table): 'pending'
// rows are claimed spend-first in batches (FOR UPDATE SKIP LOCKED via
// claim_creatives_for_analysis), analyzed CONCURRENTLY (bounded by CONCURRENCY,
// with 429/backoff on the OpenRouter+Groq calls), then marked 'done'. Each
// invocation runs under a wall-clock TIME_BUDGET and releases any un-started
// claims back to 'pending'. The function self-chains a fresh invocation while
// work remains and the per-account $ cap (creative_analysis_spend) is not hit,
// hopping to the NEXT enabled account when the current one is drained/capped so
// one continuous drain empties the whole backlog — mirrors drain-media-queue.
//
// Auth model: internal / service-role only (verify_jwt = false). Poked manually
// with { account_id } for the builder-account-first rollout, or by pg_cron once
// rollout widens (US-012). NOT linked from any client.
//
// Body (all optional except account_id):
//   { account_id: string, limit?: number, force?: boolean, chain?: number }
//     • account_id — REQUIRED. Restrict to one account (builder-first + spend safety).
//     • limit      — creatives claimed per invocation (default 30, max 100).
//     • force      — re-analyze creatives already 'done' (bounded by limit).
//     • chain      — internal self-chain depth (do not set by hand).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "../_shared/cors.ts";
import { parseLooseJson } from "../_shared/vault-analyze-logic.ts";
import { extractDeepgramTranscript } from "../_shared/vault-transcribe-logic.ts";
import {
  buildFrameworkColumns,
  buildTagSuggestions,
  metadataColumns,
} from "../_shared/analyze-creative-logic.ts";
import {
  isRetriableResponse,
  retryWaitMs,
  runPool,
  TimeoutError,
  withTimeout,
} from "../_shared/analyze-creative-concurrency.ts";
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
// Transcription: Deepgram-by-URL is PRIMARY (same order as vault-transcribe),
// Groq Whisper is the FALLBACK. Deepgram has no per-day audio cap and extracts
// audio server-side (no download+upload), which lifts the Groq ASPD (audio-
// seconds-per-day, 28_800s) ceiling that was throttling the entire video queue.
const DEEPGRAM_KEY = Deno.env.get("DEEPGRAM_API_KEY");
const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen";
const DEEPGRAM_MODEL = Deno.env.get("DEEPGRAM_MODEL") ?? "nova-2";

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
const DEEPGRAM_FLAT_USD = 0.002; // nova-2 ~$0.0043/min; flat estimate per ~30s ad. Tiny vs the $10/account cap.

// Sized so one invocation drains ~2 concurrency-waves and RETURNS well under the
// ~150s edge limit (a video item's tail is ~40-50s wall — Deepgram + the ~8
// sequential OpenRouter calls + frame fetches + 2 embeds). Two waves ≈ ~100s,
// leaving headroom for the closing count queries and the self-chain fire so the
// drain never gets killed mid-flight. Statics (one vision call) are far faster and
// interleave through the same pool, pulling the effective rate up.
const BATCH_DEFAULT = 24;
const BATCH_MAX = 100;
const MAX_CHAIN = 400; // safety bound on self-chain depth (raised for cross-account drain)
const FRAME_LIMIT = 8;

// Speedup knobs (2026-07-22). The drain used to process a claimed batch strictly
// one-creative-at-a-time; these bound a CONCURRENT pass instead.
//   • CONCURRENCY — creatives analyzed at once within one invocation. Conservative
//     so the fan-out of OpenRouter/Groq calls per item can't rate-limit-storm; the
//     429 backoff below is the second line of defense.
//   • TIME_BUDGET_MS — wall-clock ceiling for the concurrent pass, well under the
//     edge-function limit (~150s) with headroom for the closing count queries and
//     the self-chain fire. Un-started claimed rows are released to 'pending'.
// Raised 12 → 20: measurement showed each ~45s hop completed only ~8 of a claimed
// 24 because video items run ~30–45s and only CONCURRENCY of them run at once, so
// one dispatch window drained barely half a wave (~600/hr). Direct provider probes
// showed OpenRouter/Deepgram fast and NOT rate-limiting at this volume, and the
// per-call 429/5xx backoff + per-attempt timeouts remain the hard safety net, so a
// wider fan-out lifts throughput without a rate-limit storm. Still env-overridable
// for ops to dial back if a provider ever pushes back.
const CONCURRENCY = Number(Deno.env.get("ANALYZE_CONCURRENCY") ?? 20);
// Wall-clock ceiling for DISPATCHING new items in the concurrent pass. Lowered to
// 45s so that even a late-dispatched item — bounded by the per-ITEM deadline below
// — finishes and the invocation RETURNS well under the ~150s edge idle limit
// (worst case ≈ TIME_BUDGET_MS + ITEM_TIMEOUT_MS + closing queries ≈ 45+45+few),
// guaranteeing the closing count queries run and the self-chain actually fires.
// A run that overran 150s used to be killed mid-flight, which silently broke the
// chain AND orphaned every in-flight 'analyzing' row (the observed hang).
const TIME_BUDGET_MS = Number(Deno.env.get("ANALYZE_TIME_BUDGET_MS") ?? 45_000);
// Per-ITEM hard deadline. A healthy video item is ~24s (Deepgram ~1.5s + a short
// sequential chain of gemini-flash-lite/gpt-oss calls, each <3s); a static is a
// single vision call. This deadline is the load-bearing anti-hang backstop: an
// item whose provider chain runs long is ABANDONED here and its row RECYCLED to
// 'pending' (not left 'analyzing', not burned as 'failed'), so it retries cleanly
// next run instead of occupying a slot until the stale-reclaim window. Bounding
// every item this way is what stops a slow tail item from dragging the whole
// invocation past the edge wall (which orphaned in-flight rows).
// 60s (raised from 45s): a legit video item is ~24–45s, and at 45s some genuine
// items were being recycled just before finishing (measured recycled≈2/hop), which
// wastes their partial work and risks a slow item recycling forever. 60s lets real
// items complete while still hard-bounding a truly hung one. Worst case an item
// dispatched right at TIME_BUDGET (45s) ends by 45+60=105s — comfortably under the
// ~150s edge wall (plus the closing count queries + the durable self-chain enqueue).
const ITEM_TIMEOUT_MS = Number(Deno.env.get("ANALYZE_ITEM_TIMEOUT_MS") ?? 60_000);
const MAX_HTTP_RETRIES = 3; // OpenRouter/Groq/Deepgram 429 + 5xx retries before giving up (bounds worst-case per-call wall)
// Per-attempt hard timeout on every provider HTTP call. Without this a hung or
// pathologically slow provider call could pin a worker for the whole invocation.
const HTTP_TIMEOUT_MS = Number(Deno.env.get("ANALYZE_HTTP_TIMEOUT_MS") ?? 20_000);
// Transcription can legitimately take a few seconds (Deepgram server-side audio
// extraction) so it gets a longer per-attempt timeout than a chat/vision call.
const TRANSCRIBE_TIMEOUT_MS = Number(Deno.env.get("ANALYZE_TRANSCRIBE_TIMEOUT_MS") ?? 35_000);

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Retry a provider fetch on 429 / 5xx with jittered exponential backoff, under
//    a per-attempt hard timeout. Returns the final Response (the caller decides how
//    to handle a non-ok terminal status). This is what makes the raised concurrency
//    safe AND keeps the invocation inside the edge wall limit:
//      • each attempt is aborted after `timeoutMs` so a slow/hung provider call can
//        never pin a worker for the whole invocation;
//      • an explicit `x-should-retry: false` (Groq's hard daily-quota 429) is NOT
//        retried — it fails fast so the caller can fall back to another provider;
//      • the honored Retry-After is HARD-CAPPED (retryWaitMs) so a multi-minute
//        header can never sleep the invocation past the ~150s edge idle limit.
//    On a network error / timeout the attempt is treated as a transient failure and
//    retried up to MAX_HTTP_RETRIES; the final failure re-throws. ──
async function fetchWithRetry(
  doFetch: (signal: AbortSignal) => Promise<Response>,
  label: string,
  timeoutMs: number = HTTP_TIMEOUT_MS,
): Promise<Response> {
  let attempt = 0;
  while (true) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(ctrl.signal);
    } catch (e) {
      clearTimeout(timer);
      if (attempt >= MAX_HTTP_RETRIES) throw e;
      attempt++;
      const waitMs = retryWaitMs(null, attempt);
      console.warn(`${label} network/timeout — retry ${attempt}/${MAX_HTTP_RETRIES} in ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) return res;
    const retriable = isRetriableResponse(res.status, res.headers.get("x-should-retry"));
    if (!retriable || attempt >= MAX_HTTP_RETRIES) return res;
    attempt++;
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = retryWaitMs(Number.isFinite(retryAfter) ? retryAfter : null, attempt);
    // Free the connection before sleeping so the retry reuses the pool cleanly.
    await res.body?.cancel().catch(() => {});
    console.warn(`${label} ${res.status} — retry ${attempt}/${MAX_HTTP_RETRIES} in ${waitMs}ms`);
    await sleep(waitMs);
  }
}

// ── OpenRouter chat/vision call. Returns text + the USD cost from real usage. ──
async function orChat(
  model: string,
  system: string,
  userContent: unknown,
  maxTokens: number,
  imageCount = 0,
): Promise<{ text: string; costUsd: number }> {
  const res = await fetchWithRetry(
    (signal) =>
      fetch("https://openrouter.ai/api/v1/chat/completions", {
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
        signal,
      }),
    `OpenRouter ${model}`,
  );
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
  const res = await fetchWithRetry(
    (signal) =>
      fetch("https://openrouter.ai/api/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_KEY}`,
          "Content-Type": "application/json",
          "X-Title": "Verdanote",
        },
        body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 8000), dimensions: 512 }),
        signal,
      }),
    "OpenRouter embedding",
  );
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
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      signal: ctrl.signal,
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
  } finally {
    clearTimeout(timer);
  }
}

// ── Transcribe a cached video URL. Deepgram-by-URL is PRIMARY (same provider
//    order as vault-transcribe); Groq Whisper is the FALLBACK. Skips gracefully
//    (returns null) on no-audio / oversized / provider failure.
//
//    WHY Deepgram first: Groq Whisper enforces a per-day audio cap (ASPD 28_800s)
//    that the ~17k-video backlog exhausts almost immediately, after which every
//    call 429s with a multi-minute Retry-After. That single provider limit — not
//    concurrency or batch size — was the steady-state throttle. Deepgram extracts
//    audio server-side from the URL (no download+upload, no daily-audio cap), so
//    the video path drains at the drain's own pace instead of Groq's daily budget. ──
async function transcribe(videoUrl: string): Promise<{ text: string | null; costUsd: number }> {
  // PRIMARY: Deepgram prerecorded-by-URL.
  if (DEEPGRAM_KEY) {
    try {
      const dg = await fetchWithRetry(
        (signal) =>
          fetch(`${DEEPGRAM_URL}?model=${DEEPGRAM_MODEL}&smart_format=true&punctuate=true`, {
            method: "POST",
            headers: { Authorization: `Token ${DEEPGRAM_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ url: videoUrl }),
            signal,
          }),
        "Deepgram listen",
        TRANSCRIBE_TIMEOUT_MS,
      );
      if (dg.ok) {
        // A 200 is authoritative — an empty transcript means genuinely no speech,
        // so DON'T fall through to Groq (which would re-burn its scarce quota).
        const t = extractDeepgramTranscript(await dg.json());
        return { text: t.trim() || null, costUsd: DEEPGRAM_FLAT_USD };
      }
      // Non-OK Deepgram (e.g. transient 5xx that exhausted retries) → try Groq.
      await dg.body?.cancel().catch(() => {});
      console.warn(`Deepgram ${dg.status} — falling back to Groq whisper`);
    } catch (e) {
      console.warn(`Deepgram request failed (${e instanceof Error ? e.message : e}) — falling back to Groq`);
    }
  }

  // FALLBACK: Groq Whisper (download bytes → multipart upload). Bounded now — a
  // hard daily-quota 429 carries x-should-retry:false and fails fast (no 144s
  // sleep), so this degrades to a null transcript instead of stalling the drain.
  try {
    const vres = await fetchWithRetry((signal) => fetch(videoUrl, { signal }), "video download", TRANSCRIBE_TIMEOUT_MS);
    if (!vres.ok) {
      await vres.body?.cancel().catch(() => {});
      return { text: null, costUsd: 0 };
    }
    const bytes = new Uint8Array(await vres.arrayBuffer());
    const ext = videoUrl.toLowerCase().includes(".webm") ? "webm" : "mp4";
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: `video/${ext}` }), `video.${ext}`);
    form.append("model", "whisper-large-v3-turbo");
    const gres = await fetchWithRetry(
      (signal) =>
        fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${GROQ_KEY}` },
          body: form,
          signal,
        }),
      "Groq whisper",
      TRANSCRIBE_TIMEOUT_MS,
    );
    if (!gres.ok) {
      // 413 (too large) / 400 (no audio) / 429 (daily cap) → skip, not fail.
      await gres.body?.cancel().catch(() => {});
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
        // Vault-parity structured framework (discrete fields + framework_json).
        ...buildFrameworkColumns(fw, { isImage: true }),
        // Vault-parity metadata promoted to first-class columns (IMAGE prompt emits
        // brand_name/industry/ad_format/target_audience inline). style + person ride
        // in framework_json + tag_suggestions (auto-tag layer promotes to columns).
        ...metadataColumns(brand),
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

  // Frame-vision pipeline. It depends ONLY on the cached frames (DB + image
  // fetches), NOT on any of the text-analysis LLM outputs, so it runs CONCURRENTLY
  // with the brand/script/visual group below instead of sequentially after it —
  // a per-item latency win on the video path. Returns the frame-derived visual
  // notes (empty when there are no cached frames → caller falls back to the
  // script-inferred visual analysis). Resolves cached frame image URLs in two
  // steps (creative_frames.asset_id → media_assets.public_url) to avoid a
  // PostgREST embed on an unknown FK name.
  const frameAnalysis = async (): Promise<{ notes: string; costUsd: number; hadFrames: boolean }> => {
    const { data: frameAssetRows } = await db
      .from("creative_frames")
      .select("asset_id")
      .eq("ad_id", c.ad_id)
      .order("frame_index", { ascending: true })
      .limit(FRAME_LIMIT);
    const assetIds = (frameAssetRows ?? [])
      .map((r: { asset_id: string | null }) => r.asset_id)
      .filter((id: unknown): id is string => typeof id === "string");
    if (!assetIds.length) return { notes: "", costUsd: 0, hadFrames: false };
    const { data: assets } = await db
      .from("media_assets")
      .select("id, public_url")
      .in("id", assetIds);
    const byId = new Map((assets ?? []).map((a: { id: string; public_url: string }) => [a.id, a.public_url]));
    const frameUrls = assetIds
      .map((id) => byId.get(id))
      .filter((u): u is string => typeof u === "string");
    if (!frameUrls.length) return { notes: "", costUsd: 0, hadFrames: false };
    const dataUrls = (await Promise.all(frameUrls.map(fetchImageAsDataUrl))).filter(
      (d): d is string => !!d,
    );
    if (!dataUrls.length) return { notes: "", costUsd: 0, hadFrames: true };
    const ts = dataUrls.map((_, i) => `${i}s`).join(", ");
    const content: unknown[] = [
      { type: "text", text: frameAnalysisUserText(dataUrls.length, ts) },
      ...dataUrls.map((url) => ({ type: "image_url", image_url: { url, detail: "low" } })),
    ];
    const { text, costUsd } = await orChat(VISION_MODEL, FRAME_ANALYSIS_SYSTEM, content, 1024, dataUrls.length);
    const parsedFrames = parseLooseJson(text) as unknown;
    const arr = Array.isArray(parsedFrames)
      ? parsedFrames
      : (parsedFrames as { frames?: unknown[] })?.frames;
    const notes = Array.isArray(arr)
      ? arr.map((f: { description?: string }) => f.description).filter(Boolean).join(" ")
      : "";
    return { notes, costUsd, hadFrames: true };
  };

  // Brand metadata + script analysis + visual (script-inferred) analysis, run
  // concurrently with the independent frame-vision pipeline above.
  const [brandR, scriptR, visualR, frameRes] = await Promise.all([
    orChat(TEXT_MODEL, BRAND_METADATA_PROMPT, cleaned, 1024),
    orChat(TEXT_MODEL, SCRIPT_ANALYSIS_PROMPT, cleaned, 1024),
    orChat(TEXT_MODEL, VISUAL_ANALYSIS_PROMPT, cleaned, 512),
    frameAnalysis(),
  ]);
  cost += brandR.costUsd + scriptR.costUsd + visualR.costUsd + frameRes.costUsd;
  const brand = parseLooseJson(brandR.text);

  // Frame vision → ai_visual_notes (preferred over the script-only inference when
  // cached frames yielded a description).
  const visualNotes = frameRes.notes.trim() || visualR.text.trim();

  const hookAnalysis = [fw.hook_verbal, fw.hook_text, fw.hook_type, fw.hook_formula]
    .filter(Boolean)
    .join(" | ");

  return {
    update: {
      // Vault-parity structured framework (discrete fields + framework_json).
      ...buildFrameworkColumns(fw, { isImage: false }),
      // Vault-parity metadata promoted to first-class columns (from BRAND_METADATA_PROMPT).
      // style + person ride in framework_json + tag_suggestions (auto-tag layer
      // promotes them to the style/person tag columns).
      ...metadataColumns(brand),
      transcript: cleaned || raw || null,
      transcript_status: cleaned || raw ? "ready" : "none",
      ai_analysis: scriptR.text.trim() || null,
      ai_hook_analysis: hookAnalysis || null,
      ai_cta_notes: [fw.cta_type, fw.cta_formula].filter(Boolean).join(" | ") || null,
      ai_visual_notes: visualNotes || null,
      tag_suggestions: buildTagSuggestions(fw, brand, frameRes.hadFrames),
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
  const limit = Math.min(Math.max(Number(body.limit) || BATCH_DEFAULT, 1), BATCH_MAX);
  const force: boolean = body.force === true;
  // no_chain: process a single bounded batch and stop (controlled validation runs).
  const noChain: boolean = body.no_chain === true;
  const chainDepth = Number(body.chain ?? url.searchParams.get("chain") ?? 0);

  // Single-flight (global): a fresh poke (chain=0, e.g. the 5-min cron or a manual
  // run) must NOT start a new drain while another is already active — overlapping
  // self-chaining workers are the throttle trigger (mirrors drain-media-queue's
  // single-flight guard). A live chain leaves creatives in 'analyzing' touched
  // within the last 3 min. Self-chain continuations (chain>0) ARE that chain, so
  // they skip the guard.
  if (chainDepth === 0) {
    const { count: active } = await db
      .from("creatives")
      .select("ad_id", { count: "exact", head: true })
      .eq("analysis_status", "analyzing")
      .gt("updated_at", new Date(Date.now() - 3 * 60_000).toISOString());
    if ((active ?? 0) > 0) {
      return json({ ok: true, status: "skipped", reason: "chain-active", analyzing: active });
    }
  }

  // Resolve the target account: explicit account_id (manual / validation runs and
  // self-chain continuations) OR flag-driven (cron poke with empty body → the next
  // creative_analysis_enabled account with pending, under-cap work).
  let accountId: string | undefined = body.account_id;
  if (!accountId) {
    const { data: nextAcct } = await db.rpc("next_creative_analysis_account");
    accountId = typeof nextAcct === "string" && nextAcct ? nextAcct : undefined;
    if (!accountId) {
      return json({ ok: true, no_work: true, reason: "no flagged account with pending work" });
    }
  }

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
  let recycled = 0; // items abandoned at the per-item deadline and released to 'pending'
  const errors: string[] = [];

  // Process the claimed batch CONCURRENTLY (bounded by CONCURRENCY) instead of
  // one-creative-at-a-time — the single biggest throughput win for the backlog.
  // Each creative is a distinct claimed ('analyzing') row, so concurrent workers
  // never double-process one; the claim RPC's FOR UPDATE SKIP LOCKED already made
  // that safe across overlapping invocations too. A worker OWNS its errors
  // (marks the row 'failed', never re-throws) so the pool can't reject mid-flight.
  //
  // Two stop conditions halt NEW dispatch (in-flight workers still finish): the
  // wall-clock TIME_BUDGET (keeps the run comfortably under the ~150s edge limit
  // even when the batch is video-heavy) and the per-account $ cap. Rows never
  // started are released from 'analyzing' back to 'pending' for the next run.
  const startedMs = Date.now();
  const timedOut = () => Date.now() - startedMs > TIME_BUDGET_MS;

  const analyzeWorker = async (c: CreativeRow): Promise<void> => {
    try {
      // Per-ITEM deadline: a creative whose provider chain runs long is abandoned
      // here so it can never pin this worker (and drag the whole invocation past
      // the edge wall, orphaning every in-flight 'analyzing' row). analyzeOne only
      // writes to the DB via the worker below AFTER it returns, so abandoning it
      // leaves no partial write — the row is simply recycled to 'pending'.
      const { update, costUsd } = await withTimeout(analyzeOne(c), ITEM_TIMEOUT_MS, c.ad_id);
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
      if (e instanceof TimeoutError) {
        // Slow item — NOT a failure. Recycle to 'pending' so it retries cleanly
        // next run instead of sitting 'analyzing' until the stale-reclaim window.
        recycled++;
        await db.from("creatives").update({ analysis_status: "pending" }).eq("ad_id", c.ad_id);
        return;
      }
      failed++;
      errors.push(`${c.ad_id}: ${e instanceof Error ? e.message : String(e)}`);
      // Terminal 'failed' (NOT stuck 'analyzing') so it never blocks the queue; a
      // genuine crash mid-item is instead recovered by the stale-'analyzing'
      // reclaim in claim_creatives_for_analysis, so failures don't retry-storm.
      await db.from("creatives").update({ analysis_status: "failed" }).eq("ad_id", c.ad_id);
    }
  };

  const { skipped } = await runPool(
    batch,
    CONCURRENCY,
    analyzeWorker,
    () => timedOut() || spent >= cap,
  );

  const cappedMid = spent >= cap;
  if (skipped.length) {
    // Release un-started claims (budget/time-budget cutoff) from 'analyzing' back
    // to 'pending' so the next invocation retries them (never left stuck).
    const unprocessed = skipped.map((i) => batch[i].ad_id);
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

  // Resolve the NEXT chain target so one continuous self-chaining drain empties
  // the whole backlog across ALL enabled accounts, instead of one account per run
  // with up-to-a-full-cron-interval idle gaps between accounts:
  //   • current account still has pending work and is under cap → stay on it;
  //   • otherwise (drained or capped) → hop to the next flagged, under-cap account
  //     with pending work (next_creative_analysis_account skips this one).
  // Single-flight still holds: this is a chain>0 continuation of the one active
  // drain, and while its claimed rows sit 'analyzing' a chain=0 cron poke no-ops.
  let nextAccount: string | undefined;
  if (!cappedMid && (pending ?? 0) > 0) {
    nextAccount = accountId;
  } else {
    const { data: hop } = await db.rpc("next_creative_analysis_account");
    nextAccount = typeof hop === "string" && hop ? hop : undefined;
  }

  let chained = false;
  if (
    !noChain &&
    nextAccount &&
    chainDepth < MAX_CHAIN &&
    !Deno.env.get("ANALYZE_NO_CHAIN")
  ) {
    // DURABLE self-chain via pg_net (the same DB-backed mechanism the cron uses),
    // NOT a fire-and-forget fetch(). A fetch() fired here is sent AFTER this
    // handler returns its Response, at which point the Supabase edge isolate is
    // frozen — so the outbound request is best-effort and was usually cancelled
    // before being sent, breaking the chain after a single hop (the drain then
    // only advanced one bounded batch per 2-min cron tick ≈ the observed ~200/hr,
    // with single-flight stalling the intervening ticks). poke_analyze_creative
    // persists the next invocation in pg_net's queue, which a Postgres background
    // worker sends independently of this isolate's lifecycle, so the chain
    // reliably continues back-to-back. We AWAIT the enqueue (a fast DB insert, not
    // the child's processing) so it is durably committed before we return. Still
    // NOT EdgeRuntime.waitUntil (per verdanote-edge-fn-no-waituntil-for-http-calls).
    // chain=depth+1 keeps skipping the single-flight guard; MAX_CHAIN + the
    // $/account cap still bound the chain.
    const { error: pokeErr } = await db.rpc("poke_analyze_creative", {
      p_body: { account_id: nextAccount, limit, chain: chainDepth + 1 },
    });
    if (pokeErr) {
      console.error("analyze-creative self-chain enqueue error:", pokeErr.message);
    } else {
      chained = true;
    }
  }

  return json({
    ok: true,
    account_id: accountId,
    analyzed,
    failed,
    recycled,
    capped: cappedMid || spent >= cap,
    spent_usd: Math.round(spent * 10000) / 10000,
    cap_usd: cap,
    pending_remaining: pending ?? 0,
    concurrency: CONCURRENCY,
    embedding_coverage: {
      total_creatives: totalCreatives ?? 0,
      visual_pct: pct(visualEmbedded),
      script_pct: pct(scriptEmbedded),
    },
    chained,
    chained_to: chained ? nextAccount : null,
    chain_depth: chainDepth,
    errors: errors.slice(0, 20),
    error_count: errors.length,
  });
});
