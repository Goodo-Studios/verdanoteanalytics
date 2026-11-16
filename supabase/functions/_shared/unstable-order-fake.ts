// Test helper: a fake Supabase client that behaves like Postgres when a query's order is not
// unique. Rows that tie on every ordered column (or every row, when there is no order) come
// back in a different arrangement on each request, as a parallel or re-planned scan can do.
// Paging such a query by offset then skips some rows and repeats others. With `cap`, no
// response carries more than `cap` rows (PostgREST max_rows). With `failAt`, the request
// with that index (0-based) returns an error.
// deno-lint-ignore-file no-explicit-any

export function unstableOrderDb(
  tables: Record<string, any[]>,
  opts: { cap?: number; failAt?: number } = {},
) {
  let calls = 0;
  const cap = opts.cap ?? 1000;
  return {
    from(table: string) {
      const filters: ((r: any) => boolean)[] = [];
      const orderKeys: { key: string; asc: boolean }[] = [];
      let start = 0;
      let end = Number.POSITIVE_INFINITY;
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
        in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), q),
        order: (key: string, o?: { ascending?: boolean }) => (orderKeys.push({ key, asc: o?.ascending !== false }), q),
        range: (from: number, to: number) => ((start = from), (end = to + 1), q),
        then(resolve: (v: any) => unknown, reject?: (e: unknown) => unknown) {
          const call = calls++;
          if (opts.failAt === call) {
            return Promise.resolve({ data: null, error: { message: "page failed" } }).then(resolve, reject);
          }
          const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
          // Tie-break differently on every request: rotate tied rows by the call number.
          const salt = (i: number) => ((i * 7919) + call * 104729) % 1000003;
          const indexed = rows.map((r, i) => ({ r, tie: salt(i) }));
          indexed.sort((a, b) => {
            for (const { key, asc } of orderKeys) {
              if (a.r[key] !== b.r[key]) return (a.r[key] < b.r[key] ? -1 : 1) * (asc ? 1 : -1);
            }
            return a.tie - b.tie;
          });
          const out = indexed.slice(start, end).slice(0, cap).map((x) => x.r);
          return Promise.resolve({ data: out, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}
