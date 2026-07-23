// Deno edge tests are manual (not in CI vitest) per
// verdanote-deno-edge-tests-are-manual-not-in-ci-vitest. Run with:
//   deno test -A supabase/functions/preview-capture-drain/index.test.ts
//
// REGRESSION for the preview-capture drain stall RECURRENCE (fix/preview-drain-stall-2):
// covered-but-still-'pending' rows at the head of the fetch ordering filled the whole
// limited candidate window, so selectDrainBatch (which drops covered rows) returned an
// EMPTY batch and the drain returned no_work every tick — never reaching the untried
// backlog behind them. PR#83 closed this head-starvation class for BACKOFF rows but left
// it wide open for COVERED rows. The fix excludes covered rows in the SQL fetch itself.
//
// This test drives the real handler against a fake Supabase client that faithfully
// applies the `.or()` covered-exclusion filter. Remove that exclusion from the fetch and
// this test fails (processed=0, no_work) — exactly the prod stall it guards against.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const OWNED = "https://x.supabase.co/storage/v1/object/public/ad-videos/a/assets/h.mp4";

Deno.env.set("PREVIEW_CAPTURE_DRAIN_NO_SERVE", "1");
Deno.env.set("SUPABASE_URL", "http://test.local");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

interface Row {
  ad_id: string;
  account_id: string;
  created_time: string | null;
  capture_status: string | null;
  video_url: string | null;
  full_res_url: string | null;
  capture_attempts: number | null;
  capture_last_attempt_at: string | null;
  meta_video_ids: string[] | null;
  meta_image_hashes: string[] | null;
}

// -- Minimal PostgREST-shaped fake: enough of the query builder to exercise the drain's
//    exact chain (eq / or / order / limit / count-head / update) against an in-memory
//    creatives table, applying filters so the covered-exclusion is genuinely tested. --
type Pred = (r: Row) => boolean;

function likeContains(pattern: string): string {
  return pattern.replace(/^\*/, "").replace(/\*$/, ""); // `*X*` → `X`
}

function parseOrCond(cond: string): Pred {
  // Forms: `col.is.null` | `col.not.like.<val>` | `col.like.<val>`
  const parts = cond.split(".");
  const col = parts[0] as keyof Row;
  if (parts[1] === "is" && parts[2] === "null") return (r) => r[col] == null;
  if (parts[1] === "not" && parts[2] === "like") {
    const needle = likeContains(parts.slice(3).join("."));
    return (r) => !String(r[col] ?? "").includes(needle);
  }
  if (parts[1] === "like") {
    const needle = likeContains(parts.slice(2).join("."));
    return (r) => String(r[col] ?? "").includes(needle);
  }
  throw new Error(`fake: unsupported or() cond: ${cond}`);
}

type QResult = { data: Row[] | null; count?: number; error: null };
class Query {
  private preds: Pred[] = [];
  private orders: Array<{ col: keyof Row; asc: boolean; nullsFirst: boolean }> = [];
  private lim = Infinity;
  private headCount = false;
  constructor(private rows: Row[]) {}
  select(_cols: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.head) this.headCount = true;
    return this;
  }
  eq(col: keyof Row, val: unknown) {
    this.preds.push((r) => r[col] === val);
    return this;
  }
  or(expr: string) {
    const conds = expr.split(",").map(parseOrCond);
    this.preds.push((r) => conds.some((c) => c(r)));
    return this;
  }
  order(col: keyof Row, o: { ascending: boolean; nullsFirst: boolean }) {
    this.orders.push({ col, asc: o.ascending, nullsFirst: o.nullsFirst });
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  private run() {
    let out = this.rows.filter((r) => this.preds.every((p) => p(r)));
    for (const o of [...this.orders].reverse()) {
      out = [...out].sort((a, b) => {
        const av = a[o.col], bv = b[o.col];
        if (av == null && bv == null) return 0;
        if (av == null) return o.nullsFirst ? -1 : 1;
        if (bv == null) return o.nullsFirst ? 1 : -1;
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return o.asc ? cmp : -cmp;
      });
    }
    if (this.headCount) return { data: null, count: out.length, error: null };
    return { data: out.slice(0, this.lim), count: out.length, error: null };
  }
  then(onfulfilled: (v: QResult) => unknown): unknown {
    return onfulfilled(this.run());
  }
}

class UpdateQuery {
  private preds: Pred[] = [];
  constructor(private rows: Row[], private patch: Partial<Row>) {}
  eq(col: keyof Row, val: unknown) {
    this.preds.push((r) => r[col] === val);
    return this;
  }
  then(onfulfilled: (v: { data: null; error: null }) => unknown): unknown {
    for (const r of this.rows) if (this.preds.every((p) => p(r))) Object.assign(r, this.patch);
    return onfulfilled({ data: null, error: null });
  }
}

class FakeDb {
  constructor(public rows: Row[]) {}
  from(_t: string) {
    const rows = this.rows;
    return {
      select: (cols: string, opts?: { count?: string; head?: boolean }) =>
        new Query(rows).select(cols, opts),
      update: (patch: Partial<Row>) => new UpdateQuery(rows, patch),
    };
  }
  // deno-lint-ignore no-explicit-any
  rpc(name: string, _args?: any) {
    if (name === "claim_apify_drain_singleflight") return Promise.resolve({ data: true, error: null });
    return Promise.resolve({ data: null, error: null });
  }
}

function makeRows(): Row[] {
  const rows: Row[] = [];
  // 30 covered VIDEO rows: storage-owned video_url, still capture_status='pending',
  // never attempted (null last_attempt), NEWEST created_time so they lead the ordering.
  for (let i = 0; i < 30; i++) {
    rows.push({
      ad_id: `cov-${String(i).padStart(3, "0")}`,
      account_id: "act_1",
      created_time: `2026-07-${String(10 + (i % 20)).padStart(2, "0")}T00:00:00Z`,
      capture_status: "pending",
      video_url: OWNED,
      full_res_url: null,
      capture_attempts: 0,
      capture_last_attempt_at: null,
      meta_video_ids: ["v"],
      meta_image_hashes: null,
    });
  }
  // 5 untried STATIC rows (image hashes, no video), no owned url → genuinely drainable,
  // OLDER created_time so they sit behind the covered cluster in the ordering.
  for (let i = 0; i < 5; i++) {
    rows.push({
      ad_id: `stat-${String(i).padStart(3, "0")}`,
      account_id: "act_1",
      created_time: `2026-06-0${i + 1}T00:00:00Z`,
      capture_status: "pending",
      video_url: null,
      full_res_url: null,
      capture_attempts: 0,
      capture_last_attempt_at: null,
      meta_video_ids: null,
      meta_image_hashes: ["h"],
    });
  }
  return rows;
}

Deno.test("drain reaches untried STATIC rows past a covered-row head (stall recurrence)", async () => {
  const db = new FakeDb(makeRows());
  const realFetch = globalThis.fetch;
  const captured: string[] = [];
  // Stub preview-capture (marks the row captured) and the self-chain (no-op).
  // deno-lint-ignore no-explicit-any
  (globalThis as any).fetch = (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (String(url).includes("/preview-capture-drain")) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    }
    if (String(url).includes("/preview-capture")) {
      const row = db.rows.find((r) => r.ad_id === body.ad_id);
      if (row) {
        row.capture_status = "captured";
        row.full_res_url = OWNED;
      }
      captured.push(body.ad_id);
      return Promise.resolve(new Response(JSON.stringify({ status: "captured" }), { status: 200 }));
    }
    return realFetch(url as string, init);
  };

  try {
    const { handler } = await import("./index.ts");
    const res = await handler(
      new Request("http://test.local/preview-capture-drain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      // deno-lint-ignore no-explicit-any
      db as any,
    );
    const payload = await res.json();

    // The drain MUST do work — not stall at no_work — and every ad it processed must be a
    // genuinely-drainable STATIC row, never a covered row that should have been excluded.
    assertEquals(payload.no_work, undefined);
    assertEquals(payload.processed >= 1, true);
    assertEquals(captured.length >= 1, true);
    assertEquals(captured.every((id) => id.startsWith("stat-")), true);
  } finally {
    globalThis.fetch = realFetch;
  }
});
