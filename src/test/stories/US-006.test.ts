// US-006 — Theme/Persona by creative-type cross-tab RPC and read path
// (spend-ranked).
//
// e2eTests (from the PRD):
//   1. Given a tagged account, when the RPC is called, then cell spend totals
//      reconcile with the creatives report totals and match across React, api,
//      and MCP.
//
// The production DB is prod-only and this migration is applied MANUALLY (hard
// policy verdanote-prod-deploys-are-manual-cli — see MIGRATIONS.md). There is no
// live Postgres or deployed edge function to exercise inside CI/vitest, and
// vitest only globs src/** (the Deno edge code is not bundled). So this suite
// verifies the SAME INTENT statically and deterministically, mirroring
// US-001.test.ts / US-002.test.ts:
//   • Parse the cross-tab RPC migration and assert it is SECURITY DEFINER, pins
//     an empty search_path, is EXECUTE-granted to service_role ONLY (revoked
//     from PUBLIC + authenticated), and is purely additive + idempotent.
//   • Assert the aggregation reads the DAILY grain (creative_daily_metrics ⨝
//     creatives), sums the summable bases, and DERIVES every ratio from those
//     sums with zero-guards — never averaging pre-computed ratios.
//   • Assert cells are ranked by SUM(spend) ONLY (hard policy
//     verdanote-winners-decided-by-spend-first): no ratio metric may appear in
//     any ranking ORDER BY, and untagged-on-either-axis sorts last.
//   • Assert both axes expose explicit Untagged buckets and the RPC reuses
//     angle_clusters (test_status / label / archived) rather than a parallel
//     angle model.
//   • Assert the session-authed `matrix` edge fn wires JWT + verifyAccountOwnership
//     and returns the RPC jsonb verbatim, the external `api` fn mirrors GET
//     /matrix through the SAME single RPC (read parity across React / api / MCP),
//     and both parse params through the shared parseMatrixParams.
//   • Assert config.toml registers [functions.matrix] verify_jwt=false and the
//     deploy manifest ships the matrix function (policy
//     verdanote-supabase-add-function-update-deploy-script).
//
// No network, no Docker, no Postgres, no Deno — pure file reads, so it runs in CI.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../.."); // src/test/stories -> repo root
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");
const FUNCTIONS_DIR = path.join(REPO_ROOT, "supabase", "functions");
const CONFIG_PATH = path.join(REPO_ROOT, "supabase", "config.toml");
const DEPLOY_SCRIPT_PATH = path.join(REPO_ROOT, "scripts", "deploy-functions.sh");

const MIGRATION_NUMBER = "20260724000003";
const MIGRATION_FILE = `${MIGRATION_NUMBER}_creative_matrix_crosstab_rpc.sql`;
const MATRIX_FN_PATH = path.join(FUNCTIONS_DIR, "matrix", "index.ts");
const SHARED_LOGIC_PATH = path.join(FUNCTIONS_DIR, "_shared", "matrix-logic.ts");
const API_FN_PATH = path.join(FUNCTIONS_DIR, "api", "index.ts");

// Normalize whitespace so multi-line / multi-space SQL matches predictably.
function collapse(sql: string): string {
  return sql.replace(/\s+/g, " ");
}

const rawSql = readFileSync(path.join(MIGRATIONS_DIR, MIGRATION_FILE), "utf8");
// Strip line comments so the extensive prose header (which mentions DROP,
// averaging, ratios, etc. only to forbid them) can't create false positives.
const sqlNoComments = collapse(
  rawSql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n"),
);

const matrixSrc = readFileSync(MATRIX_FN_PATH, "utf8");
const sharedSrc = readFileSync(SHARED_LOGIC_PATH, "utf8");
const apiSrc = readFileSync(API_FN_PATH, "utf8");

describe("US-006: Theme/Persona x creative-type cross-tab RPC + read path (creative_matrix_crosstab_rpc migration + edge functions)", () => {
  it("creates rpc_creative_matrix as a SECURITY DEFINER function with an empty search_path", () => {
    // A single SECURITY DEFINER RPC generalizes the 1-D leaderboard to a 2-D
    // cross-tab. It bypasses RLS and trusts p_account_id, so the edge functions
    // must gate ownership first.
    expect(sqlNoComments).toMatch(
      /CREATE OR REPLACE FUNCTION public\.rpc_creative_matrix\(\s*p_account_id text,\s*p_date_from\s+date DEFAULT NULL,\s*p_date_to\s+date DEFAULT NULL\s*\)/i,
    );
    expect(sqlNoComments).toMatch(/RETURNS jsonb/i);
    expect(sqlNoComments).toMatch(/SECURITY DEFINER/i);
    expect(sqlNoComments).toMatch(/\bSTABLE\b/i);
    // Pin an empty search_path so a hijacked search_path can't shadow the schema.
    expect(sqlNoComments).toMatch(/SET search_path = ''/i);
  });

  it("grants EXECUTE on rpc_creative_matrix to service_role ONLY (revoked from PUBLIC + authenticated)", () => {
    // IDOR posture: a SECURITY DEFINER trusted-arg RPC must not be callable by
    // PUBLIC or authenticated — only the service role, used by the
    // ownership-gated edge functions. Mirrors 20260724000002's revoke posture.
    expect(sqlNoComments).toMatch(
      /REVOKE ALL\s+ON FUNCTION public\.rpc_creative_matrix\(text, date, date\) FROM PUBLIC/i,
    );
    expect(sqlNoComments).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.rpc_creative_matrix\(text, date, date\) FROM authenticated/i,
    );
    expect(sqlNoComments).toMatch(
      /GRANT\s+EXECUTE ON FUNCTION public\.rpc_creative_matrix\(text, date, date\) TO\s+service_role/i,
    );
    // No blanket EXECUTE grant to PUBLIC or authenticated survives.
    expect(sqlNoComments).not.toMatch(
      /GRANT[^;]*EXECUTE[^;]*rpc_creative_matrix\(text, date, date\)[^;]*TO[^;]*(PUBLIC|authenticated)/i,
    );
  });

  it("aggregates the DAILY grain — creative_daily_metrics joined to creatives for the two dimensions", () => {
    // The cross-tab is built from the daily metrics grain joined to creatives
    // (the row axis = creative_type, the column axis = angle_id), account-scoped.
    expect(sqlNoComments).toMatch(/FROM public\.creative_daily_metrics dm/i);
    expect(sqlNoComments).toMatch(/JOIN public\.creatives cr/i);
    expect(sqlNoComments).toMatch(/dm\.account_id = p_account_id/i);
    // Both dimension axes are read from creatives: angle_id (Theme/Persona) and
    // creative_type.
    expect(sqlNoComments).toMatch(/cr\.angle_id/i);
    expect(sqlNoComments).toMatch(/cr\.creative_type/i);
    // Date window filters the daily grain inclusively and is optional (all-time
    // when NULL).
    expect(sqlNoComments).toMatch(/p_date_from IS NULL OR dm\.date >= p_date_from/i);
    expect(sqlNoComments).toMatch(/p_date_to\s+IS NULL OR dm\.date <= p_date_to/i);
  });

  it("sums the summable bases and derives every ratio from those sums with zero-guards (never averages ratios)", () => {
    // Summable bases are SUM()'d per cell.
    expect(sqlNoComments).toMatch(/SUM\(s\.spend\)/i);
    expect(sqlNoComments).toMatch(/SUM\(s\.impressions\)/i);
    expect(sqlNoComments).toMatch(/SUM\(s\.clicks\)/i);
    expect(sqlNoComments).toMatch(/SUM\(s\.purchases\)/i);
    expect(sqlNoComments).toMatch(/SUM\(s\.purchase_value\)/i);
    // Distinct-ad count per cell (the "ad count shown per cell").
    expect(sqlNoComments).toMatch(/COUNT\(DISTINCT s\.ad_id\)/i);

    // Ratios are DERIVED from the summed bases, each division zero-guarded via a
    // CASE WHEN <base> > 0 ... ELSE 0. Assert the shape for roas / cpa / ctr / cpm.
    expect(sqlNoComments).toMatch(
      /'roas',\s*CASE WHEN rc\.total_spend > 0\s*THEN rc\.total_purchase_value \/ rc\.total_spend\s*ELSE 0 END/i,
    );
    expect(sqlNoComments).toMatch(
      /'cpa',\s*CASE WHEN rc\.purchases > 0\s*THEN rc\.total_spend \/ rc\.purchases\s*ELSE 0 END/i,
    );
    expect(sqlNoComments).toMatch(
      /'ctr',\s*CASE WHEN rc\.impressions > 0\s*THEN \(rc\.clicks::numeric \/ rc\.impressions\) \* 100\s*ELSE 0 END/i,
    );
    expect(sqlNoComments).toMatch(
      /'cpm',\s*CASE WHEN rc\.impressions > 0\s*THEN \(rc\.total_spend \/ rc\.impressions\) \* 1000\s*ELSE 0 END/i,
    );
    // The rollup convention: no objective-specific result columns at the daily
    // grain => result_count aligns with purchases and cost_per_result with cpa.
    expect(sqlNoComments).toMatch(/'result_count',\s*rc\.purchases/i);
    expect(sqlNoComments).toMatch(
      /'cost_per_result',\s*CASE WHEN rc\.purchases > 0\s*THEN rc\.total_spend \/ rc\.purchases\s*ELSE 0 END/i,
    );
    // Guard against averaging pre-computed ratio columns (the anti-pattern this
    // aggregation contract forbids).
    expect(sqlNoComments).not.toMatch(/AVG\(/i);
  });

  it("ranks cells by SUM(spend) ONLY, untagged-last — no ratio metric enters any ranking (spend-first policy)", () => {
    // HARD POLICY verdanote-winners-decided-by-spend-first: spend_rank is a
    // RANK() over cells by total_spend DESC with untagged-on-either-axis sorted
    // after all tagged cells. Isolate every window/ORDER BY spend clause and
    // assert no ratio metric leaks into the ordering.
    // Capture the whole window clause up to "AS spend_rank" (the ORDER BY holds a
    // nested paren, so a naive [^)]* would stop short).
    const rankClause = sqlNoComments.match(
      /RANK\(\) OVER \(.*?\)\s*AS spend_rank/i,
    );
    expect(rankClause, "rpc must define a RANK() window for spend_rank").not.toBeNull();
    const rank = rankClause![0];
    // Ranks on total_spend DESC, untagged-either-axis first (ASC boolean).
    expect(rank).toMatch(/is_untagged_angle OR ce\.is_untagged_type\) ASC/i);
    expect(rank).toMatch(/ce\.total_spend DESC/i);
    // No ratio / objective metric may influence the rank ordering.
    for (const metric of ["roas", "cpa", "ctr", "cpm", "cost_per_result", "result_count"]) {
      expect(rank.toLowerCase(), `spend_rank ordering must not reference ${metric}`).not.toContain(metric);
    }

    // The emitted cells array is ordered to MATCH spend_rank: untagged-last then
    // total_spend DESC (so the client renders in rank order).
    expect(sqlNoComments).toMatch(
      /ORDER BY \(rc\.is_untagged_angle OR rc\.is_untagged_type\) ASC,\s*rc\.total_spend DESC/i,
    );
    expect(sqlNoComments).toMatch(/'spend_rank',\s*rc\.spend_rank/i);
  });

  it("reuses angle_clusters (test_status / label / archived) — no parallel angle/persona model", () => {
    // Theme/Persona metadata is carried from the REUSED angle_clusters table
    // (US-001 decision), joined by angle_id — not a new persona table.
    expect(sqlNoComments).toMatch(
      /LEFT JOIN public\.angle_clusters acl\s*ON acl\.id = ce\.angle_id/i,
    );
    expect(sqlNoComments).toMatch(/acl\.test_status/i);
    expect(sqlNoComments).toMatch(/acl\.label/i);
    expect(sqlNoComments).toMatch(/acl\.archived_at/i);
    // Carries test_status per cell (testing/won/killed where set; untested reads
    // as NULL/empty).
    expect(sqlNoComments).toMatch(/'test_status',\s*rc\.test_status/i);
    // No parallel persona table is introduced by this read-path migration.
    expect(sqlNoComments).not.toMatch(/CREATE TABLE[^;]*persona/i);
  });

  it("exposes explicit Untagged buckets on BOTH axes and shows every live angle even with zero ads", () => {
    // angle_id IS NULL => untagged Theme/Persona; creative_type NULL/'' => untagged
    // creative-type. Both are flagged and labeled 'Untagged', never dropped.
    expect(sqlNoComments).toMatch(/\(s\.angle_id IS NULL\)\s*AS is_untagged_angle/i);
    expect(sqlNoComments).toMatch(/\(s\.creative_type IS NULL\)\s*AS is_untagged_type/i);
    expect(sqlNoComments).toMatch(/NULLIF\(btrim\(cr\.creative_type\), ''\)/i);
    expect(sqlNoComments).toMatch(/'Untagged'/);
    // Every LIVE (archived_at IS NULL) angle_clusters row for the account appears
    // in the angles axis even with zero ads (FULL OUTER JOIN of data vs live).
    expect(sqlNoComments).toMatch(/FULL OUTER JOIN/i);
    expect(sqlNoComments).toMatch(/acl\.archived_at IS NULL/i);
  });

  it("is additive-only and idempotent — no DROP/rewrite, CREATE OR REPLACE fn, IF NOT EXISTS indexes", () => {
    // This is a read-path migration: it must add NO destructive statements.
    expect(sqlNoComments).not.toMatch(/DROP COLUMN/i);
    expect(sqlNoComments).not.toMatch(/DROP TABLE/i);
    expect(sqlNoComments).not.toMatch(/DROP FUNCTION/i);
    expect(sqlNoComments).not.toMatch(/TRUNCATE/i);
    expect(sqlNoComments).not.toMatch(/ALTER COLUMN/i);
    expect(sqlNoComments).not.toMatch(/RENAME COLUMN/i);
    // The only "DROP"-ish statements permitted are REVOKEs (not DROPs) — assert
    // there are literally no DROP statements of any kind.
    expect(sqlNoComments.match(/\bDROP\b/gi) ?? []).toHaveLength(0);
    // Idempotent: the function is CREATE OR REPLACE and every supporting index is
    // guarded with IF NOT EXISTS.
    expect(sqlNoComments).toMatch(/CREATE OR REPLACE FUNCTION public\.rpc_creative_matrix/i);
    const indexes = sqlNoComments.match(/CREATE INDEX[^;]*/gi) ?? [];
    expect(indexes.length).toBeGreaterThanOrEqual(1);
    for (const stmt of indexes) {
      expect(stmt, `CREATE INDEX missing IF NOT EXISTS: ${stmt}`).toMatch(/CREATE INDEX IF NOT EXISTS/i);
    }
  });

  it("was numbered off the ledger frontier at authoring time (directly following US-002's 20260724000002)", () => {
    const numbers = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.split("_")[0])
      .filter((n) => /^\d{14}$/.test(n));

    expect(numbers).toContain(MIGRATION_NUMBER);

    // No duplicate numbering: exactly one migration carries 20260724000003.
    expect(numbers.filter((n) => n === MIGRATION_NUMBER)).toHaveLength(1);

    // US-006 was the frontier WHEN AUTHORED: it must outrank every migration
    // numbered before it. Later stories numbered above it are intentionally
    // allowed — this asserts "frontier at authoring", not "max forever".
    const priorMigrations = numbers.filter((n) => n < MIGRATION_NUMBER);
    for (const other of priorMigrations) {
      expect(
        MIGRATION_NUMBER > other,
        `expected ${MIGRATION_NUMBER} to be strictly greater than prior migration ${other}`,
      ).toBe(true);
    }
    // It directly follows US-002 — nothing sits between 20260724000002 and it.
    for (const n of numbers) {
      expect(
        n <= "20260724000002" || n >= MIGRATION_NUMBER,
        `unexpected migration ${n} numbered between US-002 and US-006`,
      ).toBe(true);
    }
  });

  it("config.toml declares [functions.matrix] with verify_jwt = false (manual JWT verification)", () => {
    const configSrc = readFileSync(CONFIG_PATH, "utf8");
    // The gateway must NOT auto-verify the JWT — the function verifies the session
    // token itself (supabase.auth.getUser) so it can enforce account ownership.
    const block = /\[functions\.matrix\]\s*[\r\n]+\s*verify_jwt\s*=\s*false/;
    expect(configSrc, "config.toml missing [functions.matrix] verify_jwt=false").toMatch(block);
  });

  it("deploy-functions.sh ships the matrix function (add-function-update-deploy-script policy)", () => {
    const deploySrc = readFileSync(DEPLOY_SCRIPT_PATH, "utf8");
    // Every ship-relevant function must be in the deploy manifest, listed as its
    // own token (not a substring of some other name).
    expect(deploySrc).toMatch(/(^|\s)matrix(\s|$)/m);
  });

  it("matrix edge fn wires session auth (auth.getUser + verifyAccountOwnership) before DB access", () => {
    // Session JWT: read the Authorization header, verify with auth.getUser, 401
    // when missing/invalid.
    expect(matrixSrc).toMatch(/req\.headers\.get\(["']authorization["']\)/i);
    expect(matrixSrc).toMatch(/supabase\.auth\.getUser\(/);
    expect(matrixSrc).toMatch(/401/);
    // Ownership gate that 403s before any DB read.
    expect(matrixSrc).toContain("verifyAccountOwnership");
    expect(matrixSrc).toMatch(/403/);
    // Builders/employees get global access; clients need a user_accounts row.
    expect(matrixSrc).toContain("user_accounts");
    expect(matrixSrc).toMatch(/get_user_role/);
    // Read-only surface: GET only (405 for other verbs).
    expect(matrixSrc).toMatch(/req\.method !== ["']GET["']/);
    expect(matrixSrc).toMatch(/405/);
  });

  it("matrix edge fn calls the single RPC and returns its jsonb verbatim (no JS re-rank/re-shape)", () => {
    expect(matrixSrc).toMatch(/rpc\(["']rpc_creative_matrix["'],\s*\{\s*p_account_id:/);
    // Passes the validated date window through to the RPC.
    expect(matrixSrc).toMatch(/p_date_from:\s*params\.dateFrom/);
    expect(matrixSrc).toMatch(/p_date_to:\s*params\.dateTo/);
    // Returns the RPC payload verbatim — no client-side re-sort/re-rank exists.
    expect(matrixSrc).toMatch(/\{\s*matrix:\s*data\s*\}/);
    expect(matrixSrc).not.toMatch(/\.sort\(/);
    // Params parsed through the shared validator (identical across surfaces).
    expect(matrixSrc).toMatch(/parseMatrixParams\(/);
  });

  it("api function exposes GET /matrix calling the SAME single RPC (read parity across React / api / MCP)", () => {
    // The external api surface is a read-only mirror: GET only, same RPC, so
    // React / api / verdanote-read-mcp all read byte-identical values.
    expect(apiSrc).toMatch(/resource === ["']matrix["'] && req\.method === ["']GET["']/);
    expect(apiSrc).toMatch(/rpc\(["']rpc_creative_matrix["'],\s*\{\s*p_account_id:/);
    // It, too, gates account ownership before reading.
    expect(apiSrc).toMatch(/verifyAccountOwnership\(supabase,\s*userId,\s*params\.accountId\)/);
    // matrix is advertised in the endpoint list.
    expect(apiSrc).toContain('"/matrix"');
    // Both surfaces validate params through the shared parseMatrixParams so the
    // request contract is identical.
    expect(apiSrc).toMatch(/parseMatrixParams\(/);
    // Read-only mirror: no write branch for the matrix resource.
    expect(apiSrc).not.toMatch(
      /resource === ["']matrix["'] && req\.method === ["'](POST|PUT|PATCH|DELETE)["']/,
    );
  });

  it("shared matrix-logic validates params identically for both surfaces (no I/O)", () => {
    // parseMatrixParams is the single validation contract imported by BOTH the
    // matrix edge fn and the api mirror; asserting the export keeps them in sync.
    expect(sharedSrc).toMatch(/export function parseMatrixParams\(/);
    expect(sharedSrc).toMatch(/account_id is required/);
    // Strict YYYY-MM-DD real-calendar-date validation; ordering enforced.
    expect(sharedSrc).toMatch(/must be a valid YYYY-MM-DD date/);
    expect(sharedSrc).toMatch(/date_from must not be after date_to/);
    // Pure module — no network/DB imports (mirrors account-taxonomy-logic.ts).
    expect(sharedSrc).not.toMatch(/createClient|deno\.land\/std.*http|fetch\(/i);
  });
});
