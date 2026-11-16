// Audit 7.3: every sync read must see the whole account, not the first 1,000 rows (or the
// first short page when the server cap is below the page size).
// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  loadAlertCandidates,
  loadAutoParseCandidates,
  loadChangelogCreatives,
  loadMappingsByCode,
  loadPausedCreatives,
  loadProtectedTagAdIds,
  loadScoreCreatives,
  sumLocalDailyMetrics,
} from "./reads.ts";

// A fake client like PostgREST with max_rows = cap: filters, order and range apply, and no
// response carries more than `cap` rows. With `failFrom`, every read starting at or past that
// offset returns an error.
function fakeDb(tables: Record<string, any[]>, cap: number, opts: { error?: string; failFrom?: number } = {}) {
  return {
    from(table: string) {
      const filters: ((r: any) => boolean)[] = [];
      const orderKeys: string[] = [];
      let start = 0;
      let end = Number.POSITIVE_INFINITY;
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
        gt: (k: string, v: number) => (filters.push((r) => r[k] !== null && r[k] > v), q),
        gte: (k: string, v: string) => (filters.push((r) => r[k] >= v), q),
        lte: (k: string, v: string) => (filters.push((r) => r[k] <= v), q),
        in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), q),
        not: (k: string, op: string, v: unknown) => (op === "is" && v === null && filters.push((r) => r[k] !== null), q),
        order: (k: string) => (orderKeys.push(k), q),
        range: (from: number, to: number) => ((start = from), (end = to + 1), q),
        then(resolve: (v: any) => unknown, reject?: (e: unknown) => unknown) {
          if (opts.error || (opts.failFrom !== undefined && start >= opts.failFrom)) {
            return Promise.resolve({ data: null, error: { message: opts.error ?? "page failed" } }).then(resolve, reject);
          }
          let out = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
          if (orderKeys.length) {
            out = [...out].sort((a, b) => {
              for (const k of orderKeys) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
              return 0;
            });
          }
          out = out.slice(start, end).slice(0, cap);
          return Promise.resolve({ data: out, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

const pad = (i: number) => String(i).padStart(5, "0");
// 2,600 creatives in act_a: half spending, a quarter paused with a prior ROAS, plus 200 in act_b.
const creatives = [
  ...Array.from({ length: 2600 }, (_, i) => ({
    ad_id: `a_${pad(i)}`,
    account_id: "act_a",
    ad_name: `CODE${i}_x`,
    spend: i % 2 === 0 ? 100 : 0,
    impressions: 10,
    roas: 1.5,
    prior_roas: i % 4 === 1 ? 2 : null,
    tag_source: ["manual", "csv", "untagged", "parsed"][i % 4],
    parsed_ad_name: null,
  })),
  ...Array.from({ length: 200 }, (_, i) => ({
    ad_id: `b_${pad(i)}`, account_id: "act_b", ad_name: "B", spend: 100, impressions: 10, roas: 1, prior_roas: 2,
    tag_source: "manual", parsed_ad_name: null,
  })),
];
const name_mappings = Array.from({ length: 1500 }, (_, i) => ({ account_id: "act_a", unique_code: `m${pad(i)}`, product: "P" }));
const creative_daily_metrics = Array.from({ length: 2500 }, (_, i) => ({
  ad_id: `a_${pad(i % 500)}`, account_id: "act_a", date: `2020-07-0${1 + Math.floor(i / 500)}`, spend: 2, impressions: 3,
}));
const tables = { creatives, name_mappings, creative_daily_metrics };

for (const cap of [1000, 500]) {
  Deno.test(`alert candidates: every creative over the spend threshold (cap ${cap})`, async () => {
    assertEquals((await loadAlertCandidates(fakeDb(tables, cap), "act_a", 50)).length, 1300);
  });

  Deno.test(`protected tags: every manual and CSV ad id, so Phase 1 never overwrites them (cap ${cap})`, async () => {
    const ids = await loadProtectedTagAdIds(fakeDb(tables, cap), "act_a");
    assertEquals(ids.size, 1300);
  });

  Deno.test(`name mappings: every mapping (cap ${cap})`, async () => {
    assertEquals((await loadMappingsByCode(fakeDb(tables, cap), "act_a")).size, 1500);
  });

  Deno.test(`auto-parse candidates: every untagged and parsed creative (cap ${cap})`, async () => {
    const rows = await loadAutoParseCandidates(fakeDb(tables, cap), "act_a");
    assertEquals(rows.length, 1300);
    assertEquals(new Set(rows.map((r) => r.ad_id)).size, 1300);
  });

  Deno.test(`score, changelog and paused reads: every matching creative (cap ${cap})`, async () => {
    const db = fakeDb(tables, cap);
    assertEquals((await loadScoreCreatives(db, "act_a")).length, 1300);
    assertEquals((await loadChangelogCreatives(db, "act_a")).length, 2600);
    assertEquals((await loadPausedCreatives(db, "act_a")).length, 650);
  });

  Deno.test(`audit: sums every daily row in the window (cap ${cap})`, async () => {
    const t = await sumLocalDailyMetrics(fakeDb(tables, cap), "act_a", "2020-07-01", "2020-07-04", () => false);
    assertEquals(t, { spend: 4000, impressions: 6000, rows: 2000, complete: true });
  });
}

Deno.test("a failed read throws instead of acting on an empty or partial list", async () => {
  const db = fakeDb(tables, 1000, { error: "boom" });
  await assertRejects(() => loadAlertCandidates(db, "act_a", 50));
  await assertRejects(() => loadProtectedTagAdIds(db, "act_a"));
  await assertRejects(() => loadMappingsByCode(db, "act_a"));
  await assertRejects(() => loadAutoParseCandidates(db, "act_a"));
  await assertRejects(() => loadScoreCreatives(db, "act_a"));
  await assertRejects(() => loadChangelogCreatives(db, "act_a"));
  await assertRejects(() => loadPausedCreatives(db, "act_a"));
});

Deno.test("audit: a failed page marks the audit incomplete instead of reporting a partial sum", async () => {
  const t = await sumLocalDailyMetrics(fakeDb(tables, 1000, { failFrom: 1000 }), "act_a", "2020-07-01", "2020-07-05", () => false);
  assert(!t.complete);
});
