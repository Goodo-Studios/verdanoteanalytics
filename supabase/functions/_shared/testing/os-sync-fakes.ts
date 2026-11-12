// Test stand-ins for the OS-007 ClickUp copy: an in-memory Supabase with the query methods the
// sync uses, and a ClickUp fetch that answers from a route table and records every call.
// Test-only; no function imports this.

import type { DbQuery, DbResult, FetchLike, SupabaseLike } from "../os-clickup-sync.ts";

type Row = Record<string, unknown>;
type Pred = (r: Row) => boolean;

export interface FakeDbOptions {
  tables?: Record<string, Row[]>;
  /** auth.users email -> id, for os_user_ids_by_email. */
  users?: Record<string, string>;
  /** "table:op" pairs that answer with an error (op: select, upsert, insert, update, delete). */
  fail?: string[];
}

const CONFLICT_DEFAULT_ID: Record<string, boolean> = { os_tasks: true, os_sync_runs: true };

export function fakeDb(opts: FakeDbOptions = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(opts.tables ?? {})) tables[k] = v.map((r) => ({ ...r }));
  const log: { table: string; op: string; rows?: Row[]; filters: string[] }[] = [];
  const fail = new Set(opts.fail ?? []);
  const t = (name: string) => (tables[name] ??= []);

  function query(table: string): DbQuery {
    let op = "select";
    let payload: Row[] = [];
    let values: Row = {};
    let onConflict = "";
    let ignoreDuplicates = false;
    let returning = false;
    const preds: Pred[] = [];
    const filters: string[] = [];
    let orderBy: { col: string; asc: boolean } | null = null;
    let from = 0;
    let to = Infinity;

    const q: DbQuery = {
      select() {
        if (op !== "select") returning = true;
        return q;
      },
      eq(c, v) {
        filters.push(`eq ${c}=${v}`);
        preds.push((r) => r[c] === v);
        return q;
      },
      in(c, vs) {
        filters.push(`in ${c}`);
        preds.push((r) => vs.includes(r[c]));
        return q;
      },
      not(c, operator, v) {
        filters.push(`not ${c} ${operator} ${v}`);
        if (operator === "is" && v === null) preds.push((r) => r[c] !== null && r[c] !== undefined);
        else if (operator === "like") {
          const prefix = String(v).replace(/%$/, "");
          preds.push((r) => !String(r[c] ?? "").startsWith(prefix));
        } else if (operator === "in") {
          const ids = String(v).replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, ""));
          preds.push((r) => r[c] !== null && r[c] !== undefined && !ids.includes(String(r[c])));
        }
        return q;
      },
      lt(c, v) {
        filters.push(`lt ${c}`);
        preds.push((r) => r[c] !== null && r[c] !== undefined && String(r[c]) < v);
        return q;
      },
      order(c, o) {
        orderBy = { col: c, asc: o?.ascending !== false };
        return q;
      },
      limit(n) {
        to = from + n - 1;
        return q;
      },
      range(a, b) {
        from = a;
        to = b;
        return q;
      },
      upsert(rows, o) {
        op = "upsert";
        payload = (rows as Row[]).map((r) => ({ ...r }));
        onConflict = o.onConflict;
        ignoreDuplicates = !!o.ignoreDuplicates;
        return q;
      },
      insert(rows) {
        op = "insert";
        payload = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ ...r }));
        return q;
      },
      update(v) {
        op = "update";
        values = { ...v };
        return q;
      },
      delete() {
        op = "delete";
        return q;
      },
      then(resolve, reject) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };

    function run(): DbResult {
      log.push({ table, op, rows: payload.length ? payload : undefined, filters });
      if (fail.has(`${table}:${op}`)) return { data: null, error: { message: `${table} ${op} refused` } };
      const rows = t(table);
      const match = (r: Row) => preds.every((p) => p(r));
      if (op === "select") {
        let out = rows.filter(match);
        if (orderBy) {
          const { col, asc } = orderBy;
          out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
        }
        return { data: out.slice(from, to === Infinity ? undefined : to + 1).map((r) => ({ ...r })), error: null };
      }
      if (op === "insert") {
        for (const r of payload) {
          if (CONFLICT_DEFAULT_ID[table] && !r.id) r.id = crypto.randomUUID();
          rows.push(r);
        }
        return { data: returning ? payload.map((r) => ({ ...r })) : null, error: null };
      }
      if (op === "upsert") {
        const out: Row[] = [];
        for (const r of payload) {
          const hit = rows.find((x) => x[onConflict] === r[onConflict]);
          if (hit) {
            if (!ignoreDuplicates) Object.assign(hit, r);
            out.push(hit);
          } else {
            if (CONFLICT_DEFAULT_ID[table] && !r.id) r.id = crypto.randomUUID();
            rows.push(r);
            out.push(r);
          }
        }
        return { data: returning ? out.map((r) => ({ ...r })) : null, error: null };
      }
      if (op === "update") {
        const hit = rows.filter(match);
        for (const r of hit) Object.assign(r, values);
        return { data: returning ? hit : null, error: null };
      }
      // delete
      const gone = rows.filter(match);
      tables[table] = rows.filter((r) => !match(r));
      return { data: returning ? gone : null, error: null, count: gone.length };
    }
    return q;
  }

  const supabase: SupabaseLike = {
    from: (table: string) => query(table),
    rpc: (fn: string, args: Record<string, unknown>) => {
      log.push({ table: `rpc:${fn}`, op: "rpc", filters: [] });
      if (fn !== "os_user_ids_by_email") return Promise.resolve({ data: null, error: { message: "unknown rpc" } });
      const emails = (args.p_emails as string[]).map((e) => e.toLowerCase());
      const data = Object.entries(opts.users ?? {})
        .filter(([e]) => emails.includes(e.toLowerCase()))
        .map(([email, user_id]) => ({ email: email.toLowerCase(), user_id }));
      return Promise.resolve({ data, error: null });
    },
  };
  return { supabase, tables: () => tables, table: t, log };
}

export interface FetchCall {
  method: string;
  url: string;
}

/** A ClickUp stand-in. `routes` maps a path (no query) to a body, or a function of the full path. */
export function fakeClickUp(routes: Record<string, unknown | ((path: string) => unknown)>, failing: Record<string, number> = {}) {
  const calls: FetchCall[] = [];
  const fetchFn: FetchLike = (url, init) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    const path = url.replace("https://api.clickup.com/api/v2", "");
    const bare = path.split("?")[0];
    if (failing[bare]) return Promise.resolve(new Response("nope", { status: failing[bare] }));
    const route = routes[bare];
    if (route === undefined) return Promise.resolve(new Response("not found", { status: 404 }));
    const body = typeof route === "function" ? (route as (p: string) => unknown)(path) : route;
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
  return { fetch: fetchFn, calls };
}
