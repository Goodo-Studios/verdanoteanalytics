// Tests for the sync-coda-tasks edge function.
//
// Focus (regression for the 2026-06-02 column-model change, PR #17):
// the sync must be AUTHORITATIVE, not merely additive. After the batched
// upsert it must DELETE every coda_tasks row whose synced_at predates this
// run's start timestamp — i.e. rows that were not re-upserted this run because
// their stage stopped being active (e.g. "STUCK" dropped from STAGE_MAP, rows
// leaving the "Ready to Launch" window, Coda deletions, stage renames). Without
// that delete the ~65 previously-synced STUCK rows linger tagged
// stage="Production" and read as stale under the Production column.
//
// Covered here:
//   * Pure stage gating (isActiveStage, STAGE_MAP) still behaves as documented.
//   * handler() upserts the active set, THEN issues a single authoritative
//     delete of rows with synced_at < this run's start, using the SAME timestamp
//     stamped onto the upserted rows.
//   * The delete fires AFTER the upsert (ordering matters — never delete first).
//   * SAFETY: if any upsert chunk errors, the authoritative delete is SKIPPED
//     (a partial upsert leaves active rows on an old synced_at; deleting then
//     would purge live tasks).
//
// SYNC_CODA_TASKS_NO_SERVE is set before import so Deno.serve never binds.
//   deno test -A supabase/functions/sync-coda-tasks/index.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("SYNC_CODA_TASKS_NO_SERVE", "1");
Deno.env.set("CODA_API_KEY", "fake-coda-key");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");

const mod = await import("./index.ts");

// ---- Pure stage gating -----------------------------------------------------

Deno.test("isActiveStage skips empty + STUCK + Not-applicable, keeps the rest", () => {
  assert(!mod.isActiveStage(null), "null stage is not active");
  assert(!mod.isActiveStage("STUCK"), "STUCK is skipped (internal noise)");
  assert(
    !mod.isActiveStage("Not applicable anymore"),
    "Not-applicable is skipped",
  );
  assert(mod.isActiveStage("Editing"), "a real flow stage is active");
  assert(
    mod.isActiveStage("Some Brand New Stage"),
    "unknown stages fall through as active (drift safety)",
  );
});

Deno.test("STAGE_MAP no longer maps STUCK (2026-06-02 column model)", () => {
  assert(!("STUCK" in mod.STAGE_MAP), "STUCK must not be mapped to any column");
  assertEquals(mod.STAGE_MAP["Editing"], "Editing");
  assertEquals(mod.STAGE_MAP["Assigned"], "Production");
});

// ---- Recording mock client -------------------------------------------------

interface Call {
  method: string;
  table: string;
  args: unknown[];
}

/**
 * Chainable Supabase query-builder stand-in. Records every call tagged with the
 * table from the preceding .from(). Awaiting any builder resolves to a result
 * shaped for whatever the handler needs: ad_accounts.select().eq() → data rows,
 * coda_tasks.upsert() → { error }, coda_tasks.delete().lt() → { error, count }.
 *
 * `upsertError` lets a test simulate a failed upsert chunk so we can assert the
 * authoritative delete is skipped.
 */
function makeRecorder({ upsertError = false } = {}) {
  const calls: Call[] = [];
  let currentTable = "";
  const builder: Record<string, unknown> = {};
  const chainMethods = ["select", "eq", "upsert", "delete", "lt"];
  for (const m of chainMethods) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, table: currentTable, args });
      return builder;
    };
  }
  // Awaiting the builder yields a result that satisfies every call site.
  builder.then = (resolve: (v: unknown) => void) => {
    const lastDelete = calls.some((c) => c.method === "delete");
    const lastUpsert = calls.some((c) => c.method === "upsert");
    if (lastDelete) {
      return resolve({ data: null, error: null, count: 7 });
    }
    if (lastUpsert) {
      return resolve(
        upsertError
          ? { data: null, error: { message: "boom: upsert failed" } }
          : { data: null, error: null },
      );
    }
    // ad_accounts.select().eq() and anything else.
    return resolve({ data: [], error: null });
  };

  const supabase = {
    from: (table: string) => {
      currentTable = table;
      calls.push({ method: "from", table, args: [] });
      return builder;
    },
  };
  return { supabase, calls };
}

/**
 * Stub global fetch to serve one page of Coda rows so the handler builds a
 * non-empty active record set (and therefore performs an upsert). Returns a
 * restore fn. Rows include one active ("Editing") and one skipped ("STUCK").
 */
function stubCodaFetch(): () => void {
  const original = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  globalThis.fetch = ((_input: any, _init?: any) => {
    const body = {
      items: [
        {
          id: "row-active-1",
          browserLink: "https://coda.io/d/x#row-active-1",
          updatedAt: "2026-06-02T00:00:00.000Z",
          values: {
            Stage: "Editing",
            "Connected Project": "Acme",
            Task: "Cut v2",
          },
        },
        {
          id: "row-stuck-1",
          browserLink: "https://coda.io/d/x#row-stuck-1",
          updatedAt: "2026-06-02T00:00:00.000Z",
          values: { Stage: "STUCK", "Connected Project": "Acme", Task: "Blocked" },
        },
      ],
      nextPageToken: undefined,
    };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function makeReq(): Request {
  return new Request("https://fn.local/sync-coda-tasks", { method: "POST" });
}

// ---- Authoritative-delete regression ---------------------------------------

Deno.test("handler issues an authoritative delete of stale rows AFTER the upsert", async () => {
  const restore = stubCodaFetch();
  try {
    const { supabase, calls } = makeRecorder();
    const res = await mod.handler(makeReq(), supabase);
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.deleted, 7, "deleted count is surfaced from the delete");

    // An upsert into coda_tasks happened (the active row).
    const upsertIdx = calls.findIndex(
      (c) => c.method === "upsert" && c.table === "coda_tasks",
    );
    assert(upsertIdx >= 0, "must upsert the active set into coda_tasks");

    // A delete on coda_tasks happened...
    const deleteIdx = calls.findIndex(
      (c) => c.method === "delete" && c.table === "coda_tasks",
    );
    assert(deleteIdx >= 0, "must issue an authoritative delete on coda_tasks");

    // ...AFTER the upsert (never delete-then-upsert — that would empty the board).
    assert(
      deleteIdx > upsertIdx,
      "authoritative delete must run AFTER the upsert",
    );

    // The delete filters on synced_at < <run start>, and that threshold is the
    // SAME timestamp stamped onto the upserted rows (authoritative semantics).
    const ltCall = calls.find((c) => c.method === "lt" && c.table === "coda_tasks");
    assert(ltCall, "delete must be scoped by .lt() on synced_at");
    assertEquals(ltCall!.args[0], "synced_at", "scope column is synced_at");
    const threshold = ltCall!.args[1] as string;

    const upsertCall = calls[upsertIdx];
    const chunk = upsertCall.args[0] as Array<Record<string, unknown>>;
    assert(chunk.length > 0, "upsert chunk has rows");
    for (const row of chunk) {
      assertEquals(
        row.synced_at,
        threshold,
        "delete threshold equals the run-start synced_at on upserted rows",
      );
    }

    // The active row was upserted; the STUCK row was skipped, not upserted.
    assertEquals(json.upserted, 1);
    assert(
      chunk.every((r) => r.coda_row_id !== "row-stuck-1"),
      "STUCK row must not be upserted",
    );
  } finally {
    restore();
  }
});

Deno.test("handler SKIPS the authoritative delete when an upsert chunk fails", async () => {
  const restore = stubCodaFetch();
  try {
    const { supabase, calls } = makeRecorder({ upsertError: true });
    const res = await mod.handler(makeReq(), supabase);
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.upserted, 0, "no chunk counted as upserted on failure");
    assertEquals(json.deleted, 0, "nothing deleted when an upsert failed");

    // No delete may be issued — purging by synced_at after a partial upsert
    // would wrongly remove genuinely-active rows still on an old synced_at.
    const deleteCall = calls.find((c) => c.method === "delete");
    assert(!deleteCall, "delete must be skipped after an upsert failure");
  } finally {
    restore();
  }
});

Deno.test("handler OPTIONS preflight returns CORS ok with no DB work", async () => {
  const res = await mod.handler(
    new Request("https://fn.local/sync-coda-tasks", { method: "OPTIONS" }),
  );
  assertEquals(res.status, 200);
  assert(res.headers.get("Access-Control-Allow-Origin") !== null);
});
