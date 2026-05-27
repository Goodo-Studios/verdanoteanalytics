// vault-analyze — port from Creative Vault (US-003).
// Differences from source:
//   • No workspace_id references — items are scoped by user_id directly.
//   • Called internally with service-role bearer by vault-transcribe; uses
//     service-role only.
//
// Pipeline role: (1) cleans raw transcript via Claude, (2) extracts the
// reusable copywriting framework JSON using script + thumbnail vision input,
// (3) runs brand metadata / script analysis / visual analysis in parallel.
// Writes results to inspiration_frameworks + inspiration_items.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const SONNET_MODEL = "claude-sonnet-4-6";   // framework extraction (vision + complex JSON)
const HAIKU_MODEL  = "claude-haiku-4-5-20251001"; // all other calls (cheaper)
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const CLEAN_SCRIPT_PROMPT = `You are editing a raw speech-to-text transcript from a short-form social video.

Your task: clean it into a readable script that captures the speaker's exact words and intent.

Rules:
- Preserve every idea, example, and phrase the speaker used
- Fix run-on sentences and add paragraph breaks where the speaker pauses or shifts topic
- Remove filler words (um, uh, like, you know) only when they add no meaning
- Do NOT summarize, shorten, or rewrite — this should read like a polished transcript
- Output the script only, no headers or commentary`;

const SCRIPT_ANALYSIS_PROMPT = `You are a short-form video strategist analyzing a cleaned script.

Assess this script in 3–4 focused paragraphs covering:
1. Hook effectiveness — what stops the scroll (or what weakens it)
2. Narrative flow — how well the body delivers on the hook's promise
3. CTA strength — how clear and compelling the call to action is
4. Core formula — one sentence capturing what makes this script reusable

Be specific and tactical. No headers or bullet lists — write as flowing analysis.
Output only the analysis text.`;

const VISUAL_ANALYSIS_PROMPT = `You are inferring the visual production style of a short-form video from its script alone.

Based on the language, pacing, narrative voice, and structure of the script, describe:
- The likely visual format (e.g. talking head UGC, voiceover B-roll, street interview, product demo)
- The probable setting or visual environment
- Expected editing pacing (rapid cuts, slow reveal, static frame, etc.)
- Production level (raw/authentic vs. polished/branded)
- Any implied on-screen text or visual hooks

Write 2–3 sentences. This is an informed inference — be specific but appropriately confident.
Output only the analysis text.`;

const BRAND_META_PROMPT = `You are analyzing a short-form video ad script to extract brand and creative metadata.

Extract the following and respond with ONLY valid JSON (no markdown fences, no explanation):

{
  "brand_name": "The brand or product being advertised. Use null if this is not an ad or the brand is unclear.",
  "industry": "The industry/vertical (e.g. Insurance, Packaged Food, Home Goods, Beauty, Fitness, Technology, Finance, Apparel, SaaS, Health, Education). Use null if unclear.",
  "ad_format": "The creative format (e.g. Street Interview, Testimonial, POV Product Demo, Faceless UGC, Background VO UGC, Talking Head, Before/After, Tutorial, Elevated Native, Trending Audio). Use null if unclear.",
  "target_audience": "One sentence describing who this ad targets. Use null if unclear."
}`;

const FRAMEWORK_PROMPT = `You are analyzing a short-form social video to extract its reusable content framework.

You have two sources of information:
1. The cleaned script (audio transcription) — what was spoken out loud
2. A thumbnail image from the video — what appears visually on screen

Use BOTH sources together. The script tells you what the creator says; the image shows what text overlays, captions, or on-screen graphics are visible.

The video follows a three-part structure:
- Hook (0–3s): stops the scroll
- Value delivery (3–50s): one idea with supporting detail
- CTA (50–60s): one specific next step

Also identify the primary copywriting framework used. The 12 frameworks are:
- AIDA: Attention → Interest → Desire → Action
- PAS: Problem → Agitate → Solution
- BAB: Before → After → Bridge
- FAB: Features → Advantages → Benefits
- HSO: Hook → Story → Offer
- PASTOR: Problem → Amplify → Story → Testimony → Offer → Response
- 4Ps: Picture → Promise → Prove → Push
- SLAP: Stop → Look → Act → Purchase
- Star-Story-Solution: introduce hero → tell story → reveal solution
- Problem-Promise-Proof-Proposal: state problem → make promise → show proof → propose next step
- Storybrand: character → problem → guide → plan → call to action → success → failure avoided
- The Rule of One: one reader, one problem, one promise, one action

For hook_text specifically: examine the thumbnail image carefully for any text overlays, burned-in captions, titles, or on-screen graphics. If text is visible, transcribe it exactly. If no image is available or there is clearly no on-screen text, use null.

Extract the following and respond with ONLY valid JSON (no markdown fences, no explanation):

{
  "copywriting_framework": "AIDA" | "PAS" | "BAB" | "FAB" | "HSO" | "PASTOR" | "4Ps" | "SLAP" | "Star-Story-Solution" | "Problem-Promise-Proof-Proposal" | "Storybrand" | "Rule of One" | "Other",
  "hook_type": "bold_claim" | "pattern_interrupt" | "honest_admission" | "question" | "other",
  "hook_verbal": "The exact words spoken out loud as the hook — copy them verbatim from the script (first 1–3 sentences). This is what the creator says.",
  "hook_text": "The text overlay or on-screen caption visible in the video thumbnail — e.g. a bold claim in all-caps, a question flashed on screen, or a punchy phrase shown as an overlay. Transcribe it exactly from the image. Use null only if no on-screen text is visible.",
  "hook_formula": "Fill-in-the-blank version of the hook using [CLAIM], [TOPIC], [TIMEFRAME], [RESULT] as placeholders.",
  "value_structure": "One sentence describing how the body is organized: list / story / before-after / demonstration / contrast / single insight with example",
  "cta_type": "comment" | "follow" | "visit" | "dm" | "save" | "other",
  "cta_formula": "Fill-in-the-blank CTA using [KEYWORD], [PLATFORM], [RESOURCE], [ACTION] as placeholders.",
  "fill_in_blank_script": "The full script rewritten as a fill-in-the-blank template. Replace brand-specific details with [BRAND], [CLAIM], [SPECIFIC_EXAMPLE], [RESULT], [CTA_ACTION]. Keep structure, pacing, and sentence rhythm exactly as the original."
}`;

async function callClaude(
  apiKey: string,
  system: string,
  userContent: string | unknown[],
  model = HAIKU_MODEL,
): Promise<string> {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system,
      messages: [
        { role: "user", content: userContent },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

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
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return `data:${contentType};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const db = createClient(supabaseUrl, serviceRoleKey);

  if (!anthropicKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

  let itemId = "";
  try {
    const body = await req.json();
    itemId = body.item_id;
    if (!itemId) return json({ error: "item_id required" }, 400);

    // Fetch transcript and item metadata (thumbnail + brand_name) in parallel
    const [transcriptResult, itemResult] = await Promise.all([
      db.from("inspiration_transcripts")
        .select("id, raw_transcript, cleaned_script")
        .eq("item_id", itemId)
        .single(),
      db.from("inspiration_items")
        .select("brand_name, thumbnail_url")
        .eq("id", itemId)
        .single(),
    ]);

    const transcriptRow = transcriptResult.data;
    if (!transcriptRow?.raw_transcript) {
      throw new Error("No transcript found for item");
    }

    const existingBrandName = itemResult.data?.brand_name ?? null;
    const thumbnailUrl = itemResult.data?.thumbnail_url ?? null;

    // Call 1: clean transcript → readable script (skip if already cleaned, e.g. for ad copy)
    // Thumbnail fetch runs concurrently — we need it for the framework call below.
    let cleanedScript = transcriptRow.cleaned_script;
    const thumbnailPromise = thumbnailUrl ? fetchImageAsDataUrl(thumbnailUrl) : Promise.resolve(null);

    if (!cleanedScript) {
      cleanedScript = await callClaude(
        anthropicKey,
        CLEAN_SCRIPT_PROMPT,
        transcriptRow.raw_transcript,
      );
      await db
        .from("inspiration_transcripts")
        .update({
          cleaned_script: cleanedScript,
          word_count: cleanedScript.split(/\s+/).filter(Boolean).length,
        })
        .eq("id", transcriptRow.id);
    }

    const thumbnailDataUrl = await thumbnailPromise;

    // Call 2: extract framework JSON — pass thumbnail as vision input when available
    const frameworkUserContent = thumbnailDataUrl
      ? (() => {
          const [header, base64Data] = thumbnailDataUrl.split(",");
          const mediaType = (header.match(/data:([^;]+)/)?.[1] ?? "image/jpeg") as
            "image/jpeg" | "image/png" | "image/gif" | "image/webp";
          return [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
            { type: "text", text: `Here is the video script:\n\n${cleanedScript}` },
          ];
        })()
      : cleanedScript;

    const frameworkText = await callClaude(
      anthropicKey,
      FRAMEWORK_PROMPT,
      frameworkUserContent,
      SONNET_MODEL, // vision + complex JSON schema — keep on Sonnet
    );

    let frameworkJson: Record<string, unknown> = {};
    try {
      frameworkJson = JSON.parse(frameworkText);
    } catch {
      const match = frameworkText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) {
        try {
          frameworkJson = JSON.parse(match[1]);
        } catch { /* leave empty */ }
      }
    }

    await db.from("inspiration_frameworks").insert({
      item_id: itemId,
      copywriting_framework: (frameworkJson.copywriting_framework as string) ?? null,
      hook_type: (frameworkJson.hook_type as string) ?? null,
      hook_verbal: (frameworkJson.hook_verbal as string) ?? null,
      hook_text: (frameworkJson.hook_text as string) ?? null,
      hook_formula: (frameworkJson.hook_formula as string) ?? null,
      value_structure: (frameworkJson.value_structure as string) ?? null,
      cta_type: (frameworkJson.cta_type as string) ?? null,
      cta_formula: (frameworkJson.cta_formula as string) ?? null,
      fill_in_blank_script: (frameworkJson.fill_in_blank_script as string) ?? null,
      framework_json: frameworkJson,
    });

    // Calls 3–5 in parallel: brand metadata, script analysis, visual analysis
    const [brandResult, scriptAnalysisText, visualAnalysisText] = await Promise.allSettled([
      (async (): Promise<Record<string, string | null>> => {
        const brandText = await callClaude(anthropicKey, BRAND_META_PROMPT, cleanedScript);
        try {
          return JSON.parse(brandText);
        } catch {
          const match = brandText.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (match) {
            try { return JSON.parse(match[1]); } catch { /* ignore */ }
          }
          return {};
        }
      })(),
      callClaude(anthropicKey, SCRIPT_ANALYSIS_PROMPT, cleanedScript),
      callClaude(anthropicKey, VISUAL_ANALYSIS_PROMPT, cleanedScript),
    ]);

    const brandMeta: Record<string, string | null> =
      brandResult.status === "fulfilled" ? brandResult.value : {};
    const scriptAnalysis: string | null =
      scriptAnalysisText.status === "fulfilled" ? scriptAnalysisText.value.trim() || null : null;
    const visualAnalysis: string | null =
      visualAnalysisText.status === "fulfilled" ? visualAnalysisText.value.trim() || null : null;

    await db.from("inspiration_items").update({
      status: "ready",
      // Prefer user-supplied brand_name over AI-detected; fall back to AI value
      brand_name: existingBrandName ?? (brandMeta.brand_name as string | null) ?? null,
      industry: (brandMeta.industry as string | null) ?? null,
      ad_format: (brandMeta.ad_format as string | null) ?? null,
      target_audience: (brandMeta.target_audience as string | null) ?? null,
      script_analysis: scriptAnalysis,
      visual_analysis: visualAnalysis,
    }).eq("id", itemId);

    return json({ ok: true, item_id: itemId });
  } catch (err) {
    console.error("vault-analyze error:", err);
    if (itemId) {
      await db
        .from("inspiration_items")
        .update({ status: "error", error_message: String(err) })
        .eq("id", itemId);
    }
    return json({ error: String(err) }, 500);
  }
});
