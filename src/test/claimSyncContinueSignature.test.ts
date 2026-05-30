// Regression guard for the 2026-05-26 sync outage.
//
// claim_sync_continue(p_sync_id ...) is the DB-level claim mutex that every
// /sync/continue call invokes with sync_logs.id. sync_logs.id is a BIGINT
// identity PK. Migration 20260526000001 declared the RPC parameter as `uuid`,
// so PostgREST tried to coerce the bigint id toward uuid and Postgres raised
// "invalid input syntax for type uuid". The continue handler then returned
// before runSyncPhase ran, every sync wedged at phase 1, and cleanup requeued
// it forever — freezing all accounts' last_synced_at.
//
// This test pins the invariant that broke: the WINNING (latest) definition of
// claim_sync_continue must take p_sync_id as the SAME type as sync_logs.id.
// It is RED against the buggy uuid migration and GREEN once the bigint fix
// migration supersedes it — no DB or Docker required, so it runs in CI.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
);

function migrationFilesSorted(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // timestamp-prefixed names sort chronologically
}

// Pull the sync_logs.id column type out of the CREATE TABLE statement.
function syncLogsIdType(): string {
  for (const f of migrationFilesSorted()) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    const table = sql.match(
      /CREATE TABLE\s+(?:public\.)?sync_logs\s*\(([\s\S]*?)\);/i,
    );
    if (!table) continue;
    const idCol = table[1].match(/^\s*id\s+(\w+)/im);
    if (idCol) return idCol[1].toLowerCase();
  }
  throw new Error("could not locate sync_logs.id column definition");
}

// The winning RPC param type = the p_sync_id type in the last migration that
// (re)defines claim_sync_continue.
function winningParamType(): { type: string; file: string } {
  let result: { type: string; file: string } | null = null;
  for (const f of migrationFilesSorted()) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    const m = sql.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+claim_sync_continue\s*\(\s*p_sync_id\s+(\w+)/i,
    );
    if (m) result = { type: m[1].toLowerCase(), file: f };
  }
  if (!result) throw new Error("claim_sync_continue is not defined in any migration");
  return result;
}

describe("claim_sync_continue signature", () => {
  it("sync_logs.id is a bigint identity PK", () => {
    expect(syncLogsIdType()).toBe("bigint");
  });

  it("p_sync_id type matches sync_logs.id (bigint) in the winning definition", () => {
    const { type } = winningParamType();
    expect(type).toBe(syncLogsIdType());
    expect(type).toBe("bigint");
  });

  it("the latest claim_sync_continue migration drops the stale uuid overload", () => {
    const { file } = winningParamType();
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    // Both signatures could otherwise coexist as overloads; the fix must remove
    // the uuid one so resolution can't fall back to the broken function.
    expect(sql).toMatch(
      /DROP\s+FUNCTION\s+IF\s+EXISTS\s+claim_sync_continue\s*\(\s*uuid\s*,/i,
    );
  });
});
