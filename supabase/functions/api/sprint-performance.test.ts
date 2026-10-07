import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("API_NO_SERVE", "1");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-role");
const { handleApi } = await import("./index.ts");

type Row = Record<string, unknown>;

function makeSupabase(opts: { role?: string; linked?: boolean; creatives?: Row[]; mappings?: Row[]; daily?: Row[]; providerCreative?: Row } = {}) {
  const tables: Record<string, Row[]> = {
    ad_accounts: [{ id: "acct-1", attribution_model: "last_touch", click_window: 7, view_window: 1, last_synced_at: "2026-10-07T11:00:00.000Z" }],
    creatives: opts.creatives ?? [],
    name_mappings: opts.mappings ?? [],
    creative_daily_metrics: opts.daily ?? [{ ad_id: "ad-1", date: "2026-10-07", spend: 20, impressions: 100, clicks: 5, purchases: 1, purchase_value: 40, created_at: "2026-10-07T10:00:00.000Z" }, { ad_id: "ad-2", date: "2026-10-07", spend: 20, impressions: 100, clicks: 5, purchases: 1, purchase_value: 40, created_at: "2026-10-07T10:00:00.000Z" }],
  };
  const builder: Record<string, unknown> = {};
  let table = "";
  for (const method of ["select", "eq", "in", "order", "range", "limit", "gte", "lte"]) {
    builder[method] = (..._args: unknown[]) => builder;
  }
  builder.maybeSingle = () => Promise.resolve({ data: table === "creatives" ? (opts.providerCreative ?? null) : opts.linked ? { "1": 1 } : null, error: null });
  builder.then = (resolve: (value: unknown) => void) => resolve({ data: tables[table] ?? [], error: null });
  return {
    from(name: string) {
      table = name;
      return builder;
    },
    rpc(name: string) {
      if (name === "get_user_role") return Promise.resolve({ data: opts.role ?? "builder", error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
}

const request = (path: string, method = "GET", body?: unknown) => new Request(`https://fn.local${path}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
const READ = { userId: "user-1", permissions: ["read"] };

const creative = (adId: string, code: string): Row => ({
  ad_id: adId,
  account_id: "acct-1",
  ad_name: `Ad ${adId}`,
  unique_code: code,
  spend: 20,
  roas: 2,
  ctr: 1,
  cpa: 4,
  cpm: 5,
  clicks: 5,
  impressions: 100,
  purchases: 1,
  purchase_value: 40,
  ad_status: "ACTIVE",
  updated_at: "2026-10-07T10:00:00.000Z",
  created_at: "2026-10-01T10:00:00.000Z",
});

Deno.test("US044 rejects an unlinked account before reading creatives", async () => {
  const response = await handleApi(request("/api/sprint-performance?account_id=acct-1&ad_id=ad-1&date_from=2026-10-07&date_to=2026-10-07"), makeSupabase({ role: "client", linked: false }), READ);
  assertEquals(response.status, 403);
  assertEquals(await response.json(), { error: "Access denied" });
});

Deno.test("US044 returns only fully verified, account-scoped mappings with page metadata", async () => {
  const response = await handleApi(
    request("/api/sprint-performance?account_id=acct-1&ad_id=ad-1&ad_id=ad-2&date_from=2026-10-07&date_to=2026-10-07&limit=1"),
    makeSupabase({
      creatives: [creative("ad-1", "CODE-1"), creative("ad-2", "CODE-2")],
      mappings: [
        { id: "map-1", account_id: "acct-1", unique_code: "CODE-1", updated_at: "2026-10-07T09:00:00.000Z" },
        { id: "map-2", account_id: "acct-1", unique_code: "CODE-2", updated_at: "2026-10-07T09:00:00.000Z" },
      ],
    }),
    READ,
  );
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.account_id, "acct-1");
  assertEquals(body.data.length, 1);
  assertEquals(body.data[0].attribution.mapping_id, "map-1");
  assertEquals(body.page, { limit: 1, offset: 0, returned: 1, requested: 2, has_more: true, next_cursor: "1", empty: false, partial: true });
});

Deno.test("US044 refuses a partial mapping set instead of returning misleading metrics", async () => {
  const response = await handleApi(
    request("/api/sprint-performance?account_id=acct-1&ad_id=ad-1&ad_id=ad-2&date_from=2026-10-07&date_to=2026-10-07"),
    makeSupabase({ creatives: [creative("ad-1", "CODE-1"), creative("ad-2", "CODE-2")], mappings: [{ id: "map-1", account_id: "acct-1", unique_code: "CODE-1", updated_at: "2026-10-07T09:00:00.000Z" }] }),
    READ,
  );
  assertEquals(response.status, 409);
  assertEquals(await response.json(), { error: "Every requested ad must have a verified mapping" });
});

Deno.test("US044 server-owned resolver proves only the account/ad provider tuple", async () => {
  const response = await handleApi(request("/api/workspace/asset-ad-mappings/resolve", "POST", { accountId: "acct-1", adId: "ad-1", adName: "Ad ad-1" }), makeSupabase({ providerCreative: { account_id: "acct-1", ad_id: "ad-1", ad_name: "Ad ad-1", updated_at: "2026-10-07T10:00:00.000Z", ad_status: "ACTIVE" } }), READ);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { accountId: "acct-1", adId: "ad-1", adName: "Ad ad-1", sourceProvider: "verdanote", sourceRecordId: "ad-1", sourceVersion: 1791367200, state: "confirmed", evidenceAt: "2026-10-07T10:00:00.000Z", expiresAt: null });
});
