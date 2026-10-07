// US-044 acceptance at the deployed API boundary. This intentionally binds
// the real withApiAuth composition over loopback; it does not call handleApi.
// All rows are synthetic local fixture data and contain no production tagging.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
Deno.env.set("API_NO_SERVE", "1");
Deno.env.set("API_RATE_LIMIT", "1");
Deno.env.set("API_RATE_LIMIT_WINDOW_SECONDS", "30");
const { createApiHttpHandler } = await import("./index.ts");

type Row = Record<string, unknown>;
type Fixture = ReturnType<typeof makeFixture>;

async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function makeFixture() {
  const rows: Record<string, Row[]> = {
    api_keys: [],
    user_accounts: [
      { user_id: "client-a", account_id: "acct-a" },
      { user_id: "client-b", account_id: "acct-b" },
    ],
    ad_accounts: [
      {
        id: "acct-a",
        attribution_model: "last_touch",
        click_window: 7,
        view_window: 1,
        last_synced_at: "2026-10-07T00:00:00.000Z",
      },
      {
        id: "acct-b",
        attribution_model: "last_touch",
        click_window: 7,
        view_window: 1,
        last_synced_at: "2026-10-07T00:00:00.000Z",
      },
    ],
    creatives: [
      {
        ad_id: "ad-a",
        account_id: "acct-a",
        ad_name: "Fixture creative A",
        unique_code: "fixture-a",
        ad_status: "ACTIVE",
        updated_at: "2026-10-07T00:00:00.000Z",
        created_at: "2026-10-01T00:00:00.000Z",
      },
      {
        ad_id: "ad-b",
        account_id: "acct-b",
        ad_name: "Fixture creative B",
        unique_code: "fixture-b",
        ad_status: "ACTIVE",
        updated_at: "2026-10-07T00:00:00.000Z",
        created_at: "2026-10-01T00:00:00.000Z",
      },
    ],
    name_mappings: [
      {
        id: "mapping-a",
        account_id: "acct-a",
        unique_code: "fixture-a",
        updated_at: "2026-10-07T00:00:00.000Z",
      },
      {
        id: "mapping-b",
        account_id: "acct-b",
        unique_code: "fixture-b",
        updated_at: "2026-10-07T00:00:00.000Z",
      },
    ],
    creative_daily_metrics: [
      {
        account_id: "acct-a",
        ad_id: "ad-a",
        date: "2026-10-06",
        spend: 10,
        impressions: 100,
        clicks: 5,
        purchases: 1,
        purchase_value: 20,
        created_at: "2026-10-07T00:00:00.000Z",
      },
      {
        account_id: "acct-a",
        ad_id: "ad-a",
        date: "2026-10-07",
        spend: 12,
        impressions: 120,
        clicks: 6,
        purchases: 2,
        purchase_value: 30,
        created_at: "2026-10-07T00:00:00.000Z",
      },
      {
        account_id: "acct-b",
        ad_id: "ad-b",
        date: "2026-10-07",
        spend: 99,
        impressions: 999,
        clicks: 99,
        purchases: 9,
        purchase_value: 199,
        created_at: "2026-10-07T00:00:00.000Z",
      },
    ],
  };
  const roles: Record<string, string> = {
    "client-a": "client",
    "client-b": "client",
    "staff-1": "employee",
  };
  let rateLimited = false;
  const matches = (row: Row, filters: Array<[string, string, unknown]>) =>
    filters.every(([op, key, value]) => {
      if (op === "eq") return row[key] === value;
      if (op === "in") return (value as unknown[]).includes(row[key]);
      if (op === "gte") return String(row[key]) >= String(value);
      if (op === "lte") return String(row[key]) <= String(value);
      return true;
    });
  const client = {
    from(table: string) {
      const filters: Array<[string, string, unknown]> = [];
      let selected: string | undefined;
      let offset = 0;
      let end = Number.MAX_SAFE_INTEGER;
      const query: Record<string, unknown> = {};
      query.select = (columns?: string) => {
        selected = columns;
        return query;
      };
      query.eq = (key: string, value: unknown) => {
        filters.push(["eq", key, value]);
        return query;
      };
      query.in = (key: string, value: unknown[]) => {
        filters.push(["in", key, value]);
        return query;
      };
      query.gte = (key: string, value: unknown) => {
        filters.push(["gte", key, value]);
        return query;
      };
      query.lte = (key: string, value: unknown) => {
        filters.push(["lte", key, value]);
        return query;
      };
      query.order = (_key: string, _opts?: unknown) => query;
      query.limit = (count: number) => {
        end = offset + count;
        return query;
      };
      query.range = (start: number, finish: number) => {
        offset = start;
        end = finish + 1;
        return query;
      };
      query.update = (patch: Row) => {
        query.__patch = patch;
        return query;
      };
      query.then = (resolve: (value: unknown) => void) => {
        let result = (rows[table] ?? []).filter((row) => matches(row, filters));
        const patch = query.__patch as Row | undefined;
        if (patch) result.forEach((row) => Object.assign(row, patch));
        if (table === "api_keys" && patch) {
          resolve({ data: result, error: null });
          return;
        }
        result = result.slice(offset, end);
        if (selected && selected !== "*") {
          const fields = selected.split(",").map((field) => field.trim());
          result = result.map((row) =>
            Object.fromEntries(fields.map((field) => [field, row[field]]))
          );
        }
        resolve({ data: result, error: null });
      };
      query.maybeSingle = () =>
        Promise.resolve({
          data: (rows[table] ?? []).filter((row) => matches(row, filters))[0] ??
            null,
          error: null,
        });
      query.single = () => {
        const data =
          (rows[table] ?? []).filter((row) => matches(row, filters))[0] ?? null;
        return Promise.resolve(
          data
            ? { data, error: null }
            : { data: null, error: { message: "not found" } },
        );
      };
      return query;
    },
    rpc(name: string, args: Row) {
      if (name === "get_user_role") {
        return Promise.resolve({
          data: roles[String(args._user_id)] ?? null,
          error: null,
        });
      }
      if (name === "check_api_rate_limit") {
        return Promise.resolve({ data: rateLimited, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return {
    client,
    rows,
    roles,
    setRateLimited(value: boolean) {
      rateLimited = value;
    },
  };
}

async function addKey(
  fixture: Fixture,
  raw: string,
  id: string,
  userId: string,
  permissions: string[],
  active = true,
  expiresAt: string | null = null,
) {
  fixture.rows.api_keys.push({
    id,
    key_hash: await hash(raw),
    user_id: userId,
    permissions,
    is_active: active,
    expires_at: expiresAt,
  });
}

async function start(fixture: Fixture) {
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0 },
    createApiHttpHandler(fixture.client),
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  const addr = server.addr as Deno.NetAddr;
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

Deno.test("US044 real HTTP enforces key, scope, ownership, rate, and paged daily values", async () => {
  const fixture = makeFixture();
  await addKey(fixture, "client-key", "key-client", "client-a", ["read"]);
  await addKey(fixture, "no-read-key", "key-no-read", "client-a", ["write"]);
  await addKey(
    fixture,
    "revoked-key",
    "key-revoked",
    "client-a",
    ["read"],
    false,
  );
  await addKey(
    fixture,
    "expired-key",
    "key-expired",
    "client-a",
    ["read"],
    true,
    "2020-01-01T00:00:00.000Z",
  );
  const running = await start(fixture);
  try {
    const endpoint =
      `${running.url}/api/sprint-performance?account_id=acct-a&ad_id=ad-a&date_from=2026-10-06&date_to=2026-10-07&limit=1`;
    assertEquals((await fetch(endpoint)).status, 401);
    assertEquals(
      (await fetch(endpoint, { headers: { "x-api-key": "no-read-key" } }))
        .status,
      403,
    );
    assertEquals(
      (await fetch(endpoint, { headers: { "x-api-key": "revoked-key" } }))
        .status,
      401,
    );
    assertEquals(
      (await fetch(endpoint, { headers: { "x-api-key": "expired-key" } }))
        .status,
      401,
    );
    const first = await fetch(endpoint, {
      headers: { Authorization: "Bearer client-key" },
    });
    assertEquals(first.status, 200);
    const body = await first.json();
    assertEquals(body.page, {
      limit: 1,
      offset: 0,
      returned: 1,
      requested: 1,
      has_more: false,
      next_cursor: null,
      empty: false,
      partial: false,
    });
    assertEquals(body.data[0].ad_id, "ad-a");
    assertEquals(body.data[0].metrics.spend, 22);
    assertEquals(body.data[0].metrics.purchase_value, 50);
    const accountResponse = await fetch(`${running.url}/api/accounts`, {
      headers: { "x-api-key": "client-key" },
    });
    assertEquals(accountResponse.status, 200);
    assertEquals(
      (await accountResponse.json()).data.map((row: Row) => row.id),
      ["acct-a"],
    );
    assertEquals(
      (await fetch(
        `${running.url}/api/sprint-performance?account_id=acct-b&ad_id=ad-b&date_from=2026-10-07&date_to=2026-10-07`,
        { headers: { "x-api-key": "client-key" } },
      )).status,
      403,
    );
    fixture.setRateLimited(true);
    const limited = await fetch(endpoint, {
      headers: { "x-api-key": "client-key" },
    });
    assertEquals(limited.status, 429);
    assertEquals(limited.headers.get("retry-after"), "30");
  } finally {
    await running.server.shutdown();
  }
});
