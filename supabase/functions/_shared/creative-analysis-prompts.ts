// creative-analysis-prompts — VERBATIM copies of the Creative Vault analysis
// prompts (vault-analyze/index.ts, vault-frame-analyze/index.ts). The account-
// creative pipeline (analyze-creative) reuses the SAME prompts + output shape so
// a live creative gets the exact hooks + clean script + framework + analysis a
// vault card shows — Save-to-Vault then becomes a data copy, not a re-analysis.
//
// Only the MODEL + provider routing differ (analyze-creative routes these through
// cheap OpenRouter models per US-000; the vault uses Claude direct). Prompt text
// must stay byte-for-byte identical to the vault to preserve parity — if the vault
// prompts change, update here too (or, later, have vault-analyze import this).

export const CLEAN_TRANSCRIPT_PROMPT =
  `You are editing a raw speech-to-text transcript from a short-form social video.

Your task: clean it into a readable script that captures the speaker's exact words and intent.

Rules:
- Preserve every idea, example, and phrase the speaker used
- Fix run-on sentences and add paragraph breaks where the speaker pauses or shifts topic
- Remove filler words (um, uh, like, you know) only when they add no meaning
- Do NOT summarize, shorten, or rewrite — this should read like a polished transcript
- Output the script only, no headers or commentary`;

export const SCRIPT_ANALYSIS_PROMPT =
  `You are a short-form video strategist analyzing a cleaned script.

Assess this script in 3–4 focused paragraphs covering:
1. Hook effectiveness — what stops the scroll (or what weakens it)
2. Narrative flow — how well the body delivers on the hook's promise
3. CTA strength — how clear and compelling the call to action is
4. Core formula — one sentence capturing what makes this script reusable

Be specific and tactical. No headers or bullet lists — write as flowing analysis.
Output only the analysis text.`;

export const VISUAL_ANALYSIS_PROMPT =
  `You are inferring the visual production style of a short-form video from its script alone.

Based on the language, pacing, narrative voice, and structure of the script, describe:
- The likely visual format (e.g. talking head UGC, voiceover B-roll, street interview, product demo)
- The probable setting or visual environment
- Expected editing pacing (rapid cuts, slow reveal, static frame, etc.)
- Production level (raw/authentic vs. polished/branded)
- Any implied on-screen text or visual hooks

Write 2–3 sentences. This is an informed inference — be specific but appropriately confident.
Output only the analysis text.`;

export const BRAND_METADATA_PROMPT =
  `You are analyzing a short-form video ad script to extract brand and creative metadata.

Extract the following and respond with ONLY valid JSON (no markdown fences, no explanation):

{
  "brand_name": "The brand or product being advertised. Use null if this is not an ad or the brand is unclear.",
  "industry": "The industry/vertical (e.g. Insurance, Packaged Food, Home Goods, Beauty, Fitness, Technology, Finance, Apparel, SaaS, Health, Education). Use null if unclear.",
  "ad_format": "The creative format (e.g. Street Interview, Testimonial, POV Product Demo, Faceless UGC, Background VO UGC, Talking Head, Before/After, Tutorial, Elevated Native, Trending Audio). Use null if unclear.",
  "target_audience": "One sentence describing who this ad targets. Use null if unclear."
}`;

export const FRAMEWORK_PROMPT =
  `You are analyzing a short-form social video to extract its reusable content framework.

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

// Static image ad (no transcript): a SINGLE vision call that returns framework +
// metadata + visual/copy analysis together.
export const IMAGE_ANALYSIS_PROMPT =
  `You are analyzing a STATIC image ad — there is no video, no audio, and no spoken script. You are given the ad image itself.

Extract the ad's reusable creative framework and metadata PURELY from what is visible: the headline, body copy, on-image text overlays, product, layout, and call to action.

The 12 copywriting frameworks are:
- AIDA, PAS, BAB, FAB, HSO, PASTOR, 4Ps, SLAP, Star-Story-Solution, Problem-Promise-Proof-Proposal, Storybrand, The Rule of One.

Respond with ONLY valid JSON (no markdown fences, no explanation):

{
  "copywriting_framework": "AIDA" | "PAS" | "BAB" | "FAB" | "HSO" | "PASTOR" | "4Ps" | "SLAP" | "Star-Story-Solution" | "Problem-Promise-Proof-Proposal" | "Storybrand" | "Rule of One" | "Other",
  "hook_type": "bold_claim" | "pattern_interrupt" | "honest_admission" | "question" | "other",
  "hook_text": "The primary headline / hero text overlay visible on the image — transcribe it exactly. Use null if there is no visible text.",
  "hook_formula": "Fill-in-the-blank version of the headline using [CLAIM], [TOPIC], [RESULT], [BENEFIT] placeholders.",
  "value_structure": "One sentence describing how the ad's message and layout are organized: single claim / benefit list / before-after / product hero / comparison / testimonial / infographic",
  "cta_type": "comment" | "follow" | "visit" | "dm" | "save" | "shop" | "other",
  "cta_formula": "Fill-in-the-blank CTA using [ACTION], [BRAND], [OFFER] placeholders. Use null if no CTA is visible.",
  "fill_in_blank_script": "All visible ad copy rewritten as a reusable fill-in-the-blank template. Replace brand-specific details with [BRAND], [CLAIM], [BENEFIT], [OFFER], [CTA_ACTION]. Keep the structure and tone.",
  "brand_name": "The brand or product advertised. Use null if unclear.",
  "industry": "The industry/vertical (e.g. Insurance, Packaged Food, Home Goods, Beauty, Fitness, Technology, Finance, Apparel, SaaS, Health, Education). Use null if unclear.",
  "ad_format": "The static creative format (e.g. Product Hero, Lifestyle, Testimonial Quote, Before/After, Feature Callout, Sale/Promo, Infographic). Use null if unclear.",
  "target_audience": "One sentence describing who this ad targets. Use null if unclear.",
  "visual_analysis": "2-3 sentences describing the actual visual: layout, imagery, color, product presentation, and how the design supports the message.",
  "copy_analysis": "3-4 sentences analyzing the written copy: headline/hook effectiveness, clarity of the value proposition, and CTA strength. Tactical and specific, no headers or bullet lists."
}`;

export const FRAME_ANALYSIS_SYSTEM =
  `You are analyzing video frames from a short-form social media video. For each frame, describe in one sentence what is happening: the setting, subject, and any visible text overlays. Focus on visual elements that tell the story of the video's structure.`;

export function frameAnalysisUserText(count: number, timestamps: string): string {
  return `Analyze these ${count} video frames captured at timestamps: ${timestamps}. For each frame in order, give a single descriptive sentence. Respond as a JSON array: [{"timestamp": 0, "description": "..."}]`;
}
