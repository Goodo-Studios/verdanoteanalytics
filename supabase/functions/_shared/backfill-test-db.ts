// Test-only fake Supabase client for the backfill-post-urls and backfill-launch-dates
// handler tests. Records every creatives update (with the ad_id it targeted) and the
// .or() filters applied to the candidate select, and serves a fixed candidate list.

export interface BackfillTestDb {
  updates: Array<{ ad_id: string | undefined; payload: Record<string, unknown> }>;
  selectOrs: string[];
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
  // deno-lint-ignore no-explicit-any
  rpc(name: string, args?: any): Promise<{ data: unknown; error: null }>;
}

export function makeBackfillTestDb(opts: { candidates: string[]; settingsToken: string | null }): BackfillTestDb {
  const db: BackfillTestDb = {
    updates: [],
    selectOrs: [],
    from(table: string) {
      // deno-lint-ignore no-explicit-any
      const b: any = {};
      let updatePayload: Record<string, unknown> | null = null;
      let adId: string | undefined;
      const rows = () => opts.candidates.map((ad_id) => ({ ad_id }));
      b.select = () => b;
      b.eq = (col: string, val: string) => {
        if (col === "ad_id") adId = val;
        return b;
      };
      b.is = () => b;
      b.gt = () => b;
      b.or = (expr: string) => {
        if (!updatePayload) db.selectOrs.push(expr);
        return b;
      };
      b.order = () => b;
      b.limit = () => Promise.resolve({ data: rows(), error: null });
      b.single = () =>
        Promise.resolve(
          table === "settings" && opts.settingsToken
            ? { data: { value: opts.settingsToken }, error: null }
            : { data: null, error: { message: "no rows" } },
        );
      b.update = (p: Record<string, unknown>) => {
        updatePayload = p;
        return b;
      };
      b.in = (_col: string, ids: string[]) => {
        if (updatePayload) for (const id of ids) db.updates.push({ ad_id: id, payload: updatePayload });
        updatePayload = null;
        return Promise.resolve({ data: null, error: null });
      };
      // deno-lint-ignore no-explicit-any
      b.then = (resolve: (v: any) => void) => {
        if (updatePayload) db.updates.push({ ad_id: adId, payload: updatePayload });
        resolve({ data: null, error: null });
      };
      return b;
    },
    rpc() {
      return Promise.resolve({ data: 0, error: null });
    },
  };
  return db;
}

/** Install a fetch stub that answers every Meta call with `body`; returns the URLs seen. */
export async function withMetaFetch<T>(body: unknown, fn: (urls: string[]) => Promise<T>): Promise<T> {
  const urls: string[] = [];
  const realFetch = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  (globalThis as any).fetch = (input: string | URL | Request) => {
    urls.push(typeof input === "string" ? input : input.toString());
    return Promise.resolve(new Response(JSON.stringify(body)));
  };
  try {
    return await fn(urls);
  } finally {
    globalThis.fetch = realFetch;
  }
}
