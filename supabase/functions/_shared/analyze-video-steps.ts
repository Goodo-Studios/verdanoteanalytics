// The analyze-creative VIDEO path: transcribe → clean → framework (vision) → brand / script /
// visual (text) alongside frame vision. Moved out of analyze-creative/index.ts so it can be
// tested with fake providers; the network calls and the database writes come in as deps.

import {
  buildFrameworkColumns,
  buildTagSuggestions,
  metadataColumns,
} from "./analyze-creative-logic.ts";
import { parseLooseJson } from "./vault-analyze-logic.ts";

export interface ChatResult {
  text: string;
  costUsd: number;
}

export interface VideoStepDeps {
  transcribe(videoUrl: string): Promise<{ text: string | null; costUsd: number }>;
  chat(model: string, system: string, userContent: unknown, maxTokens: number, imageCount?: number): Promise<ChatResult>;
  fetchImageAsDataUrl(url: string): Promise<string | null>;
  frameAnalysis(): Promise<{ notes: string; costUsd: number; hadFrames: boolean }>;
  onSpend(usd: number): Promise<void>;
  saveTranscript(text: string | null): Promise<void>;
}

export interface VideoPrompts {
  clean: string;
  framework: string;
  brand: string;
  script: string;
  visual: string;
}

export interface VideoCreative {
  transcript: string | null;
  transcript_status?: string | null;
  video_url: string | null;
}

export async function analyzeVideo(
  c: VideoCreative,
  thumb: string | null,
  models: { text: string; vision: string },
  prompts: VideoPrompts,
  deps: VideoStepDeps,
): Promise<{ update: Record<string, unknown>; costUsd: number }> {
  let cost = 0;

  let raw = c.transcript;
  if (!raw && c.video_url) {
    const t = await deps.transcribe(c.video_url);
    cost += t.costUsd;
    raw = t.text;
  }

  let cleaned = "";
  if (raw) {
    const { text, costUsd } = await deps.chat(models.text, prompts.clean, raw, 2048);
    cost += costUsd;
    cleaned = text.trim();
  }

  // Framework (vision + script + thumbnail).
  const fw: Record<string, unknown> = {};
  {
    const dataUrl = thumb ? await deps.fetchImageAsDataUrl(thumb) : null;
    const userContent: unknown = dataUrl
      ? [
        { type: "text", text: `Cleaned script:\n${cleaned}` },
        { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
      ]
      : `Cleaned script:\n${cleaned}`;
    const { text, costUsd } = await deps.chat(models.vision, prompts.framework, userContent, 2048, dataUrl ? 1 : 0);
    cost += costUsd;
    Object.assign(fw, parseLooseJson(text));
  }

  // Brand metadata + script analysis + visual (script-inferred) analysis, run concurrently
  // with the independent frame-vision pipeline.
  const [brandR, scriptR, visualR, frameRes] = await Promise.all([
    deps.chat(models.text, prompts.brand, cleaned, 1024),
    deps.chat(models.text, prompts.script, cleaned, 1024),
    deps.chat(models.text, prompts.visual, cleaned, 512),
    deps.frameAnalysis(),
  ]);
  cost += brandR.costUsd + scriptR.costUsd + visualR.costUsd + frameRes.costUsd;
  const brand = parseLooseJson(brandR.text);

  // Frame vision → ai_visual_notes (preferred over the script-only inference when cached
  // frames yielded a description).
  const visualNotes = frameRes.notes.trim() || visualR.text.trim();

  const hookAnalysis = [fw.hook_verbal, fw.hook_text, fw.hook_type, fw.hook_formula]
    .filter(Boolean)
    .join(" | ");

  return {
    update: {
      // Vault-parity structured framework (discrete fields + framework_json).
      ...buildFrameworkColumns(fw, { isImage: false }),
      // Vault-parity metadata promoted to first-class columns (from BRAND_METADATA_PROMPT).
      // style + person ride in framework_json + tag_suggestions (auto-tag layer promotes
      // them to the style/person tag columns).
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
