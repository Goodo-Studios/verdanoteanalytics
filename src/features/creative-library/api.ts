// Creative Library — client API + shared types.
//
// All reads go through the session-authed `creative-library` edge function
// (never the raw SECURITY DEFINER RPCs, whose authenticated EXECUTE is revoked).
// The function verifies the session JWT + account ownership, then calls the RPCs
// with the service role — same first-party pattern as getLibrary()/leaderboard.

import { apiFetch } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";

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
