import { type ColumnDef } from "@/components/ColumnPicker";

export const TABLE_COLUMNS: ColumnDef[] = [
  // Core
  { key: "creative", label: "Creative", defaultVisible: true, group: "Core" },
  { key: "grade", label: "Grade", defaultVisible: false, group: "Core" },
  { key: "ad_status", label: "Delivery Status", defaultVisible: false, group: "Core" },
  { key: "result_type", label: "Result Type", defaultVisible: false, group: "Core" },
  // Performance
  { key: "spend", label: "Spent", defaultVisible: true, group: "Performance" },
  { key: "cpa", label: "Cost/Result", defaultVisible: true, group: "Performance" },
  { key: "cpm", label: "CPM", defaultVisible: true, group: "Performance" },
  { key: "cpc", label: "CPC", defaultVisible: true, group: "Performance" },
  { key: "frequency", label: "Frequency", defaultVisible: true, group: "Performance" },
  { key: "cpmr", label: "CPMr", defaultVisible: true, group: "Performance" },
  { key: "roas", label: "Purchase ROAS", defaultVisible: false, group: "Performance" },
  // Engagement
  { key: "ctr", label: "Unique CTR", defaultVisible: true, group: "Engagement" },
  { key: "hook_rate", label: "Hook Rate", defaultVisible: true, group: "Engagement" },
  { key: "hold_rate", label: "Hold Rate", defaultVisible: true, group: "Engagement" },
  { key: "impressions", label: "Impressions", defaultVisible: false, group: "Engagement" },
  { key: "clicks", label: "Clicks", defaultVisible: false, group: "Engagement" },
  { key: "video_views", label: "Video Views", defaultVisible: false, group: "Engagement" },
  { key: "video_avg_play_time", label: "Video Avg Play Time", defaultVisible: false, group: "Engagement" },
  { key: "retention_p25", label: "Retention @25%", defaultVisible: false, group: "Engagement" },
  { key: "retention_p50", label: "Retention @50%", defaultVisible: true, group: "Engagement" },
  { key: "retention_p75", label: "Retention @75%", defaultVisible: false, group: "Engagement" },
  { key: "retention_p100", label: "Retention @100%", defaultVisible: true, group: "Engagement" },
  // Commerce
  { key: "purchases", label: "Results (Purchases)", defaultVisible: false, group: "Commerce" },
  { key: "purchase_value", label: "Purchase Value", defaultVisible: false, group: "Commerce" },
  { key: "adds_to_cart", label: "Adds to Cart", defaultVisible: false, group: "Commerce" },
  { key: "cost_per_atc", label: "Cost per Add to Cart", defaultVisible: false, group: "Commerce" },
  // Tags
  { key: "type", label: "Type", defaultVisible: false, group: "Tags" },
  { key: "person", label: "Person", defaultVisible: false, group: "Tags" },
  { key: "style", label: "Style", defaultVisible: false, group: "Tags" },
  { key: "hook", label: "Hook", defaultVisible: false, group: "Tags" },
  { key: "product", label: "Product", defaultVisible: false, group: "Tags" },
  { key: "theme", label: "Theme", defaultVisible: false, group: "Tags" },
  { key: "tags", label: "Tag Source", defaultVisible: false, group: "Tags" },
  // Context
  { key: "campaign", label: "Campaign", defaultVisible: false, group: "Context" },
  { key: "adset", label: "Ad Set", defaultVisible: false, group: "Context" },
];

export const GROUP_BY_OPTIONS = [
  { value: "__none__", label: "No grouping" },
  { value: "ad_type", label: "Type" },
  { value: "person", label: "Person" },
  { value: "style", label: "Style" },
  { value: "hook", label: "Hook" },
  { value: "product", label: "Product" },
  { value: "theme", label: "Theme" },
];

export const SORT_FIELD_MAP: Record<string, string> = {
  creative: "ad_name", type: "ad_type", person: "person", style: "style", hook: "hook",
  product: "product", theme: "theme",
  spend: "spend", roas: "roas", cpa: "cpa", ctr: "ctr", impressions: "impressions",
  clicks: "clicks", purchases: "purchases", purchase_value: "purchase_value",
  cpm: "cpm", cpc: "cpc", frequency: "frequency",
  hook_rate: "thumb_stop_rate", hold_rate: "hold_rate",
  video_views: "video_views", video_avg_play_time: "video_avg_play_time",
  retention_p25: "retention_p25", retention_p50: "retention_p50",
  retention_p75: "retention_p75", retention_p100: "retention_p100",
  adds_to_cart: "adds_to_cart", cost_per_atc: "cost_per_add_to_cart",
  result_type: "result_type", cpmr: "_cpmr",
  campaign: "campaign_name", adset: "adset_name", ad_status: "ad_status",
  grade: "_grade",
};

export const HEAD_LABELS: Record<string, string> = {
  creative: "Creative", grade: "Grade", ad_status: "Status", result_type: "Result Type",
  type: "Type", person: "Person", style: "Style", hook: "Hook",
  product: "Product", theme: "Theme", tags: "Tags",
  spend: "Spent", roas: "ROAS", cpa: "Cost/Result", cpm: "CPM",
  cpc: "CPC", frequency: "Frequency", cpmr: "CPMr",
  ctr: "Unique CTR", impressions: "Impressions", clicks: "Clicks",
  hook_rate: "Hook Rate", hold_rate: "Hold Rate",
  video_views: "Video Views", video_avg_play_time: "Avg Play Time",
  retention_p25: "Ret @25%", retention_p50: "Ret @50%",
  retention_p75: "Ret @75%", retention_p100: "Ret @100%",
  purchases: "Purchases", purchase_value: "Purchase Value",
  adds_to_cart: "Adds to Cart", cost_per_atc: "Cost/ATC",
  campaign: "Campaign", adset: "Ad Set",
};

export const NUMERIC_COLS = new Set([
  "spend", "roas", "cpa", "ctr", "impressions", "clicks", "purchases",
  "purchase_value", "cpm", "cpc", "frequency", "cpmr", "video_views",
  "hook_rate", "hold_rate", "video_avg_play_time", "adds_to_cart", "cost_per_atc",
  "retention_p25", "retention_p50", "retention_p75", "retention_p100",
]);

/** Columns hidden on mobile (< 640px) to keep table scannable. Keep: creative, roas, spend */
export const MOBILE_HIDDEN_COLS = new Set([
  "cpa", "cpm", "cpc", "frequency", "cpmr", "ctr", "hook_rate", "hold_rate",
  "impressions", "clicks", "purchases", "purchase_value", "video_views", "score",
  "video_avg_play_time", "adds_to_cart", "cost_per_atc", "grade",
  "retention_p25", "retention_p50", "retention_p75", "retention_p100",
  "tags", "type", "person", "style", "hook", "product", "theme",
  "campaign", "adset", "ad_status", "result_type",
]);

/**
 * Shared comparator for the creatives table's numeric/string columns.
 *
 * Resolves the data field via SORT_FIELD_MAP, then compares. Null/undefined
 * values (non-video or not-yet-backfilled creatives, e.g. retention_p25..p100)
 * always sort LAST regardless of direction — they are NOT treated as 0, which
 * would mislead a retention ranking. Numeric fields compare numerically;
 * everything else falls back to a locale string compare.
 */
export const compareCreativesBy = (
  a: any,
  b: any,
  sortKey: string,
  direction: "asc" | "desc",
) => {
  const field = SORT_FIELD_MAP[sortKey] || sortKey;
  const dir = direction === "asc" ? 1 : -1;
  const va = a[field], vb = b[field];
  if (va == null && vb == null) return 0;
  if (va == null) return 1;  // nulls last, regardless of direction
  if (vb == null) return -1; // nulls last, regardless of direction
  if (typeof va === "number" || !isNaN(Number(va))) return (Number(va) - Number(vb)) * dir;
  return String(va).localeCompare(String(vb)) * dir;
};

export const fmt = (v: number | null | undefined, prefix = "", suffix = "", decimals = 2) => {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (isNaN(n)) return "—";
  return `${prefix}${n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;
};

// Data-driven cell configuration for CreativesTable
interface CellCfg {
  field: string;
  format?: { prefix?: string; suffix?: string; decimals?: number };
  truncate?: boolean;
}

export const CELL_CONFIG: Record<string, CellCfg> = {
  ad_status:   { field: "ad_status" },
  result_type: { field: "result_type" },
  product:     { field: "product", truncate: true },
  theme:       { field: "theme", truncate: true },
  campaign:    { field: "campaign_name", truncate: true },
  adset:       { field: "adset_name", truncate: true },
  spend:       { field: "spend", format: { prefix: "$" } },
  roas:        { field: "roas", format: { suffix: "x" } },
  cpa:         { field: "cpa", format: { prefix: "$" } },
  cpm:         { field: "cpm", format: { prefix: "$" } },
  cpc:         { field: "cpc", format: { prefix: "$" } },
  frequency:   { field: "frequency", format: { decimals: 1 } },
  cpmr:        { field: "_cpmr", format: { prefix: "$" } },
  ctr:         { field: "ctr", format: { suffix: "%" } },
  impressions: { field: "impressions", format: { decimals: 0 } },
  clicks:      { field: "clicks", format: { decimals: 0 } },
  hook_rate:   { field: "thumb_stop_rate", format: { suffix: "%" } },
  hold_rate:   { field: "hold_rate", format: { suffix: "%" } },
  video_views: { field: "video_views", format: { decimals: 0 } },
  video_avg_play_time: { field: "video_avg_play_time", format: { suffix: "s", decimals: 1 } },
  retention_p25:  { field: "retention_p25", format: { suffix: "%", decimals: 0 } },
  retention_p50:  { field: "retention_p50", format: { suffix: "%", decimals: 0 } },
  retention_p75:  { field: "retention_p75", format: { suffix: "%", decimals: 0 } },
  retention_p100: { field: "retention_p100", format: { suffix: "%", decimals: 0 } },
  purchases:      { field: "purchases", format: { decimals: 0 } },
  purchase_value: { field: "purchase_value", format: { prefix: "$" } },
  adds_to_cart:   { field: "adds_to_cart", format: { decimals: 0 } },
  cost_per_atc:   { field: "cost_per_add_to_cart", format: { prefix: "$" } },
};
