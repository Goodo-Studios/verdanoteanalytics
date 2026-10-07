/** Pure request parsing and response shaping for US044 scoped performance. */

export const MAX_REQUESTED_ADS = 1000;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
export const MAX_WINDOW_DAYS = 366;

export interface SprintQuery {
  accountId: string;
  adIds: string[];
  limit: number;
  offset: number;
  dateFrom: string;
  dateTo: string;
}

export interface SprintCreativeRow {
  ad_id: string;
  account_id: string;
  ad_name: string;
  unique_code: string | null;
  updated_at: string;
  created_at: string;
  ad_status: string | null;
}

export interface SprintDailyRow {
  ad_id: string;
  date: string;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  purchases: number | null;
  purchase_value: number | null;
  created_at: string;
}

export interface SprintMappingRow {
  id: string;
  account_id: string;
  unique_code: string;
  updated_at: string;
}

export interface SprintAccountSettings {
  attribution_model: string | null;
  click_window: number | null;
  view_window: number | null;
  last_synced_at: string | null;
}

export interface SprintPerformanceRow {
  ad_id: string;
  ad_name: string;
  account_id: string;
  metrics: {
    spend: number | null;
    roas: number | null;
    ctr: number | null;
    cpa: number | null;
    cpm: number | null;
    clicks: number | null;
    impressions: number | null;
    purchases: number | null;
    purchase_value: number | null;
  };
  attribution: {
    source: "verdanote";
    account_id: string;
    mapping_id: string;
    unique_code: string;
    observed_at: string;
    creative_updated_at: string;
    mapping_updated_at: string;
    date_from: string;
    date_to: string;
    attribution_model: string | null;
    click_window: number | null;
    view_window: number | null;
    last_synced_at: string | null;
    observations: number;
    expected_observations: number;
    complete: boolean;
  };
  status: string | null;
}

export interface SprintPage<T> {
  account_id: string;
  data: T[];
  page: { limit: number; offset: number; returned: number; requested: number; has_more: boolean; next_cursor: string | null; empty: boolean; partial: boolean };
}

export function parseSprintQuery(url: URL): SprintQuery | { error: string } {
  const accountId = url.searchParams.get("account_id")?.trim() ?? "";
  if (!accountId) return { error: "account_id is required" };
  const adIds = [...url.searchParams.getAll("ad_id"), ...(url.searchParams.get("ad_ids")?.split(",") ?? [])].map((value) => value.trim()).filter(Boolean);
  const uniqueAdIds = [...new Set(adIds)];
  if (uniqueAdIds.length === 0) return { error: "ad_id is required" };
  if (uniqueAdIds.includes("all")) return { error: "ad_id must identify explicit ads" };
  if (uniqueAdIds.length > MAX_REQUESTED_ADS) return { error: `at most ${MAX_REQUESTED_ADS} ad_ids may be requested` };
  const dateFrom = url.searchParams.get("date_from")?.trim() ?? "";
  const dateTo = url.searchParams.get("date_to")?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo) || dateFrom > dateTo) return { error: "date_from and date_to must be ordered YYYY-MM-DD dates" };
  const windowDays = Math.floor((Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86400000) + 1;
  if (windowDays < 1 || windowDays > MAX_WINDOW_DAYS) return { error: `date range must be from 1 to ${MAX_WINDOW_DAYS} days` };
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? DEFAULT_PAGE_SIZE : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) return { error: `limit must be an integer from 1 to ${MAX_PAGE_SIZE}` };
  const rawCursor = url.searchParams.get("cursor");
  const offset = rawCursor === null || rawCursor === "" ? 0 : Number(rawCursor);
  if (!Number.isSafeInteger(offset) || offset < 0) return { error: "cursor must be a non-negative integer" };
  return { accountId, adIds: uniqueAdIds, limit, offset, dateFrom, dateTo };
}

function finite(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function shapeSprintRow(creative: SprintCreativeRow, mapping: SprintMappingRow, daily: SprintDailyRow[], settings: SprintAccountSettings, dateFrom: string, dateTo: string): SprintPerformanceRow {
  const sum = (field: keyof SprintDailyRow): number | null => {
    const values = daily.map((row) => row[field]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  };
  const spend = sum("spend");
  const impressions = sum("impressions");
  const clicks = sum("clicks");
  const purchases = sum("purchases");
  const purchaseValue = sum("purchase_value");
  const roas = spend !== null && spend > 0 && purchaseValue !== null ? purchaseValue / spend : null;
  const ctr = impressions !== null && impressions > 0 && clicks !== null ? (clicks / impressions) * 100 : null;
  const cpa = purchases !== null && purchases > 0 && spend !== null ? spend / purchases : null;
  const cpm = impressions !== null && impressions > 0 && spend !== null ? (spend / impressions) * 1000 : null;
  const expectedObservations = Math.floor((Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86400000) + 1;
  return {
    ad_id: creative.ad_id, ad_name: creative.ad_name, account_id: creative.account_id,
    metrics: { spend: finite(spend), roas: finite(roas), ctr: finite(ctr), cpa: finite(cpa), cpm: finite(cpm), clicks: finite(clicks), impressions: finite(impressions), purchases: finite(purchases), purchase_value: finite(purchaseValue) },
    attribution: {
      source: "verdanote", account_id: creative.account_id, mapping_id: mapping.id, unique_code: mapping.unique_code,
      observed_at: creative.updated_at, creative_updated_at: creative.updated_at, mapping_updated_at: mapping.updated_at,
      date_from: dateFrom, date_to: dateTo, attribution_model: settings.attribution_model, click_window: settings.click_window,
      view_window: settings.view_window, last_synced_at: settings.last_synced_at, observations: daily.length,
      expected_observations: expectedObservations, complete: daily.length >= expectedObservations,
    },
    status: creative.ad_status,
  };
}

export function pageSprintRows(rows: SprintPerformanceRow[], accountId: string, requestedCount: number, limit: number, offset: number): SprintPage<SprintPerformanceRow> {
  const pageRows = rows.slice(offset, offset + limit);
  const hasMore = offset + pageRows.length < rows.length;
  return {
    account_id: accountId, data: pageRows,
    page: { limit, offset, returned: pageRows.length, requested: requestedCount, has_more: hasMore, next_cursor: hasMore ? String(offset + pageRows.length) : null, empty: pageRows.length === 0, partial: pageRows.length > 0 && pageRows.length < limit && offset + pageRows.length < requestedCount },
  };
}
