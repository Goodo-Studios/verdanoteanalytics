// save-ad-to-vault — client-side save helper shared by the CreativeDetailModal
// single-save (US-003) and the analytics-grid bulk save (US-004).
//
// Wraps the vault-save-creative edge function (US-002): it builds the frozen
// performance snapshot from a `creatives` row, invokes the function with the
// creative identity + media URLs + snapshot, and normalizes the response into a
// single `VaultSaveResult` shape so both call sites can render consistent
// success / already-in-vault / failure states.
//
// Snapshot shaping reuses the dependency-free buildPerformanceSnapshot from the
// edge function's _shared module (US-005), so the client and server agree on the
// metric set. CTR on `creatives` is already stored as a percentage (already
// *100) — it is copied through verbatim, never re-multiplied.
import { supabase } from "@/integrations/supabase/client";
import {
  buildPerformanceSnapshot,
  type CreativeSnapshotSource,
} from "../../supabase/functions/_shared/vault-save-logic.ts";

export interface VaultSaveResult {
  /** The creative this result is for (echoed for batch correlation). */
  adId: string;
  /** The vault inspiration_items id, when known. */
  itemId: string | null;
  /** True when the ad was already in the global vault (dedupe hit — no insert). */
  alreadySaved: boolean;
}

/** Build the performance snapshot a save sends, stamped with capture time. */
export function buildSaveSnapshot(
  creative: CreativeSnapshotSource | null | undefined,
): Record<string, unknown> {
  return {
    ...buildPerformanceSnapshot(creative),
    captured_at: new Date().toISOString(),
  };
}

/**
 * Save a single analytics creative into the global Creative Vault via the
 * vault-save-creative edge function. Resolves with a normalized result on
 * success (including a dedupe hit) and rejects on a real failure so callers can
 * surface an error toast or count it in a batch summary.
 */
export async function saveCreativeToVault(creative: {
  ad_id: string;
  account_id?: string | null;
  ad_name?: string | null;
  platform?: string | null;
  full_res_url?: string | null;
  video_url?: string | null;
  thumbnail_url?: string | null;
  [key: string]: unknown;
}): Promise<VaultSaveResult> {
  const performance_snapshot = buildSaveSnapshot(creative);

  const { data, error } = await supabase.functions.invoke("vault-save-creative", {
    body: {
      ad_id: creative.ad_id,
      account_id: creative.account_id,
      ad_name: creative.ad_name,
      platform: creative.platform,
      full_res_url: creative.full_res_url,
      video_url: creative.video_url,
      thumbnail_url: creative.thumbnail_url,
      performance_snapshot,
    },
  });

  // supabase-js sets data=null on non-2xx; the actual server body lives in
  // error.context (the raw Response). Extract it so the toast shows the real
  // error instead of the generic "Edge Function returned a non-2xx status code".
  if (error) {
    const resp = (error as unknown as { context?: unknown }).context;
    if (resp instanceof Response) {
      let serverMsg: string | null = null;
      try {
        const body = await resp.json();
        serverMsg = body?.error ?? null;
      } catch { /* not JSON */ }
      if (serverMsg) throw new Error(serverMsg);
    }
    throw error;
  }
  if (data?.error) throw new Error(data.error);

  return {
    adId: creative.ad_id,
    itemId: data?.id ?? data?.item_id ?? null,
    alreadySaved: !!data?.already_saved,
  };
}

/** Aggregate counts for a bulk save, used to build the summary toast. */
export interface BulkSaveSummary {
  saved: number;
  alreadySaved: number;
  failed: number;
}

/**
 * Save many creatives, never aborting the batch on a single failure
 * (Promise.allSettled). Returns per-batch counts: newly saved, already-in-vault
 * (dedupe skips), and failures.
 */
export async function saveCreativesToVault(
  creatives: Parameters<typeof saveCreativeToVault>[0][],
): Promise<BulkSaveSummary> {
  const results = await Promise.allSettled(
    creatives.map((c) => saveCreativeToVault(c)),
  );

  const summary: BulkSaveSummary = { saved: 0, alreadySaved: 0, failed: 0 };
  for (const r of results) {
    if (r.status === "rejected") {
      summary.failed += 1;
    } else if (r.value.alreadySaved) {
      summary.alreadySaved += 1;
    } else {
      summary.saved += 1;
    }
  }
  return summary;
}

/** Render the single summary toast string from bulk-save counts. */
export function formatBulkSaveSummary(s: BulkSaveSummary): string {
  const parts: string[] = [`Saved ${s.saved}`];
  if (s.alreadySaved > 0) parts.push(`${s.alreadySaved} already in Vault`);
  if (s.failed > 0) parts.push(`${s.failed} failed`);
  return parts.join(", ");
}
