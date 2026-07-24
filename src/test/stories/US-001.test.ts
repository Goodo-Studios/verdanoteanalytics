// US-001 — Migrate matrix taxonomy: creative-type, body, and per-account
// Theme/Persona + activation tables.
//
// e2eTests (from the PRD):
//   1. Given the migration applied, when querying information_schema, then
//      creative_lane, creative_type, body, creative_type_menu,
//      account_creative_types, and the creatives.angle_id reference all exist.
//
// The production DB is prod-only and this migration is applied MANUALLY (hard
// policy: no deploys from this story — see MIGRATIONS.md). So there is no live
// Postgres to query information_schema against inside CI/vitest. Instead this
// suite verifies the SAME INTENT statically and deterministically:
//   • Parse the migration SQL and assert the schema objects information_schema
//     WOULD report — the ADD COLUMNs, the FK reference, the two CREATE TABLEs,
//     the five-lane seed — all exist.
//   • Assert the migration is additive-only (no DROP COLUMN / DROP TABLE) and
//     idempotent (IF NOT EXISTS guards + ON CONFLICT DO NOTHING).
//   • Assert the migration number is the strict frontier of the ledger.
//   • Assert src/integrations/supabase/types.ts reached parity: the two new
//     tables and the four new creatives columns are present in the Database
//     type (compile-level type usage + runtime string checks on the source,
//     mirroring how claimSyncContinueSignature.test.ts verifies schema without
//     a DB).
//
// No network, no Docker, no Postgres — pure file reads, so it runs in CI.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Database } from "@/integrations/supabase/types";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../.."); // src/test/stories -> repo root
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");
const TYPES_PATH = path.join(REPO_ROOT, "src", "integrations", "supabase", "types.ts");

const MIGRATION_NUMBER = "20260724000001";
const MIGRATION_FILE = `${MIGRATION_NUMBER}_creative_matrix_taxonomy.sql`;

const LANES = ["Studio video", "Creator", "Static", "Motion", "Video edits"] as const;

// Normalize whitespace so multi-line / multi-space SQL matches predictably.
function collapse(sql: string): string {
  return sql.replace(/\s+/g, " ");
}

const rawSql = readFileSync(path.join(MIGRATIONS_DIR, MIGRATION_FILE), "utf8");
const sql = collapse(rawSql);
// Strip line comments so guards like "-- no DROP COLUMN" don't create false
// positives when asserting the migration contains no destructive statements.
const sqlNoComments = collapse(
  rawSql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n"),
);

describe("US-001: Migrate matrix taxonomy (creative_matrix_taxonomy migration)", () => {
  it("adds the matrix dimension columns to public.creatives (creative_lane, creative_type, body)", () => {
    // information_schema.columns would report these three on public.creatives.
    for (const col of ["creative_lane", "creative_type", "body"]) {
      const re = new RegExp(
        `ALTER TABLE public\\.creatives ADD COLUMN IF NOT EXISTS ${col}\\b`,
        "i",
      );
      expect(sqlNoComments, `expected ADD COLUMN IF NOT EXISTS for creatives.${col}`).toMatch(re);
    }
  });

  it("adds a nullable creatives.angle_id that REFERENCES public.angle_clusters(id)", () => {
    expect(sqlNoComments).toMatch(
      /ALTER TABLE public\.creatives ADD COLUMN IF NOT EXISTS angle_id uuid REFERENCES public\.angle_clusters\(id\)/i,
    );
    // Nullable Theme/Persona ref: no NOT NULL on the angle_id add, and ON DELETE SET NULL.
    expect(sqlNoComments).toMatch(
      /ADD COLUMN IF NOT EXISTS angle_id uuid REFERENCES public\.angle_clusters\(id\) ON DELETE SET NULL/i,
    );
    expect(sqlNoComments).not.toMatch(/angle_id uuid[^;]*NOT NULL/i);
  });

  it("creates the GLOBAL creative_type_menu table with a (lane, type_name) unique natural key", () => {
    expect(sqlNoComments).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.creative_type_menu \(/i,
    );
    // Unique natural key is what makes the seed idempotent.
    expect(sqlNoComments).toMatch(/UNIQUE \(\s*lane,\s*type_name\s*\)/i);
    // Core columns information_schema would report.
    for (const col of ["lane", "type_name", "sort_order"]) {
      expect(sql, `expected creative_type_menu.${col}`).toContain(col);
    }
  });

  it("creates the account-scoped account_creative_types table referencing ad_accounts and creative_type_menu", () => {
    expect(sqlNoComments).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.account_creative_types \(/i,
    );
    expect(sqlNoComments).toMatch(
      /account_id\s+text\s+NOT NULL REFERENCES public\.ad_accounts\(id\)/i,
    );
    expect(sqlNoComments).toMatch(
      /creative_type_id\s+uuid\s+NOT NULL REFERENCES public\.creative_type_menu\(id\)/i,
    );
    // Per-account activation is idempotent on (account_id, creative_type_id).
    expect(sqlNoComments).toMatch(/UNIQUE \(\s*account_id,\s*creative_type_id\s*\)/i);
  });

  it("seeds creative_type_menu with all five house lanes", () => {
    // Seed must be an INSERT into the menu, and every lane label must appear as
    // a seeded value.
    expect(sqlNoComments).toMatch(/INSERT INTO public\.creative_type_menu/i);
    for (const lane of LANES) {
      expect(sql, `expected seed to include lane '${lane}'`).toContain(`'${lane}'`);
    }
  });

  it("is additive-only — no DROP COLUMN, no DROP TABLE, no destructive rewrites", () => {
    expect(sqlNoComments).not.toMatch(/DROP COLUMN/i);
    expect(sqlNoComments).not.toMatch(/DROP TABLE/i);
    expect(sqlNoComments).not.toMatch(/TRUNCATE/i);
    // No column type/rename rewrites on existing tables.
    expect(sqlNoComments).not.toMatch(/ALTER COLUMN/i);
    expect(sqlNoComments).not.toMatch(/RENAME COLUMN/i);
    // The only DROPs allowed are RLS policy drops (DROP POLICY IF EXISTS), which
    // are re-created immediately after — those are not destructive to data.
    const drops = sqlNoComments.match(/DROP \w+/gi) ?? [];
    for (const drop of drops) {
      expect(drop.toUpperCase(), `unexpected destructive DROP: ${drop}`).toBe("DROP POLICY");
    }
  });

  it("is idempotent — IF NOT EXISTS guards on every add and ON CONFLICT DO NOTHING on the seed", () => {
    // Every ALTER TABLE ... ADD COLUMN must carry IF NOT EXISTS.
    const addColumns = sqlNoComments.match(/ADD COLUMN[^;]*/gi) ?? [];
    expect(addColumns.length).toBeGreaterThanOrEqual(4);
    for (const stmt of addColumns) {
      expect(stmt, `ADD COLUMN missing IF NOT EXISTS: ${stmt}`).toMatch(/ADD COLUMN IF NOT EXISTS/i);
    }
    // Every CREATE TABLE must be guarded.
    const createTables = sqlNoComments.match(/CREATE TABLE[^(]*/gi) ?? [];
    expect(createTables.length).toBeGreaterThanOrEqual(2);
    for (const stmt of createTables) {
      expect(stmt, `CREATE TABLE missing IF NOT EXISTS: ${stmt}`).toMatch(/CREATE TABLE IF NOT EXISTS/i);
    }
    // Seed is a no-op on re-run.
    expect(sqlNoComments).toMatch(/ON CONFLICT[^;]*DO NOTHING/i);
  });

  it("is numbered as the strict frontier of the migration ledger (20260724000001 > every other file)", () => {
    const numbers = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.split("_")[0])
      // Only real timestamp-prefixed migrations (14-digit numeric prefix).
      .filter((n) => /^\d{14}$/.test(n));

    expect(numbers).toContain(MIGRATION_NUMBER);

    const others = numbers.filter((n) => n !== MIGRATION_NUMBER);
    for (const other of others) {
      expect(
        MIGRATION_NUMBER > other,
        `expected ${MIGRATION_NUMBER} to be strictly greater than ${other}`,
      ).toBe(true);
    }
    // Explicit check against the immediately-preceding ledger entry.
    expect(MIGRATION_NUMBER > "20260723000005").toBe(true);
  });

  it("has reached type-level parity in src/integrations/supabase/types.ts", () => {
    // Compile-level: these type aliases only resolve if the Database type carries
    // the two new tables and the four new creatives columns. (vite build does not
    // type-check tests, so we ALSO assert on the source text below for a runtime
    // signal — matching claimSyncContinueSignature.test.ts's DB-free approach.)
    type MenuRow = Database["public"]["Tables"]["creative_type_menu"]["Row"];
    type AcctTypeRow = Database["public"]["Tables"]["account_creative_types"]["Row"];
    type CreativeRow = Database["public"]["Tables"]["creatives"]["Row"];

    const menu: MenuRow = { id: "x", lane: "Static", type_name: "Product Shot", sort_order: 0, created_at: "" };
    const acct: AcctTypeRow = {
      id: "x",
      account_id: "a",
      creative_type_id: "c",
      active: true,
      sort_order: 0,
      created_at: "",
    };
    const creativeCols: Pick<CreativeRow, "creative_lane" | "creative_type" | "body" | "angle_id"> = {
      creative_lane: "Static",
      creative_type: "Product Shot",
      body: null,
      angle_id: null,
    };
    expect(menu.lane).toBe("Static");
    expect(acct.account_id).toBe("a");
    expect(creativeCols.creative_lane).toBe("Static");

    // Runtime signal on the generated source: the tables, the new columns, and
    // the angle_id -> angle_clusters FK are all present.
    const typesSrc = readFileSync(TYPES_PATH, "utf8");
    expect(typesSrc).toContain("creative_type_menu:");
    expect(typesSrc).toContain("account_creative_types:");
    for (const col of ["creative_lane", "creative_type", "body", "angle_id"]) {
      expect(typesSrc, `types.ts missing creatives.${col}`).toContain(col);
    }
    expect(typesSrc).toContain('foreignKeyName: "creatives_angle_id_fkey"');
    expect(typesSrc).toContain('referencedRelation: "angle_clusters"');
  });
});
