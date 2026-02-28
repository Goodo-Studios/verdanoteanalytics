import { type ColumnDef } from "@/components/ColumnPicker";

export const TABLE_COLUMNS: ColumnDef[] = [
  // Core
  { key: "creative", label: "Creative", defaultVisible: true, group: "Core" },
  { key: "grade", label: "Grade", defaultVisible: false, group: "Core" },
  { key: "ad_status", label: "Delivery Status", defaultVisible: false, group: "Core" },
  { key: "result_type", label: "Result Type", defaultVisible: false, group: "Core" },
  // Tags
  { key: "type", label: "Type", defaultVisible: false, group: "Tags" },
  { key: "person", label: "Person", defaultVisible: false, group: "Tags" },
  { key: "style", label: "Style", defaultVisible: false, group: "Tags" },
  { key: "hook", label: "Hook", defaultVisible: false, group: "Tags" },
  { key: "product", label: "Product", defaultVisible: false, group: "Tags" },
  { key: "theme", label: "Theme", defaultVisible: false, group: "Tags" },
  { key: "tags", label: "Tag Source", defaultVisible: false, group: "Tags" },
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
  // Commerce
  { key: "purchases", label: "Results (Purchases)", defaultVisible: false, group: "Commerce" },
  { key: "purchase_value", label: "Purchase Value", defaultVisible: false, group: "Commerce" },
  { key: "adds_to_cart", label: "Adds to Cart", defaultVisible: false, group: "Commerce" },
  { key: "cost_per_atc", label: "Cost per Add to Cart", defaultVisible: false, group: "Commerce" },
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
  purchases: "Purchases", purchase_value: "Purchase Value",
  adds_to_cart: "Adds to Cart", cost_per_atc: "Cost/ATC",
  campaign: "Campaign", adset: "Ad Set",
};

export const NUMERIC_COLS = new Set([
  "spend", "roas", "cpa", "ctr", "impressions", "clicks", "purchases",
  "purchase_value", "cpm", "cpc", "frequency", "cpmr", "video_views",
  "hook_rate", "hold_rate", "video_avg_play_time", "adds_to_cart", "cost_per_atc",
]);

/** Columns hidden on mobile (< 640px) to keep table scannable. Keep: creative, roas, spend */
export const MOBILE_HIDDEN_COLS = new Set([
  "cpa", "cpm", "cpc", "frequency", "cpmr", "ctr", "hook_rate", "hold_rate",
  "impressions", "clicks", "purchases", "purchase_value", "video_views", "score",
  "video_avg_play_time", "adds_to_cart", "cost_per_atc", "grade",
  "tags", "type", "person", "style", "hook", "product", "theme",
  "campaign", "adset", "ad_status", "result_type",
]);

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
  purchases:      { field: "purchases", format: { decimals: 0 } },
  purchase_value: { field: "purchase_value", format: { prefix: "$" } },
  adds_to_cart:   { field: "adds_to_cart", format: { decimals: 0 } },
  cost_per_atc:   { field: "cost_per_add_to_cart", format: { prefix: "$" } },
};
