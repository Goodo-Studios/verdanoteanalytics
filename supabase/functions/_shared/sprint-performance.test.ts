import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pageSprintRows, parseSprintQuery, shapeSprintRow, type SprintCreativeRow, type SprintMappingRow, type SprintDailyRow, type SprintAccountSettings } from "./sprint-performance.ts";

const creative = (adId: string, code: string): SprintCreativeRow => ({
  ad_id: adId,
  account_id: "acct-1",
  ad_name: `Ad ${adId}`,
  unique_code: code,
  ad_status: "ACTIVE",
  updated_at: "2026-10-07T10:00:00.000Z",
  created_at: "2026-10-01T10:00:00.000Z",
});

const daily: SprintDailyRow[] = [{ ad_id: "ad-1", date: "2026-10-07", spend: 12.5, impressions: 100, clicks: 4, purchases: 1, purchase_value: 25, created_at: "2026-10-07T10:00:00.000Z" }];
const settings: SprintAccountSettings = { attribution_model: "last_touch", click_window: 7, view_window: 1, last_synced_at: "2026-10-07T11:00:00.000Z" };

const mapping = (code: string): SprintMappingRow => ({
  id: `mapping-${code}`,
  account_id: "acct-1",
  unique_code: code,
  updated_at: "2026-10-07T09:00:00.000Z",
});

Deno.test("US044 query parsing requires exact account and one or more ad IDs", () => {
  assertEquals(parseSprintQuery(new URL("https://fn.local/api/sprint-performance")), { error: "account_id is required" });
  assertEquals(parseSprintQuery(new URL("https://fn.local/api/sprint-performance?account_id=acct-1")), { error: "ad_id is required" });
  assertEquals(parseSprintQuery(new URL("https://fn.local/api/sprint-performance?account_id=acct-1&ad_id=a&ad_id=a&ad_ids=b&date_from=2026-10-07&date_to=2026-10-07&limit=2&cursor=3")), {
    accountId: "acct-1",
    adIds: ["a", "b"],
    limit: 2,
    offset: 3,
    dateFrom: "2026-10-07",
    dateTo: "2026-10-07",
  });
  assertEquals(parseSprintQuery(new URL("https://fn.local/api/sprint-performance?account_id=acct-1&ad_id=all&date_from=2026-10-07&date_to=2026-10-07")), { error: "ad_id must identify explicit ads" });
});

Deno.test("US044 page contract makes empty and partial pages explicit", () => {
  const rows = [shapeSprintRow(creative("a", "A"), mapping("A"), daily, settings, "2026-10-07", "2026-10-07"), shapeSprintRow(creative("b", "B"), mapping("B"), daily, settings, "2026-10-07", "2026-10-07")];
  assertEquals(pageSprintRows(rows, "acct-1", 2, 1, 0).page, {
    limit: 1,
    offset: 0,
    returned: 1,
    requested: 2,
    has_more: true,
    next_cursor: "1",
    empty: false,
    partial: true,
  });
  assertEquals(pageSprintRows(rows, "acct-1", 2, 2, 2).page, {
    limit: 2,
    offset: 2,
    returned: 0,
    requested: 2,
    has_more: false,
    next_cursor: null,
    empty: true,
    partial: false,
  });
});

Deno.test("US044 shaped rows retain source timestamps and mapping attribution", () => {
  const row = shapeSprintRow(creative("ad-1", "CODE-1"), mapping("CODE-1"), daily, settings, "2026-10-07", "2026-10-07");
  assertEquals(row.account_id, "acct-1");
  assertEquals(row.metrics.cpa, 12.5);
  assertEquals(row.attribution, {
    source: "verdanote",
    account_id: "acct-1",
    mapping_id: "mapping-CODE-1",
    unique_code: "CODE-1",
    observed_at: "2026-10-07T10:00:00.000Z",
    creative_updated_at: "2026-10-07T10:00:00.000Z",
    mapping_updated_at: "2026-10-07T09:00:00.000Z",
    date_from: "2026-10-07",
    date_to: "2026-10-07",
    attribution_model: "last_touch",
    click_window: 7,
    view_window: 1,
    last_synced_at: "2026-10-07T11:00:00.000Z",
    observations: 1,
    expected_observations: 1,
    complete: true,
  });
});
