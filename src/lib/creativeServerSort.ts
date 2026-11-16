/**
 * Which Creatives table columns the server sorts (audit plan item 7.1, part 1).
 *
 * creatives_list_page orders the whole filtered set before paging, so sorting by these
 * columns is correct across every page. Grades come from the server too (7.1 part 2); CPMr
 * is still worked out in the browser and sorts only the loaded page.
 */
import { SORT_FIELD_MAP } from "@/components/creatives/constants";
import type { SortConfig } from "@/components/SortableTableHead";

/** Fields creatives_list_page accepts as p_sort. Keep in step with the migration's whitelist. */
export const SERVER_SORT_FIELDS: ReadonlySet<string> = new Set([
  "grade", "spend", "roas", "cpa", "ctr", "cpm", "cpc", "purchases", "purchase_value",
  "impressions", "clicks", "adds_to_cart", "cost_per_add_to_cart", "video_views",
  "thumb_stop_rate", "hold_rate", "frequency", "video_avg_play_time",
  "retention_p25", "retention_p50", "retention_p75", "retention_p100",
  "ad_name", "ad_type", "ad_status", "person", "style", "hook", "product", "theme",
  "campaign_name", "adset_name",
]);

function serverField(sort: SortConfig): string | null {
  if (!sort.key || !sort.direction) return null;
  // The grade column maps to the local "_grade" key; the server sorts it as "grade" (7.1 part 2).
  const mapped = SORT_FIELD_MAP[sort.key] ?? sort.key;
  const field = mapped === "_grade" ? "grade" : mapped;
  return SERVER_SORT_FIELDS.has(field) ? field : null;
}

export function isServerSorted(sort: SortConfig): boolean {
  return serverField(sort) !== null;
}

/** Query params for GET /creatives; empty when the column is sorted in the browser. */
export function serverSortParams(sort: SortConfig): { sort?: string; sort_dir?: string } {
  const field = serverField(sort);
  return field ? { sort: field, sort_dir: sort.direction === "asc" ? "asc" : "desc" } : {};
}
