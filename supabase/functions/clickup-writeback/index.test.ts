// Tests for clickup-writeback (OS-017). The write rules are tested in
// _shared/os-clickup-writeback.test.ts; here: only the service role gets in, and with the
// deployed defaults (no CLICKUP_WRITEBACK_* set) a run holds every row and never calls ClickUp.
//
//   deno test -A supabase/functions/clickup-writeback/index.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("CLICKUP_WRITEBACK_NO_SERVE", "1");
Deno.env.set("CLICKUP_API_TOKEN", "fake-clickup-token");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");
Deno.env.delete("CLICKUP_WRITEBACK_ENABLED");
Deno.env.delete("CLICKUP_WRITEBACK_LIST_IDS");

import { fakeClickUp, fakeDb } from "../_shared/testing/os-sync-fakes.ts";

const mod = await import("./index.ts");

const queued = (id: number) => ({
  id,
  task_id: null,
  clickup_task_id: `t${id}`,
  clickup_list_id: "901400000001",
  kind: "status",
  field: "status",
  payload: { from: "editing", to: "complete" },
  app_changed_at: "2026-11-30T11:00:00.000Z",
  state: "queued",
  attempts: 0,
  next_attempt_at: "2026-11-30T11:00:00.000Z",
});

Deno.test("a caller without the service-role key is refused and nothing runs", async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    urls.push(String(input instanceof Request ? input.url : input));
    return Promise.resolve(new Response("{}", { status: 401 }));
  }) as typeof fetch;
  try {
    const db = fakeDb({ tables: { os_clickup_outbox: [queued(1)] } });
    const res = await mod.handler(
      new Request("https://fn.local/clickup-writeback", { method: "POST", headers: { Authorization: "Bearer not-the-key" }, body: "{}" }),
      { supabase: db.supabase },
    );
    assert(res.status === 401 || res.status === 403, `expected a refusal, got ${res.status}`);
    assertEquals(urls.filter((u) => u.includes("clickup.com")).length, 0);
    assertEquals(db.log.length, 0);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("with the deployed defaults every row is held and ClickUp is never called", async () => {
  const db = fakeDb({ tables: { os_clickup_outbox: [queued(1), queued(2)] } });
  const cu = fakeClickUp({});
  const res = await mod.handler(
    new Request("https://fn.local/clickup-writeback", { method: "POST", headers: { Authorization: "Bearer fake-service-role" }, body: "{}" }),
    { supabase: db.supabase, fetch: cu.fetch, now: () => "2026-11-30T12:00:00.000Z" },
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals([body.enabled, body.held, body.sent], [false, 2, 0]);
  assertEquals(cu.calls.length, 0);
  assert(db.table("os_clickup_outbox").every((r) => r.state === "held"));
  assertEquals(db.table("os_clickup_writeback_state")[0].enabled, false);
});

Deno.test("only POST is accepted", async () => {
  const res = await mod.handler(
    new Request("https://fn.local/clickup-writeback", { method: "GET", headers: { Authorization: "Bearer fake-service-role" } }),
    { supabase: fakeDb().supabase },
  );
  assertEquals(res.status, 405);
});
