// deno test -A supabase/functions/client-decision/index.test.ts
//
// The function is driven with stand-in Supabase clients. No network: a fetch stub fails the test if
// anything (ClickUp, Slack, email) is called.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("CLIENT_DECISION_NO_SERVE", "1");
Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_ANON_KEY", "anon-test-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-test-key");

const { handler } = await import("./index.ts");
const { checkDecisionInput, decisionLabel } = await import("../_shared/client-decision.ts");

const realFetch = globalThis.fetch;
function noNetwork() {
  globalThis.fetch = () => {
    throw new Error("the function must not call out");
  };
}
function restore() {
  globalThis.fetch = realFetch;
}

interface World {
  user?: { id: string; email?: string } | null;
  role?: string;
  slugs?: string[];
  rpcError?: { code: string } | null;
  rpcData?: Record<string, unknown>;
}

function setup(w: World) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const make = (_url: string, key: string) => {
    if (key === "anon-test-key") {
      return {
        auth: {
          getUser: () =>
            Promise.resolve(w.user ? { data: { user: w.user }, error: null } : { data: { user: null }, error: { message: "bad jwt" } }),
        },
        rpc: (name: string, args: Record<string, unknown>) => {
          calls.push({ name: `user:${name}`, args });
          return Promise.resolve({ data: w.slugs ?? [], error: null });
        },
      };
    }
    return {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name: `service:${name}`, args });
        if (name === "get_user_role") return Promise.resolve({ data: w.role ?? "client", error: null });
        if (name === "record_client_decision") {
          return Promise.resolve({
            data: w.rpcError ? null : (w.rpcData ?? { status: "recorded", id: "d1", decision: args.p_decision, decided_at: "2026-11-10T00:00:00Z" }),
            error: w.rpcError ?? null,
          });
        }
        return Promise.resolve({ data: null, error: { code: "XX000" } });
      },
    };
  };
  return { make, calls };
}

const post = (body: unknown, auth: string | null = "Bearer t") =>
  new Request("http://localhost/client-decision", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const CLIENT = { id: "u-client", email: "alex.smith@brand.test" };

Deno.test("no Authorization header is 401 and nothing is called", async () => {
  noNetwork();
  try {
    const { make, calls } = setup({});
    const res = await handler(post({ taskId: "t1", decision: "approved" }, null), { createClient: make });
    assertEquals(res.status, 401);
    assertEquals(calls.length, 0);
  } finally {
    restore();
  }
});

Deno.test("a bad token is 401", async () => {
  const { make, calls } = setup({ user: null });
  const res = await handler(post({ taskId: "t1", decision: "approved" }), { createClient: make });
  assertEquals(res.status, 401);
  assert(!calls.some((c) => c.name.includes("record_client_decision")));
});

Deno.test("only POST is accepted", async () => {
  const { make } = setup({ user: CLIENT });
  const res = await handler(new Request("http://localhost/client-decision", { method: "GET", headers: { Authorization: "Bearer t" } }), { createClient: make });
  assertEquals(res.status, 405);
});

Deno.test("staff callers are rejected with 403 and record nothing", async () => {
  for (const role of ["builder", "employee"]) {
    const { make, calls } = setup({ user: { id: "u-staff" }, role, slugs: ["c1"] });
    const res = await handler(post({ taskId: "t1", decision: "approved" }), { createClient: make });
    assertEquals(res.status, 403, role);
    assert(!calls.some((c) => c.name === "service:record_client_decision"), role);
  }
});

Deno.test("a login that is not a client is rejected", async () => {
  const { make, calls } = setup({ user: { id: "u-x" }, role: "viewer", slugs: ["c1"] });
  const res = await handler(post({ taskId: "t1", decision: "approved" }), { createClient: make });
  assertEquals(res.status, 403);
  assert(!calls.some((c) => c.name === "service:record_client_decision"));
});

Deno.test("invalid ids and decisions are 400 before anything is recorded", async () => {
  const bad = [
    { taskId: "", decision: "approved" },
    { taskId: "has space", decision: "approved" },
    { taskId: "x".repeat(65), decision: "approved" },
    { taskId: "t1; drop table", decision: "approved" },
    { taskId: 42, decision: "approved" },
    { decision: "approved" },
    { taskId: "t1", decision: "maybe" },
    { taskId: "t1" },
    { taskId: "t1", decision: "changes_requested" },
    { taskId: "t1", decision: "changes_requested", note: "   " },
    { taskId: "t1", decision: "changes_requested", note: "x".repeat(1001) },
    { taskId: "t1", decision: "changes_requested", note: 5 },
    [],
    "not json{",
  ];
  for (const body of bad) {
    const { make, calls } = setup({ user: CLIENT, slugs: ["c1"] });
    const res = await handler(post(body as unknown), { createClient: make });
    assertEquals(res.status, 400, JSON.stringify(body));
    assert(!calls.some((c) => c.name === "service:record_client_decision"), JSON.stringify(body));
  }
});

Deno.test("a client with no clients is 403", async () => {
  const { make, calls } = setup({ user: CLIENT, slugs: [] });
  const res = await handler(post({ taskId: "t1", decision: "approved" }), { createClient: make });
  assertEquals(res.status, 403);
  assert(!calls.some((c) => c.name === "service:record_client_decision"));
});

Deno.test("approve: records with the caller's own clients and a plain label", async () => {
  noNetwork();
  try {
    const { make, calls } = setup({ user: CLIENT, slugs: ["bearaby"] });
    const res = await handler(post({ taskId: "86bbxq25b", decision: "approved", note: "ignored by approve" }), { createClient: make });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.success, true);
    assertEquals(body.status, "recorded");
    const rec = calls.find((c) => c.name === "service:record_client_decision")!;
    assertEquals(rec.args, {
      p_user_id: "u-client",
      p_label: "Alex",
      p_allowed_slugs: ["bearaby"],
      p_task_id: "86bbxq25b",
      p_decision: "approved",
      p_note: null,
    });
  } finally {
    restore();
  }
});

Deno.test("request changes: the note is trimmed and passed on", async () => {
  const { make, calls } = setup({ user: CLIENT, slugs: ["bearaby"] });
  const res = await handler(post({ taskId: "t1", decision: "changes_requested", note: "  Shorter intro please  " }), { createClient: make });
  assertEquals(res.status, 200);
  const rec = calls.find((c) => c.name === "service:record_client_decision")!;
  assertEquals(rec.args.p_note, "Shorter intro please");
  assertEquals(rec.args.p_decision, "changes_requested");
});

Deno.test("idempotent: an unchanged answer is passed through as a success", async () => {
  const { make } = setup({ user: CLIENT, slugs: ["bearaby"], rpcData: { status: "unchanged", id: "d1", decision: "approved", decided_at: "x" } });
  const res = await handler(post({ taskId: "t1", decision: "approved" }), { createClient: make });
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "unchanged");
});

Deno.test("a card of another client: only the caller's own clients are sent, and not found comes back as 404", async () => {
  const { make, calls } = setup({ user: CLIENT, slugs: ["bearaby"], rpcError: { code: "P0002" } });
  const res = await handler(post({ taskId: "someone-elses-card", decision: "approved" }), { createClient: make });
  assertEquals(res.status, 404);
  const rec = calls.find((c) => c.name === "service:record_client_decision")!;
  assertEquals(rec.args.p_allowed_slugs, ["bearaby"]);
  assert(!JSON.stringify(await res.clone().text()).includes("someone-elses-card"));
});

Deno.test("a client cannot widen its own clients through the body", async () => {
  const { make, calls } = setup({ user: CLIENT, slugs: ["bearaby"] });
  await handler(post({ taskId: "t1", decision: "approved", clientSlug: "osmo", slugs: ["osmo"], allowed: ["osmo"] }), { createClient: make });
  const rec = calls.find((c) => c.name === "service:record_client_decision")!;
  assertEquals(rec.args.p_allowed_slugs, ["bearaby"]);
});

Deno.test("closed and rate limited decisions map to 409 and 429", async () => {
  for (const [code, status] of [["P0409", 409], ["P0429", 429], ["22023", 400]] as const) {
    const { make } = setup({ user: CLIENT, slugs: ["bearaby"], rpcError: { code } });
    const res = await handler(post({ taskId: "t1", decision: "approved" }), { createClient: make });
    assertEquals(res.status, status, code);
    assert(typeof (await res.json()).error === "string");
  }
});

Deno.test("an unexpected database error is a plain 500 with no details", async () => {
  const { make } = setup({ user: CLIENT, slugs: ["bearaby"], rpcError: { code: "XX000" } });
  const res = await handler(post({ taskId: "t1", decision: "approved" }), { createClient: make });
  assertEquals(res.status, 500);
  assert(!(await res.text()).includes("XX000"));
});

Deno.test("input rules and labels", () => {
  assertEquals(checkDecisionInput({ taskId: "abc-1", decision: "approved" }), { ok: true, value: { taskId: "abc-1", decision: "approved", note: null } });
  assertEquals(decisionLabel("sam@brand.test"), "Sam");
  assertEquals(decisionLabel("sam.jones@brand.test"), "Sam");
  assertEquals(decisionLabel(""), "A team member");
  assertEquals(decisionLabel(undefined), "A team member");
  assert(!decisionLabel("sam.jones@brand.test").includes("@"));
});
