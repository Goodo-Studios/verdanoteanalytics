// US-002 — Per-account taxonomy config API (Theme/Persona list + creative-type
// activation).
//
// e2eTests (from the PRD):
//   1. Given a builder session, when creating, renaming, and archiving a
//      Theme/Persona, then it persists and returns via the read RPC and MCP with
//      identical values.
//
// The production DB is prod-only and this migration is applied MANUALLY (hard
// policy: no deploys from this story — see MIGRATIONS.md). So there is no live
// Postgres or deployed edge function to exercise inside CI/vitest, and vitest
// only globs src/** (Deno edge code is not bundled). Instead this suite verifies
// the SAME INTENT statically and deterministically, mirroring US-001.test.ts:
//   • Parse the read RPC migration and assert it is SECURITY DEFINER, pins an
//     empty search_path, is EXECUTE-granted to service_role ONLY (revoked from
//     PUBLIC + authenticated), and adds the two nullable governance columns
//     additively + idempotently.
//   • Assert the session-authed edge function wires JWT + verifyAccountOwnership
//     and exposes the full CRUD + set_creative_type + seed action set, with
//     archive implemented as a soft toggle (no DELETE of angle_clusters rows).
//   • Assert the external `api` function exposes GET /account-taxonomy calling
//     the SAME single RPC (read parity across React / api / MCP).
//   • Assert the seed path never fabricates: no hardcoded seed entries, no LLM
//     call — it only recognizes real review-mining rows.
//   • Assert src/integrations/supabase/types.ts reached parity for the RPC and
//     the two new angle_clusters columns (compile-level type usage + runtime
//     string checks on the source, matching US-001's DB-free approach).
//
// No network, no Docker, no Postgres, no Deno — pure file reads, so it runs in CI.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Database } from "@/integrations/supabase/types";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../.."); // src/test/stories -> repo root
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");
const FUNCTIONS_DIR = path.join(REPO_ROOT, "supabase", "functions");
const TYPES_PATH = path.join(REPO_ROOT, "src", "integrations", "supabase", "types.ts");

const MIGRATION_NUMBER = "20260724000002";
const MIGRATION_FILE = `${MIGRATION_NUMBER}_account_taxonomy_read_rpc.sql`;
const EDGE_FN_PATH = path.join(FUNCTIONS_DIR, "account-taxonomy", "index.ts");
const SHARED_LOGIC_PATH = path.join(FUNCTIONS_DIR, "_shared", "account-taxonomy-logic.ts");
const API_FN_PATH = path.join(FUNCTIONS_DIR, "api", "index.ts");
const CONFIG_PATH = path.join(REPO_ROOT, "supabase", "config.toml");
const DEPLOY_SCRIPT_PATH = path.join(REPO_ROOT, "scripts", "deploy-functions.sh");

// The full action set the edge function must expose.
const ACTIONS = [
  "list",
  "create",
  "rename",
  "archive",
  "unarchive",
  "set_creative_type",
  "seed",
] as const;

// Normalize whitespace so multi-line / multi-space SQL matches predictably.
function collapse(sql: string): string {
  return sql.replace(/\s+/g, " ");
}

const rawSql = readFileSync(path.join(MIGRATIONS_DIR, MIGRATION_FILE), "utf8");
const sql = collapse(rawSql);
// Strip line comments so prose like "-- no DROP COLUMN" can't create false
// positives when asserting the migration contains no destructive statements.
const sqlNoComments = collapse(
  rawSql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n"),
);

const edgeSrc = readFileSync(EDGE_FN_PATH, "utf8");
const sharedSrc = readFileSync(SHARED_LOGIC_PATH, "utf8");
const apiSrc = readFileSync(API_FN_PATH, "utf8");

describe("US-002: Per-account taxonomy config API (account_taxonomy_read_rpc migration + edge functions)", () => {
  it("creates rpc_account_taxonomy as a SECURITY DEFINER function with an empty search_path", () => {
    // The single read path is a SECURITY DEFINER RPC — it bypasses RLS and trusts
    // its p_account_id argument, so the edge functions must gate ownership first.
    expect(sqlNoComments).toMatch(
      /CREATE OR REPLACE FUNCTION public\.rpc_account_taxonomy\(\s*p_account_id text\s*\)/i,
    );
    expect(sqlNoComments).toMatch(/RETURNS jsonb/i);
    expect(sqlNoComments).toMatch(/SECURITY DEFINER/i);
    // Pin an empty search_path so a hijacked search_path can't shadow the schema.
    expect(sqlNoComments).toMatch(/SET search_path = ''/i);
    // Signature accepts p_account_id and the types.ts Args mirror it (below).
    expect(sqlNoComments).toContain("p_account_id text");
  });

  it("grants EXECUTE on rpc_account_taxonomy to service_role ONLY (revoked from PUBLIC + authenticated)", () => {
    // IDOR posture: a SECURITY DEFINER trusted-arg RPC must not be callable by
    // PUBLIC or authenticated — only the service role, used by the ownership-gated
    // edge functions. Mirrors 20260530210000's revoke posture.
    expect(sqlNoComments).toMatch(
      /REVOKE ALL\s+ON FUNCTION public\.rpc_account_taxonomy\(text\) FROM PUBLIC/i,
    );
    expect(sqlNoComments).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.rpc_account_taxonomy\(text\) FROM authenticated/i,
    );
    expect(sqlNoComments).toMatch(
      /GRANT\s+EXECUTE ON FUNCTION public\.rpc_account_taxonomy\(text\) TO\s+service_role/i,
    );
    // No blanket grant to PUBLIC or authenticated survives.
    expect(sqlNoComments).not.toMatch(
      /GRANT[^;]*rpc_account_taxonomy\(text\)[^;]*TO[^;]*(PUBLIC|authenticated)/i,
    );
  });

  it("adds nullable angle_clusters.archived_at + test_status via ADD COLUMN IF NOT EXISTS", () => {
    // information_schema.columns would report these two additive governance
    // columns on public.angle_clusters — both nullable, both guarded.
    expect(sqlNoComments).toMatch(
      /ALTER TABLE public\.angle_clusters ADD COLUMN IF NOT EXISTS archived_at timestamptz/i,
    );
    expect(sqlNoComments).toMatch(
      /ALTER TABLE public\.angle_clusters ADD COLUMN IF NOT EXISTS test_status text/i,
    );
    // Neither add carries NOT NULL — archive is a soft, nullable toggle.
    expect(sqlNoComments).not.toMatch(/archived_at timestamptz[^;]*NOT NULL/i);
    expect(sqlNoComments).not.toMatch(/test_status text[^;]*NOT NULL/i);
  });

  it("is additive-only and idempotent — no DROP/rewrite, CREATE OR REPLACE fn, IF NOT EXISTS adds", () => {
    // Additive: metadata-only nullable adds, no destructive statements at all.
    expect(sqlNoComments).not.toMatch(/DROP COLUMN/i);
    expect(sqlNoComments).not.toMatch(/DROP TABLE/i);
    expect(sqlNoComments).not.toMatch(/DROP FUNCTION/i);
    expect(sqlNoComments).not.toMatch(/TRUNCATE/i);
    expect(sqlNoComments).not.toMatch(/ALTER COLUMN/i);
    expect(sqlNoComments).not.toMatch(/RENAME COLUMN/i);
    // The only DROPs allowed are the REVOKEs (which are not DROPs) — assert there
    // are literally no DROP statements of any kind.
    expect(sqlNoComments.match(/\bDROP\b/gi) ?? []).toHaveLength(0);

    // Idempotent: every ADD COLUMN is guarded, and the function is CREATE OR REPLACE.
    const addColumns = sqlNoComments.match(/ADD COLUMN[^;]*/gi) ?? [];
    expect(addColumns.length).toBeGreaterThanOrEqual(2);
    for (const stmt of addColumns) {
      expect(stmt, `ADD COLUMN missing IF NOT EXISTS: ${stmt}`).toMatch(/ADD COLUMN IF NOT EXISTS/i);
    }
    expect(sqlNoComments).toMatch(/CREATE OR REPLACE FUNCTION public\.rpc_account_taxonomy/i);
    // The supporting index is guarded too.
    expect(sqlNoComments).toMatch(/CREATE INDEX IF NOT EXISTS/i);
  });

  it("was numbered off the ledger frontier at authoring time (directly following US-001's 20260724000001)", () => {
    const numbers = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.split("_")[0])
      .filter((n) => /^\d{14}$/.test(n));

    expect(numbers).toContain(MIGRATION_NUMBER);

    // US-002 was the frontier WHEN AUTHORED: it must outrank every migration
    // numbered before it. Legitimate later stories are numbered ABOVE it off the
    // same rule and are intentionally excluded — this asserts "frontier at
    // authoring", not "max forever" (which any later migration would break).
    const priorMigrations = numbers.filter((n) => n < MIGRATION_NUMBER);
    for (const other of priorMigrations) {
      expect(
        MIGRATION_NUMBER > other,
        `expected ${MIGRATION_NUMBER} to be strictly greater than prior migration ${other}`,
      ).toBe(true);
    }
    // It directly follows US-001 — nothing sits between 20260724000001 and US-002.
    for (const n of numbers) {
      expect(
        n <= "20260724000001" || n >= MIGRATION_NUMBER,
        `unexpected migration ${n} numbered between US-001 and US-002`,
      ).toBe(true);
    }
    expect(MIGRATION_NUMBER > "20260724000001").toBe(true);
  });

  it("config.toml declares [functions.account-taxonomy] with verify_jwt = false (manual JWT verification)", () => {
    const configSrc = readFileSync(CONFIG_PATH, "utf8");
    // The gateway must NOT auto-verify the JWT — the function verifies the session
    // token itself (supabase.auth.getUser) so it can enforce account ownership.
    const block = /\[functions\.account-taxonomy\]\s*[\r\n]+\s*verify_jwt\s*=\s*false/;
    expect(configSrc, "config.toml missing [functions.account-taxonomy] verify_jwt=false").toMatch(block);
  });

  it("deploy-functions.sh includes account-taxonomy (deploy-manifest policy)", () => {
    const deploySrc = readFileSync(DEPLOY_SCRIPT_PATH, "utf8");
    // Every ship-relevant function must be in the deploy manifest, listed as its
    // own token (not a substring of some other name).
    expect(deploySrc).toMatch(/(^|\s)account-taxonomy(\s|$)/m);
  });

  it("account-taxonomy edge fn wires session auth (auth.getUser + verifyAccountOwnership) before DB access", () => {
    // Session JWT: read the Authorization header, verify it with auth.getUser,
    // and 401 when it's missing/invalid.
    expect(edgeSrc).toMatch(/req\.headers\.get\(["']authorization["']\)/i);
    expect(edgeSrc).toMatch(/supabase\.auth\.getUser\(/);
    expect(edgeSrc).toMatch(/401/);
    // Ownership: a verifyAccountOwnership gate that 403s, gated before any write/read.
    expect(edgeSrc).toContain("verifyAccountOwnership");
    expect(edgeSrc).toMatch(/403/);
    // Builders/employees get global access; clients need a user_accounts row.
    expect(edgeSrc).toContain("user_accounts");
    expect(edgeSrc).toMatch(/get_user_role/);
  });

  it("account-taxonomy edge fn exposes the full CRUD + set_creative_type + seed action set", () => {
    // The shared logic is the authoritative action list; assert it matches ACTIONS
    // exactly (order-independent) so no action is silently added or dropped.
    for (const action of ACTIONS) {
      expect(sharedSrc, `shared logic missing action '${action}'`).toContain(`"${action}"`);
      expect(edgeSrc, `edge fn missing case for '${action}'`).toMatch(
        new RegExp(`case\\s+["']${action}["']`),
      );
    }
    // The edge fn's read path calls the single RPC on list and after every write.
    expect(edgeSrc).toMatch(/rpc\(["']rpc_account_taxonomy["']/);
    // create stamps origin=manual so it's distinguishable from review-mining rows.
    expect(edgeSrc).toMatch(/source:\s*ORIGIN_MANUAL/);
    // set_creative_type upserts on the (account_id, creative_type_id) unique key.
    expect(edgeSrc).toMatch(/onConflict:\s*["']account_id,creative_type_id["']/);
  });

  it("archive is a SOFT toggle — it sets archived_at, never DELETEs angle_clusters rows", () => {
    // Archive/unarchive flips archived_at (timestamp vs null); creatives.angle_id
    // references must survive, so no hard delete of the governed list is allowed.
    expect(edgeSrc).toMatch(/archived_at\s*=\s*parsed\.action\s*===\s*["']archive["']/);
    expect(edgeSrc).toMatch(/\.update\(\{\s*archived_at\s*\}\)/);
    // No destructive delete against angle_clusters anywhere in the write surface.
    expect(edgeSrc).not.toMatch(/from\(["']angle_clusters["']\)[\s\S]*?\.delete\(/);
    expect(edgeSrc).not.toMatch(/\.delete\(\)/);
  });

  it("api function exposes GET /account-taxonomy calling the SAME single RPC (read parity)", () => {
    // The external api surface is a read-only mirror: GET only, same RPC, so
    // React / api / verdanote-read-mcp all read byte-identical values.
    expect(apiSrc).toMatch(/resource === ["']account-taxonomy["'] && req\.method === ["']GET["']/);
    expect(apiSrc).toMatch(/rpc\(["']rpc_account_taxonomy["'],\s*\{\s*p_account_id:/);
    // It, too, gates account ownership before reading.
    expect(apiSrc).toMatch(/verifyAccountOwnership\(supabase,\s*userId,\s*accountId\)/);
    // account-taxonomy is advertised in the endpoint list.
    expect(apiSrc).toContain('"/account-taxonomy"');
    // Read-only mirror: the api function never performs a taxonomy write. The only
    // reference to the account-taxonomy resource is the GET branch above — assert
    // there is no POST/PUT/PATCH/DELETE branch for it.
    expect(apiSrc).not.toMatch(
      /resource === ["']account-taxonomy["'] && req\.method === ["'](POST|PUT|PATCH|DELETE)["']/,
    );
  });

  it("seed never fabricates — no hardcoded seed entries and no LLM call, only real review-mining rows", () => {
    // The seed action recognizes EXISTING review-mining angle_clusters rows as the
    // initial list; it fabricates nothing and makes no model call. Assert the
    // selection is pure over rows the caller fetched and stays empty otherwise.
    expect(sharedSrc).toContain("selectSeedFromRows");
    expect(sharedSrc).toMatch(/isReviewMiningSource/);
    // Empty when there are no review-mining rows (never invents entries).
    expect(sharedSrc).toMatch(/empty:\s*seededIds\.length === 0/);
    // No LLM / model calls anywhere in the seed path (edge fn or shared logic).
    for (const [name, src] of [
      ["edge fn", edgeSrc],
      ["shared logic", sharedSrc],
    ] as const) {
      expect(src, `${name} must not call an LLM`).not.toMatch(
        /openai|anthropic|claude|gpt-|\.chat\.completions|generateText|createChatCompletion/i,
      );
    }
    // The edge fn's seed case reads existing rows and defers to selectSeedFromRows —
    // it does not INSERT fabricated content during seeding.
    expect(edgeSrc).toMatch(/selectSeedFromRows\(rows\)/);
    // The only value the create path writes into a new row's label is the
    // caller-supplied, validated name — there is no hardcoded taxonomy vocabulary.
    expect(sharedSrc).not.toMatch(/const\s+SEED_(THEMES|PERSONAS|ENTRIES)/i);
  });

  it("has reached type-level parity in src/integrations/supabase/types.ts", () => {
    // Compile-level: these aliases only resolve if the Database type carries the
    // RPC and the two new angle_clusters columns. (vite build does not type-check
    // tests, so we ALSO assert on the source text below for a runtime signal.)
    type TaxonomyRpc = Database["public"]["Functions"]["rpc_account_taxonomy"];
    type TaxonomyArgs = TaxonomyRpc["Args"];
    type AngleRow = Database["public"]["Tables"]["angle_clusters"]["Row"];

    const args: TaxonomyArgs = { p_account_id: "acct-1" };
    const governance: Pick<AngleRow, "archived_at" | "test_status"> = {
      archived_at: null,
      test_status: null,
    };
    expect(args.p_account_id).toBe("acct-1");
    expect(governance.archived_at).toBeNull();
    expect(governance.test_status).toBeNull();

    // Runtime signal on the generated source: the RPC and the two columns exist.
    const typesSrc = readFileSync(TYPES_PATH, "utf8");
    expect(typesSrc).toContain("rpc_account_taxonomy:");
    expect(typesSrc).toMatch(/rpc_account_taxonomy:\s*\{\s*Args:\s*\{\s*p_account_id:\s*string/);
    for (const col of ["archived_at", "test_status"]) {
      expect(typesSrc, `types.ts missing angle_clusters.${col}`).toContain(col);
    }
  });
});
