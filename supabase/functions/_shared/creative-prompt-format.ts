/**
 * Rendering of creative metrics into the ai-chat system prompt.
 *
 * Lives in `_shared` so it is reachable from the vitest suite — the ai-chat
 * handler itself calls `serve()` at module scope and pulls remote Deno imports,
 * so it cannot be imported from a test.
 *
 * THE CONTRACT: `ctr`, `thumb_stop_rate` and `hold_rate` are stored as TRUE
 * PERCENTAGES on `creatives` (Meta Insights convention — `ctr` 1.67 means 1.67%,
 * `thumb_stop_rate` 31.5 means 31.5%). Render them directly. Multiplying by 100
 * here fed the model a 1.67% CTR as "167.0%" and a 31.5% hook rate as "3150.0%",
 * which silently poisoned every answer it produced — the numbers were wrong but
 * the prose around them read as confident and plausible.
 */

export interface PromptCreative {
  ad_name?: string | null;
  spend?: number | null;
  roas?: number | null;
  cpa?: number | null;
  /** Already a percentage. Do NOT ×100. */
  ctr?: number | null;
  /** Already a percentage. Do NOT ×100. */
  thumb_stop_rate?: number | null;
  /** Already a percentage. Do NOT ×100. */
  hold_rate?: number | null;
  ad_type?: string | null;
  hook?: string | null;
  style?: string | null;
  ad_status?: string | null;
}

/** Column order must match the header string in `buildSystemPrompt`. */
export const CREATIVE_TABLE_COLUMNS =
  "name | spend | roas | cpa | ctr% | hook% | hold% | type | hook | style | status";

/** Max creatives rendered into the prompt table. */
export const CREATIVE_TABLE_LIMIT = 40;

export function formatCreativeRow(c: PromptCreative): string {
  return [
    c.ad_name,
    `$${(c.spend || 0).toFixed(0)}`,
    `${(c.roas || 0).toFixed(2)}x`,
    `$${(c.cpa || 0).toFixed(0)}`,
    `${(c.ctr || 0).toFixed(2)}%`,
    `${(c.thumb_stop_rate || 0).toFixed(1)}%`,
    `${(c.hold_rate || 0).toFixed(1)}%`,
    c.ad_type || "?",
    c.hook || "?",
    c.style || "?",
    c.ad_status || "?",
  ].join(" | ");
}

export function formatCreativeTable(creatives: PromptCreative[]): string {
  return creatives.slice(0, CREATIVE_TABLE_LIMIT).map(formatCreativeRow).join("\n");
}
