// Client for POST /creatives/sync-from-name (see the naming-convention contract).
//
// "Sync from name" re-reads the six tag columns from each ad's name and, after a
// preview, overwrites them — including manual tags. dry_run=true writes nothing
// and returns the before/after per ad; dry_run=false applies the same result and
// sets tag_source='parsed'.

import { apiFetch } from "@/lib/api";
import { TAG_FIELD_ORDER, TAG_FIELD_LABELS, type TagField } from "@/lib/tagDisplay";

/** The server rejects more than this many ids per call. */
export const SYNC_FROM_NAME_MAX_IDS = 500;

export type SyncTagValues = Record<TagField, string | null>;

export interface SyncFromNameChange {
  id: string;
  ad_name: string;
  before: SyncTagValues;
  after: SyncTagValues;
  changed: boolean;
}

export interface SyncFromNameResponse {
  changes: SyncFromNameChange[];
  applied: boolean;
}

/** One field that differs between before and after for an ad. */
export interface SyncFieldDiff {
  field: TagField;
  label: string;
  before: string | null;
  after: string | null;
}

export interface SyncAdPreview {
  id: string;
  ad_name: string;
  diffs: SyncFieldDiff[];
}

export interface SyncPreviewSummary {
  changed: SyncAdPreview[];
  unchangedCount: number;
  /** Requested ids the server did not return (not found / not accessible). */
  missingCount: number;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Call sync-from-name for any number of ids, splitting into ≤500-id requests.
 * Requests run sequentially so a failure stops the run with a clear error
 * rather than leaving an unknown mix of applied batches in flight.
 */
export async function syncFromName(ids: string[], dryRun: boolean): Promise<SyncFromNameResponse> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) throw new Error("No ads selected to sync.");
  const changes: SyncFromNameChange[] = [];
  let applied = !dryRun;
  const batches = chunk(unique, SYNC_FROM_NAME_MAX_IDS);
  for (let b = 0; b < batches.length; b++) {
    let resp: SyncFromNameResponse;
    try {
      resp = await apiFetch("creatives", "sync-from-name", {
        method: "POST",
        body: JSON.stringify({ ids: batches[b], dry_run: dryRun }),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const where = batches.length > 1 ? ` (batch ${b + 1} of ${batches.length}${!dryRun && b > 0 ? `; earlier batches were already applied` : ""})` : "";
      throw new Error(`Sync from name failed${where}: ${msg}`);
    }
    if (!resp || !Array.isArray(resp.changes)) {
      throw new Error("Sync from name returned an unexpected response.");
    }
    changes.push(...resp.changes);
    if (!dryRun) applied = applied && resp.applied === true;
  }
  return { changes, applied: dryRun ? false : applied };
}

const norm = (v: string | null | undefined) => {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length === 0 ? null : t;
};

/** Turn a dry-run response into per-ad field diffs + an unchanged count. */
export function summarizeSyncPreview(
  resp: SyncFromNameResponse,
  requestedCount?: number,
): SyncPreviewSummary {
  const changed: SyncAdPreview[] = [];
  let unchangedCount = 0;
  for (const c of resp.changes) {
    const diffs: SyncFieldDiff[] = [];
    for (const field of TAG_FIELD_ORDER) {
      const before = norm(c.before?.[field]);
      const after = norm(c.after?.[field]);
      if (before !== after) diffs.push({ field, label: TAG_FIELD_LABELS[field], before, after });
    }
    if (diffs.length > 0) changed.push({ id: c.id, ad_name: c.ad_name, diffs });
    else unchangedCount++;
  }
  const missingCount = requestedCount != null ? Math.max(0, requestedCount - resp.changes.length) : 0;
  return { changed, unchangedCount, missingCount };
}
