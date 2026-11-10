// Tests for the accounts edge function, GET path.
//
// No database and no network: the service-role client is a fake that records the
// column list of every ad_accounts select and returns full rows (every staff-only
// column filled in), so the test proves both walls:
//   * the client path asks the database for the allow-listed columns only
//   * the response carries the allow-listed fields only, even when the database
//     hands back more
// and that staff still get every column, a client sees only linked accounts, a
// client with no links gets an empty list, and no role or no login is refused.
//
//   deno test -A supabase/functions/accounts/index.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CLIENT_ACCOUNT_FIELDS,
  CLIENT_ACCOUNT_SELECT,
  STAFF_ONLY_ACCOUNT_FIELDS,
} from "../_shared/client-account-fields.ts";

Deno.env.set("ACCOUNTS_NO_SERVE", "1");
const { handler } = await import("./index.ts");

// A full ad_accounts row: every column from the migrations, staff-only ones filled.
function fullRow(id: string): Record<string, unknown> {
  return {
    id,
    name: `Account ${id}`,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    is_active: true,
    last_synced_at: "2026-11-10T00:00:00Z",
    last_data_sync: "2026-11-10T00:00:00Z",
    last_media_sync: "2026-11-10T00:00:00Z",
    last_full_sync_at: "2026-11-10T00:00:00Z",
    last_scheduled_report_at: null,
    next_sync_at: null,
    optimization_goal: "PURCHASE",
    winner_kpi: "roas",
    winner_kpi_direction: "gte",
    winner_kpi_threshold: 2,
    winner_roas_threshold: 2,
    iteration_spend_threshold: 50,
    date_range_days: 180,
    creative_count: 12,
    untagged_count: 3,
    logo_url: null,
    portfolio_enabled: false,
    portfolio_slug: null,
    portfolio_headline: null,
    portfolio_results: null,
    portfolio_cta_url: null,
    report_schedule: "none",
    sync_frequency: "manual",
    sync_hour: 2,
    sync_timezone: "America/New_York",
    click_window: 7,
    view_window: 1,
    daily_backfilled_since: null,
    include_archived: false,
    include_zero_impression: false,
    media_backfill_enabled: false,
    creative_analysis_enabled: false,
    client_responsiveness: "slow",
    client_start_date: "2026-01-01",
    attribution_notes: "internal note",
    attribution_model: "last_touch",
    creative_analysis_prompt: "secret prompt",
    insights_prompt: "secret prompt",
    company_description: "internal",
    company_pdf_url: "https://example.test/x.pdf",
    kill_threshold: 1,
    scale_threshold: 3,
    kill_scale_kpi: "roas",
    kill_scale_kpi_direction: "gte",
    tiktok_access_token: "tt-token-should-never-leak",
    tiktok_advertiser_id: "tt-adv",
    target_roas: 2.5,
    target_cpa: 40,
    target_monthly_spend: 10000,
    primary_kpi: "ROAS",
    secondary_kpis: "CTR",
    industry_category: "beauty",
  };
}

interface FakeState {
  user: { id: string } | null;
  roles: string[];
  links: string[];
  accounts: string[];
  accountSelects: string[];
}

function fakeClient(state: FakeState) {
  const query = (table: string) => {
    const filters: { col: string; op: "eq" | "in"; val: unknown }[] = [];
    let cols = "*";
    const result = () => {
      if (table === "user_roles") return { data: state.roles.map((role) => ({ role })), error: null };
      if (table === "user_accounts") return { data: state.links.map((account_id) => ({ account_id })), error: null };
      if (table === "ad_accounts") {
        state.accountSelects.push(cols);
        const inFilter = filters.find((f) => f.op === "in" && f.col === "id");
        const ids = inFilter ? (inFilter.val as string[]) : state.accounts;
        return { data: state.accounts.filter((a) => ids.includes(a)).map(fullRow), error: null };
      }
      return { data: [], error: null };
    };
    const q = {
      select(c: string) { cols = c; return q; },
      eq(col: string, val: unknown) { filters.push({ col, op: "eq", val }); return q; },
      in(col: string, val: unknown) { filters.push({ col, op: "in", val }); return q; },
      order() { return q; },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(result()).then(resolve, reject);
      },
    };
    return q;
  };
  return {
    auth: {
      getUser: () => Promise.resolve(
        state.user ? { data: { user: state.user }, error: null } : { data: { user: null }, error: { message: "bad token" } },
      ),
    },
    from: query,
  };
}

function state(over: Partial<FakeState> = {}): FakeState {
  return { user: { id: "u1" }, roles: [], links: [], accounts: ["act_a", "act_b"], accountSelects: [], ...over };
}

async function get(s: FakeState, headers: Record<string, string> = { authorization: "Bearer t" }) {
  const res = await handler(new Request("http://x/accounts", { method: "GET", headers }), { client: fakeClient(s) });
  const body = await res.json();
  return { status: res.status, body };
}

Deno.test("client path: response carries only allow-listed fields, no staff-only field", async () => {
  const s = state({ roles: ["client"], links: ["act_a"] });
  const { status, body } = await get(s);
  assertEquals(status, 200);
  assertEquals(body.length, 1);
  assertEquals(body[0].id, "act_a");
  const allowed = new Set<string>(CLIENT_ACCOUNT_FIELDS);
  for (const row of body) {
    for (const key of Object.keys(row)) assert(allowed.has(key), `client response carries non-allow-listed field ${key}`);
    for (const key of STAFF_ONLY_ACCOUNT_FIELDS) assert(!(key in row), `client response carries staff-only field ${key}`);
  }
  assertEquals(Object.keys(body[0]).sort(), [...CLIENT_ACCOUNT_FIELDS].sort());
});

Deno.test("client path: asks the database for the allow-listed columns only, never *", async () => {
  const s = state({ roles: ["client"], links: ["act_a"] });
  await get(s);
  assertEquals(s.accountSelects, [CLIENT_ACCOUNT_SELECT]);
  const asked = CLIENT_ACCOUNT_SELECT.split(",").map((c) => c.trim());
  assert(!asked.includes("*"));
  for (const key of STAFF_ONLY_ACCOUNT_FIELDS) assert(!asked.includes(key), `client select asks for ${key}`);
});

Deno.test("allow-list and staff-only list do not overlap", () => {
  const staffOnly = new Set<string>(STAFF_ONLY_ACCOUNT_FIELDS);
  for (const f of CLIENT_ACCOUNT_FIELDS) assert(!staffOnly.has(f), `${f} is in both lists`);
});

Deno.test("client path: only linked accounts come back", async () => {
  const { body } = await get(state({ roles: ["client"], links: ["act_b"] }));
  assertEquals(body.map((r: { id: string }) => r.id), ["act_b"]);
});

Deno.test("client with no linked accounts gets an empty list and no account read", async () => {
  const s = state({ roles: ["client"], links: [] });
  const { status, body } = await get(s);
  assertEquals(status, 200);
  assertEquals(body, []);
  assertEquals(s.accountSelects, []);
});

Deno.test("staff path is unchanged: every column, every account", async () => {
  for (const role of ["builder", "employee"]) {
    const s = state({ roles: [role] });
    const { status, body } = await get(s);
    assertEquals(status, 200);
    assertEquals(s.accountSelects, ["*"]);
    assertEquals(body.length, 2);
    assertEquals(body[0].kill_threshold, 1);
    assertEquals(body[0].creative_analysis_prompt, "secret prompt");
  }
});

Deno.test("a staff user who also holds the client role gets the staff path", async () => {
  const s = state({ roles: ["client", "builder"], links: ["act_a"] });
  const { body } = await get(s);
  assertEquals(s.accountSelects, ["*"]);
  assertEquals(body.length, 2);
});

Deno.test("no login is 401, no role is 403, and neither reads accounts", async () => {
  const noHeader = state({ roles: ["client"], links: ["act_a"] });
  assertEquals((await get(noHeader, {})).status, 401);
  const badToken = state({ user: null, roles: ["client"], links: ["act_a"] });
  assertEquals((await get(badToken)).status, 401);
  const noRole = state({ roles: [], links: ["act_a"] });
  assertEquals((await get(noRole)).status, 403);
  assertEquals([...noHeader.accountSelects, ...badToken.accountSelects, ...noRole.accountSelects], []);
});

Deno.test("a client is refused every write", async () => {
  const s = state({ roles: ["client"], links: ["act_a"] });
  for (const [method, path] of [["POST", ""], ["PUT", "/act_a"], ["DELETE", "/act_a"]]) {
    const res = await handler(
      new Request(`http://x/accounts${path}`, { method, headers: { authorization: "Bearer t" }, body: method === "DELETE" ? undefined : "{}" }),
      { client: fakeClient(s) },
    );
    await res.body?.cancel();
    assertEquals(res.status, 403, `${method} ${path}`);
  }
});

Deno.test("the staging wall check keeps the same field lists as the function", async () => {
  const src = await Deno.readTextFile(new URL("../../../scripts/staging-client-wall-functions.mjs", import.meta.url));
  const list = (name: string) => {
    const m = src.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
    assert(m, `${name} not found in staging-client-wall-functions.mjs`);
    return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]).sort();
  };
  assertEquals(list("CLIENT_ACCOUNT_FIELDS"), [...CLIENT_ACCOUNT_FIELDS].sort());
  assertEquals(list("STAFF_ONLY_ACCOUNT_FIELDS"), [...STAFF_ONLY_ACCOUNT_FIELDS].sort());
});
