// Creative Library — client API + shared types.
//
// All reads go through the session-authed `creative-library` edge function
// (never the raw SECURITY DEFINER RPCs, whose authenticated EXECUTE is revoked).
// The function verifies the session JWT + account ownership, then calls the RPCs
// with the service role — same first-party pattern as getLibrary()/leaderboard.

import { apiFetch } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import type { AccountTaxonomy } from "@/lib/tagOptions";

/** One row from get_creative_library (a live creative + window perf + trend). */
export interface LibraryCreative {
  ad_id: string;
  account_id: string;
  ad_name: string;
  unique_code: string | null;
  platform: string | null;
  ad_status: string | null;
  hook: string | null;
  theme: string | null;
  product: string | null;
  tag_source: string | null;
  thumbnail_url: string | null;
  full_res_url: string | null;
  video_url: string | null;
  preview_url: string | null;
  landing_page_url: string | null;
  created_time: string | null;
  first_seen: string | null;
  version: number | null;
  video_views: number;
  archived: boolean;
  archive_id: string | null;
  in_vault: boolean;
  // Window performance (already true percentages — never *100 again).
  spend: number;
  roas: number;
  cpa: number;
  ctr: number;
  thumb_stop_rate: number;
  hold_rate: number;
  purchases: number;
  frequency: number;
  // Recent/prior split for the F6 classifier.
  recent_spend: number;
  prior_spend: number;
  recent_roas: number;
  prior_roas: number;
  recent_ctr: number;
  prior_ctr: number;
  recent_cpa: number;
  prior_cpa: number;
}

export interface LibraryResponse {
  account_id: string;
  from: string;
  to: string;
  rows: LibraryCreative[];
}

/** Fetch every live creative + window performance for the account. */
export async function fetchCreativeLibrary(
  accountId: string,
  from: string,
  to: string,
): Promise<LibraryResponse> {
  const params = new URLSearchParams({ account_id: accountId, from, to });
  return apiFetch("creative-library", `?${params.toString()}`) as Promise<LibraryResponse>;
}

export interface ArchiveResult {
  ok: boolean;
  archived: number;
  rows: { id: string; ad_id: string }[];
}

/** Durably archive selected (or all live) creatives into media_archive (F3). */
export async function archiveCreatives(
  accountId: string,
  adIds?: string[],
): Promise<ArchiveResult> {
  const { data, error } = await supabase.functions.invoke("creative-library", {
    body: { action: "archive", account_id: accountId, ad_ids: adIds ?? [] },
  });
  if (error) throw new Error(error.message ?? "Archive failed");
  return data as ArchiveResult;
}

export interface ExportResult {
  ok: boolean;
  job_id: string;
  status: string;
  file_count?: number;
  byte_size?: number;
  download_url?: string | null;
  error?: string;
}

/** One-click bulk-zip export of the selected creatives' durable media (F3). */
export async function exportCreativesZip(
  accountId: string,
  adIds: string[],
): Promise<ExportResult> {
  const { data, error } = await supabase.functions.invoke("creative-media-archive", {
    body: { action: "export", account_id: accountId, ad_ids: adIds },
  });
  if (error) {
    // supabase-js nulls data on non-2xx; surface the server error body when present.
    throw new Error(error.message ?? "Export failed");
  }
  return data as ExportResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// US-004: governed ad tagging — read the account's managed lists (Theme/Persona,
// creative-type activation, body vocabulary) and persist the matrix-axis tags
// against them.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch the account's governed taxonomy via the session-authed `account-taxonomy`
 * edge function (US-002). Returns the single read RPC payload verbatim, so the
 * tagging dropdowns read byte-identical values to the config surface, the api
 * mirror, and MCP.
 */
export async function fetchAccountTaxonomy(accountId: string): Promise<AccountTaxonomy> {
  const { data, error } = await supabase.functions.invoke("account-taxonomy", {
    body: { action: "list", account_id: accountId },
  });
  if (error) throw new Error(error.message ?? "Failed to load account taxonomy");
  return (data?.taxonomy ?? {}) as AccountTaxonomy;
}

/**
 * The body-axis vocabulary for an account: the distinct `body` values already in
 * use on its creatives. There is no dedicated body table (per the data model), so
 * the governed vocabulary is what strategists have already tagged — de-duplicated
 * client-side by buildBodyOptions.
 */
export async function fetchBodyVocabulary(accountId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("creatives")
    .select("body")
    .eq("account_id", accountId)
    .not("body", "is", null)
    .limit(2000);
  if (error) throw new Error(error.message ?? "Failed to load body vocabulary");
  return (data ?? []).map((r) => (r as { body: string | null }).body ?? "");
}

/** The governed matrix-axis tags a strategist sets on one creative. */
export interface GovernedTagPatch {
  /** angle_clusters.id reference (Theme/Persona), or null to clear (untagged). */
  angle_id?: string | null;
  /** House lane of the selected creative type, or null to clear. */
  creative_lane?: string | null;
  /** Activated creative type within the lane, or null to clear. */
  creative_type?: string | null;
  /** Body axis value, or null to clear. */
  body?: string | null;
}

/**
 * Persist the governed matrix-axis tags for one creative. These four columns are
 * the Creative Matrix axes (US-001) — independent of the six-dimension
 * tag_source precedence machinery (manual > csv_match > parsed > ai > untagged),
 * which this write never touches, so that precedence is preserved. Selecting a
 * Theme/Persona sets the angle_id REFERENCE (not the legacy free-text theme).
 *
 * Builder-only: the /creative-library route is builder-gated and RLS
 * ("Builder/employee can manage creatives") enforces ownership on the write. Only
 * the keys present in `patch` are written, so a partial edit never clobbers a
 * sibling axis; an explicit null clears a dimension (the "Untagged" choice).
 */
export async function saveGovernedTags(
  adId: string,
  patch: GovernedTagPatch,
): Promise<void> {
  const update: Record<string, string | null> = {};
  if ("angle_id" in patch) update.angle_id = patch.angle_id ?? null;
  if ("creative_lane" in patch) update.creative_lane = patch.creative_lane ?? null;
  if ("creative_type" in patch) update.creative_type = patch.creative_type ?? null;
  if ("body" in patch) update.body = patch.body ?? null;
  if (Object.keys(update).length === 0) return;

  const { error } = await supabase.from("creatives").update(update).eq("ad_id", adId);
  if (error) throw new Error(error.message ?? "Failed to save tags");
}
