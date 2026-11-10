// A small fake of the Supabase client for edge function tests. No database, no network.
//
// It records every query (table, verb, filters) and answers from canned rows, so a test can
// check both what the function returned and which writes it made. Filters are recorded but not
// applied: give each table the rows the query under test should see, or a function that picks
// rows from the recorded filters.
//
//   const db = fakeSupabase({ user: { id: "u1" }, tables: { user_roles: [{ role: "client" }] } });
//   await handler(req, { createClient: () => db.client });
//   assertEquals(db.writes(), []);

export interface Op {
  table: string;
  verb: "select" | "insert" | "update" | "delete" | "upsert";
  /** Columns for a select, the row(s) for insert, upsert and update. */
  payload?: unknown;
  /** Each filter as [method, column, value], for example ["eq", "user_id", "u1"]. */
  filters: Array<[string, string, unknown]>;
}

type Result = { data: unknown; error?: unknown; count?: number | null };
type TableAnswer = unknown[] | Result | ((op: Op) => unknown[] | Result);

export interface FakeConfig {
  /** The signed-in user, or null for a token that does not resolve. */
  user?: { id: string; email?: string } | null;
  authError?: unknown;
  tables?: Record<string, TableAnswer>;
  /** Answers of rpc(name). */
  rpc?: Record<string, unknown>;
  /** Error returned by auth.admin.createUser. */
  createUserError?: { message: string };
}

export function fakeSupabase(cfg: FakeConfig = {}) {
  const ops: Op[] = [];
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  const admin = { created: [] as unknown[], deleted: [] as string[] };

  const answerFor = (op: Op, single: boolean): Result => {
    if (op.verb !== "select") return { data: null, error: null };
    let t = cfg.tables?.[op.table];
    if (typeof t === "function") t = t(op);
    if (t && !Array.isArray(t) && typeof t === "object" && "data" in t) return t as Result;
    const rows = Array.isArray(t) ? t : [];
    return { data: single ? (rows[0] ?? null) : rows, error: null, count: rows.length };
  };

  const from = (table: string) => {
    const op: Op = { table, verb: "select", filters: [] };
    ops.push(op);
    let single = false;
    // deno-lint-ignore no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    const verb = (v: Op["verb"]) => (payload?: unknown) => {
      if (op.verb === "select" && v !== "select") op.verb = v;
      if (v !== "select" || op.payload === undefined) op.payload = payload;
      return b;
    };
    b.select = (cols?: unknown) => {
      if (op.verb === "select") op.payload = cols;
      return b;
    };
    b.insert = verb("insert");
    b.update = verb("update");
    b.upsert = verb("upsert");
    b.delete = verb("delete");
    for (const m of ["eq", "neq", "in", "gt", "gte", "lt", "lte", "is", "not", "ilike", "like"]) {
      b[m] = (col: string, ...rest: unknown[]) => {
        op.filters.push([m, col, rest.length > 1 ? rest : rest[0]]);
        return b;
      };
    }
    for (const m of ["order", "limit", "range"]) b[m] = () => b;
    b.single = () => {
      single = true;
      return b;
    };
    b.maybeSingle = b.single;
    b.then = (resolve: (v: Result) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(answerFor(op, single)).then(resolve, reject);
    return b;
  };

  const client = {
    from,
    rpc: (name: string, args?: unknown) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: cfg.rpc?.[name] ?? null, error: null });
    },
    auth: {
      getUser: (_token?: string) =>
        Promise.resolve({
          data: { user: cfg.user === undefined ? null : cfg.user },
          error: cfg.authError ?? null,
        }),
      admin: {
        createUser: (args: unknown) => {
          admin.created.push(args);
          if (cfg.createUserError) return Promise.resolve({ data: { user: null }, error: cfg.createUserError });
          return Promise.resolve({ data: { user: { id: "new-user-id" } }, error: null });
        },
        deleteUser: (id: string) => {
          admin.deleted.push(id);
          return Promise.resolve({ data: null, error: null });
        },
      },
    },
  };

  return {
    // deno-lint-ignore no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: client as any,
    ops,
    rpcCalls,
    admin,
    /** Every insert, update, upsert and delete made, in order. */
    writes: () => ops.filter((o) => o.verb !== "select"),
    /** True when nothing was written and no auth user was created or deleted. */
    untouched: () => ops.every((o) => o.verb === "select") && admin.created.length === 0 && admin.deleted.length === 0,
  };
}

/** A createClient stand-in that records how it was called and hands back one fake. */
export function fakeCreateClient(db: ReturnType<typeof fakeSupabase>) {
  const calls: Array<{ url: string; key: string; options?: unknown }> = [];
  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createClient: any = (url: string, key: string, options?: unknown) => {
    calls.push({ url, key, options });
    return db.client;
  };
  return { createClient, calls };
}

/** Set environment variables for one test and put them back afterwards. */
export async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const before: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    before[k] = Deno.env.get(k);
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

/** Replace globalThis.fetch for one test. The stub gets every request and answers it. */
export async function withFetch(
  stub: (url: string, init?: RequestInit) => Response | Promise<Response>,
  fn: (calls: Array<{ url: string; init?: RequestInit }>) => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return Promise.resolve(stub(url, init));
  }) as typeof fetch;
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}
