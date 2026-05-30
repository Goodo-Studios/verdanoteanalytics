// Tests for the write-brief service-role persister (US-005, Phase C).
//
// Covers:
//   * validatePayload — required account_id + name + content(object) + generation_key,
//     optional template_id / reference_ad_ids / assignee_name / due_date type checks.
//   * toBriefRow — status is ALWAYS 'draft' (BRIEF_STATUS), never derived from input;
//     generation_key carried as the upsert conflict key.
//   * isAuthorized — open when WRITE_BRIEF_SECRET unset, else header/Bearer must match.
//   * handler() against a recording mock client — asserts the IDEMPOTENT upsert lands
//     on the `briefs` table with status='draft', using onConflict on
//     (account_id, generation_key).
//   * CODA SAFETY (hard constraint): the module imports nothing Coda, constructs no
//     Coda client, and fetches no coda.io URL. A fetch spy asserts no coda.io call,
//     and the module source is scanned to assert no "coda" reference at all.
//
// WRITE_BRIEF_NO_SERVE is set before import so the module-level Deno.serve never binds.
//   deno test -A supabase/functions/write-brief/index.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("WRITE_BRIEF_NO_SERVE", "1");
// Read with `!` at client-build time; irrelevant because tests inject a mock client.
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");
// No WRITE_BRIEF_SECRET by default -> auth guard is open (gateway bearer assumed).
Deno.env.delete("WRITE_BRIEF_SECRET");

const mod = await import("./index.ts");

// ---- Pure functions --------------------------------------------------------

Deno.test("validatePayload rejects missing/empty account_id", () => {
  assert(!mod.validatePayload({ name: "Brief A", content: {}, generation_key: "g1" }).ok);
  assert(!mod.validatePayload({ account_id: "  ", name: "Brief A", content: {}, generation_key: "g1" }).ok);
});

Deno.test("validatePayload rejects missing/empty name", () => {
  assert(!mod.validatePayload({ account_id: "act_1", content: {}, generation_key: "g1" }).ok);
  assert(!mod.validatePayload({ account_id: "act_1", name: "  ", content: {}, generation_key: "g1" }).ok);
});

Deno.test("validatePayload requires generation_key for idempotency", () => {
  assert(!mod.validatePayload({ account_id: "act_1", name: "Brief A", content: {} }).ok);
  assert(!mod.validatePayload({ account_id: "act_1", name: "Brief A", content: {}, generation_key: "" }).ok);
});

Deno.test("validatePayload requires content to be a jsonb object", () => {
  assert(!mod.validatePayload({ account_id: "act_1", name: "Brief A", generation_key: "g1" }).ok);
  assert(!mod.validatePayload({ account_id: "act_1", name: "Brief A", content: "nope", generation_key: "g1" } as unknown as Record<string, unknown>).ok);
  assert(!mod.validatePayload({ account_id: "act_1", name: "Brief A", content: [1, 2], generation_key: "g1" } as unknown as Record<string, unknown>).ok);
});

Deno.test("validatePayload rejects wrongly-typed optional fields", () => {
  const base = { account_id: "act_1", name: "Brief A", content: {}, generation_key: "g1" };
  assert(!mod.validatePayload({ ...base, template_id: 5 } as unknown as Record<string, unknown>).ok);
  assert(!mod.validatePayload({ ...base, reference_ad_ids: "x" } as unknown as Record<string, unknown>).ok);
  assert(!mod.validatePayload({ ...base, due_date: 99 } as unknown as Record<string, unknown>).ok);
  assert(!mod.validatePayload({ ...base, assignee_name: 1 } as unknown as Record<string, unknown>).ok);
});

Deno.test("validatePayload accepts a minimal valid payload and normalizes optionals", () => {
  const r = mod.validatePayload({ account_id: "act_1", name: "Brief A", content: { hook: "x" }, generation_key: "g1" });
  assert(r.ok);
  assertEquals(r.template_id, null);
  assertEquals(r.reference_ad_ids, []);
  assertEquals(r.assignee_name, null);
  assertEquals(r.due_date, null);
  assertEquals(r.generation_key, "g1");
});

Deno.test("toBriefRow always sets status='draft' and carries the generation_key", () => {
  // Even if a caller smuggles a status in, the row mapper never reads it.
  const v = mod.validatePayload({
    account_id: "act_1",
    name: "Brief A",
    content: { hook: "x" },
    generation_key: "g1",
    reference_ad_ids: ["ad_1", 7] as unknown as string[],
    template_id: "tpl_1",
    assignee_name: "Sam",
    due_date: "2026-06-01",
  });
  const row = mod.toBriefRow(v);
  assertEquals(row.status, "draft");
  assertEquals(row.status, mod.BRIEF_STATUS);
  assertEquals(row.account_id, "act_1");
  assertEquals(row.name, "Brief A");
  assertEquals(row.template_id, "tpl_1");
  assertEquals(row.assignee_name, "Sam");
  assertEquals(row.due_date, "2026-06-01");
  assertEquals(row.generation_key, "g1");
  // Non-string array members are dropped.
  assertEquals(row.reference_ad_ids, ["ad_1"]);
  assertEquals(row.content, { hook: "x" });
});

Deno.test("isAuthorized is open when no secret configured", () => {
  const req = new Request("https://fn.local/write-brief", { method: "POST" });
  assert(mod.isAuthorized(req, undefined));
});

Deno.test("isAuthorized checks x-write-brief-secret header and Bearer", () => {
  const ok = new Request("https://fn.local/write-brief", {
    method: "POST",
    headers: { "x-write-brief-secret": "s3cret" },
  });
  const okBearer = new Request("https://fn.local/write-brief", {
    method: "POST",
    headers: { "Authorization": "Bearer s3cret" },
  });
  const bad = new Request("https://fn.local/write-brief", {
    method: "POST",
    headers: { "x-write-brief-secret": "wrong" },
  });
  assert(mod.isAuthorized(ok, "s3cret"));
  assert(mod.isAuthorized(okBearer, "s3cret"));
  assert(!mod.isAuthorized(bad, "s3cret"));
});

// ---- Recording mock client + handler ---------------------------------------

interface Call {
  method: string;
  args: unknown[];
}

/**
 * Chainable Supabase query-builder stand-in. Every modifier records its call
 * (tagged with the table from the preceding .from()) and returns `this`.
 * `.single()` resolves to one row so the handler can read back an id; awaiting
 * the builder otherwise resolves empty.
 */
function makeRecorder() {
  const calls: Call[] = [];
  let currentTable = "";
  const builder: Record<string, unknown> = {};
  const chainMethods = ["upsert", "insert", "select", "eq", "delete"];
  for (const m of chainMethods) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args: [currentTable, ...args] });
      return builder;
    };
  }
  // .single() is the terminal of the upsert chain; resolve one row with an id.
  builder.single = (...args: unknown[]) => {
    calls.push({ method: "single", args: [currentTable, ...args] });
    return Promise.resolve({ data: { id: "brief-1" }, error: null });
  };
  // Awaiting the builder with no terminal yields empty.
  builder.then = (resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null });

  const supabase = {
    from: (table: string, ...rest: unknown[]) => {
      currentTable = table;
      calls.push({ method: "from", args: [table, ...rest] });
      return builder;
    },
  };
  return { supabase, calls };
}

function callsForTable(calls: Call[], table: string): Call[] {
  return calls.filter((c) => c.args[0] === table);
}

function makePost(body: unknown): Request {
  return new Request("https://fn.local/write-brief", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("handler rejects non-POST with 405", async () => {
  const { supabase } = makeRecorder();
  const res = await mod.handler(
    new Request("https://fn.local/write-brief", { method: "GET" }),
    supabase,
  );
  assertEquals(res.status, 405);
});

Deno.test("handler OPTIONS preflight returns CORS ok", async () => {
  const res = await mod.handler(
    new Request("https://fn.local/write-brief", { method: "OPTIONS" }),
  );
  assertEquals(res.status, 200);
  assert(res.headers.get("Access-Control-Allow-Origin") !== null);
});

Deno.test("handler 400s an invalid payload", async () => {
  const { supabase, calls } = makeRecorder();
  const res = await mod.handler(makePost({ account_id: "act_1" }), supabase);
  assertEquals(res.status, 400);
  // No DB work on a bad payload.
  assertEquals(calls.length, 0);
});

Deno.test("handler 401s when secret is set and request lacks it", async () => {
  Deno.env.set("WRITE_BRIEF_SECRET", "s3cret");
  try {
    const { supabase } = makeRecorder();
    const res = await mod.handler(
      makePost({ account_id: "act_1", name: "Brief A", content: {}, generation_key: "g1" }),
      supabase,
    );
    assertEquals(res.status, 401);
  } finally {
    Deno.env.delete("WRITE_BRIEF_SECRET");
  }
});

Deno.test("handler upserts a draft into briefs with onConflict(account_id,generation_key)", async () => {
  const { supabase, calls } = makeRecorder();
  const res = await mod.handler(
    makePost({
      account_id: "act_1",
      name: "Brief A",
      content: { hook: "x" },
      generation_key: "g1",
      reference_ad_ids: ["ad_1"],
    }),
    supabase,
  );
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.success, true);
  assertEquals(json.account_id, "act_1");
  assertEquals(json.generation_key, "g1");
  assertEquals(json.status, "draft");
  assertEquals(json.brief_id, "brief-1");

  // The write targets the briefs table — and ONLY the briefs table.
  const briefCalls = callsForTable(calls, "briefs");
  assert(briefCalls.length > 0, "must write to briefs");
  for (const c of calls) {
    if (c.method === "from") assertEquals(c.args[0], "briefs", "writer only touches the briefs table");
  }

  // The write is an upsert (idempotent) — not a plain insert.
  const upsert = briefCalls.find((c) => c.method === "upsert");
  assert(upsert, "brief write must be an upsert (idempotent)");
  // Row passed to upsert lands as status='draft'.
  const row = upsert!.args[1] as Record<string, unknown>;
  assertEquals(row.status, "draft");
  assertEquals(row.account_id, "act_1");
  assertEquals(row.generation_key, "g1");
  // onConflict targets the non-partial unique index (account_id, generation_key).
  const opts = upsert!.args[2] as { onConflict?: string };
  assertEquals(opts.onConflict, "account_id,generation_key");
});

// ---- US-007 regression: error surfacing + non-partial idempotency index ----

Deno.test("errorMessage surfaces plain-object Supabase errors (not 'Unknown error')", () => {
  // supabase-js rejects with a PLAIN object, NOT an Error instance. The old
  // `err instanceof Error ? err.message : "Unknown error"` swallowed this and
  // masked the 42P10 ON CONFLICT failure during US-007. errorMessage must read
  // .message off the object and append the Postgres code.
  const pgErr = {
    message: "there is no unique or exclusion constraint matching the ON CONFLICT specification",
    code: "42P10",
    details: null,
    hint: null,
  };
  const msg = mod.errorMessage(pgErr);
  assertStringIncludes(msg, "ON CONFLICT specification");
  assertStringIncludes(msg, "42P10");
  assert(msg !== "Unknown error", "plain Supabase errors must not collapse to 'Unknown error'");

  // Real Error instances still work.
  assertEquals(mod.errorMessage(new Error("boom")), "boom");
  // Truly empty/unknown values fall back.
  assertEquals(mod.errorMessage(null), "Unknown error");
  assertEquals(mod.errorMessage(undefined), "Unknown error");
});

Deno.test("handler returns the real DB error message on a failed upsert (no opaque 500)", async () => {
  // Mock client whose .single() rejects the way supabase-js does: a plain object.
  const failing = {
    from: () => failing,
    upsert: () => failing,
    select: () => failing,
    single: () =>
      Promise.resolve({
        data: null,
        error: {
          message: "there is no unique or exclusion constraint matching the ON CONFLICT specification",
          code: "42P10",
        },
      }),
  };
  const res = await mod.handler(
    makePost({ account_id: "act_1", name: "Brief A", content: { hook: "x" }, generation_key: "g1" }),
    failing,
  );
  assertEquals(res.status, 500);
  const json = await res.json();
  assertEquals(json.success, false);
  assertStringIncludes(json.error, "ON CONFLICT specification");
  assertStringIncludes(json.error, "42P10");
  assert(json.error !== "Unknown error");
});

Deno.test("briefs idempotency index is NON-partial (regression: 42P10 ON CONFLICT inference)", async () => {
  // A PARTIAL unique index (... WHERE generation_key IS NOT NULL) cannot be
  // inferred by ON CONFLICT (account_id, generation_key) unless the conflict
  // clause restates the predicate — which supabase-js/.upsert never does, so it
  // fails with 42P10. The final migration that touches this index must leave it
  // NON-partial. We scan all migrations, find the LAST statement that creates
  // briefs_account_generation_key_uidx, and assert it has no WHERE clause.
  const migrationsDir = new URL("../../migrations/", import.meta.url);
  const files: string[] = [];
  for await (const entry of Deno.readDir(migrationsDir)) {
    if (entry.isFile && entry.name.endsWith(".sql")) files.push(entry.name);
  }
  files.sort(); // timestamp-prefixed -> lexical sort == chronological

  let lastCreate: string | null = null;
  for (const f of files) {
    const sql = await Deno.readTextFile(new URL(f, migrationsDir));
    // Match each CREATE [UNIQUE] INDEX ... briefs_account_generation_key_uidx ... ;
    const re =
      /create\s+unique\s+index[^;]*briefs_account_generation_key_uidx[^;]*;/gi;
    const matches = sql.match(re);
    if (matches && matches.length > 0) lastCreate = matches[matches.length - 1];
  }

  assert(lastCreate, "expected a CREATE UNIQUE INDEX for briefs_account_generation_key_uidx");
  assert(
    !/\bwhere\b/i.test(lastCreate!),
    `briefs idempotency index must be NON-partial (no WHERE) so ON CONFLICT can infer it; saw: ${lastCreate}`,
  );
});

// ---- CODA SAFETY (hard constraint) -----------------------------------------

Deno.test("handler makes NO coda.io fetch (no Coda calls anywhere)", async () => {
  const originalFetch = globalThis.fetch;
  const fetched: string[] = [];
  // deno-lint-ignore no-explicit-any
  globalThis.fetch = ((input: any, init?: any) => {
    const url = typeof input === "string" ? input : (input?.url ?? String(input));
    fetched.push(url);
    return originalFetch(input, init);
  }) as typeof fetch;
  try {
    const { supabase } = makeRecorder();
    const res = await mod.handler(
      makePost({ account_id: "act_1", name: "Brief A", content: { hook: "x" }, generation_key: "g1" }),
      supabase,
    );
    assertEquals(res.status, 200);
    // The injected mock client performs no network I/O, and the handler itself
    // must never reach out to Coda.
    assert(
      !fetched.some((u) => u.includes("coda.io") || u.toLowerCase().includes("coda")),
      `no Coda URL may be fetched; saw: ${JSON.stringify(fetched)}`,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("module source contains no Coda import/client/reference", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  // No Coda import or client construction of any kind.
  assert(!/from\s+["'][^"']*coda[^"']*["']/i.test(src), "no Coda import");
  assert(!/coda\.io/i.test(src), "no coda.io URL");
  assert(!/new\s+Coda/i.test(src), "no Coda client constructed");
  assert(!/CodaClient/i.test(src), "no CodaClient reference");
  // The only persistence target is the briefs table.
  assertStringIncludes(src, '.from("briefs")');
});
