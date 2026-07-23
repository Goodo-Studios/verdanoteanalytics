import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

/**
 * The AI-analysis / framework / transcript / Vault-parity metadata columns the
 * analyze-creative pipeline writes onto `public.creatives`. These are
 * intentionally NOT part of the shared grid query (CREATIVE_COLS in
 * supabase/functions/creatives/index.ts) — they are long text + a jsonb blob +
 * per-item metadata only needed when a single creative's modal is open, so
 * bundling them into every paginated grid/report/analytics page would bloat the
 * payload. We fetch them lazily, per-creative, on demand instead — mirroring the
 * Vault, which loads its framework/analysis on open rather than in the list query.
 */
export interface CreativeAiDetail {
  // ── Vault-parity metadata (promoted to first-class creatives columns) ──
  brand_name: string | null;
  industry: string | null;
  ad_format: string | null;
  target_audience: string | null;
  // ── Structured framework (inspiration_frameworks parity) ──
  copywriting_framework: string | null;
  hook_type: string | null;
  hook_verbal: string | null;
  hook_text: string | null;
  hook_visual: string | null;
  hook_formula: string | null;
  value_structure: string | null;
  cta_type: string | null;
  cta_formula: string | null;
  fill_in_blank_script: string | null;
  framework_json: Json | null;
  // ── Hook favoriting (inspiration_items.hook_*_saved parity) ──
  hook_verbal_saved: boolean;
  hook_text_saved: boolean;
  hook_visual_saved: boolean;
  // ── Analysis prose ──
  ai_analysis: string | null;
  ai_hook_analysis: string | null;
  ai_cta_notes: string | null;
  ai_visual_notes: string | null;
  analysis_status: string | null;
  analyzed_at: string | null;
  // ── Cleaned script / transcript ──
  transcript: string | null;
  transcript_status: string | null;
}

const AI_COLS = [
  "brand_name",
  "industry",
  "ad_format",
  "target_audience",
  "copywriting_framework",
  "hook_type",
  "hook_verbal",
  "hook_text",
  "hook_visual",
  "hook_formula",
  "value_structure",
  "cta_type",
  "cta_formula",
  "fill_in_blank_script",
  "framework_json",
  "hook_verbal_saved",
  "hook_text_saved",
  "hook_visual_saved",
  "ai_analysis",
  "ai_hook_analysis",
  "ai_cta_notes",
  "ai_visual_notes",
  "analysis_status",
  "analyzed_at",
  "transcript",
  "transcript_status",
].join(", ");

/** The react-query key for a creative's lazy AI detail — exported so callers
 * (e.g. the modal's save/re-analyze mutations) can invalidate it after a write. */
export const creativeAiDetailKey = (adId: string | null | undefined) =>
  ["creative-ai", adId] as const;

/**
 * Lazy per-creative fetch of the AI-analysis + Vault-parity columns. Keyed by
 * ad_id and gated by `enabled` so the query only fires while the modal is open
 * (the modal passes `open`). Feeds both the Vault-parity header (brand / industry
 * / ad_format / target_audience) and the Script / Framework / Analysis tabs.
 */
export function useCreativeAiDetail(
  adId: string | null | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: creativeAiDetailKey(adId),
    enabled: enabled && !!adId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CreativeAiDetail | null> => {
      const { data, error } = await supabase
        .from("creatives")
        .select(AI_COLS)
        .eq("ad_id", adId!)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as CreativeAiDetail) ?? null;
    },
  });
}
