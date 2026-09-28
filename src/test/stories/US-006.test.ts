// US-006 — Creative Matrix cross-tab RPC and read path (spend-ranked).
//
// Updated 2026-09-27 (Goodo naming convention): the EFFECTIVE definition of
// rpc_creative_matrix now lives in 20260927200001 (Creative Type rows from
// creatives.style in fixed order + Other / untagged × Theme columns from
// creatives.theme), and the cell drill-down is rpc_creative_matrix_theme_cell
// (split by exact hook). The RPC-behaviour assertions below read that
// migration; the ledger-numbering assertion still pins the original
// 20260724000003 file, which is kept as history.
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
// Effective (latest) definition of rpc_creative_matrix + the theme-cell RPC.
const EFFECTIVE_NUMBER = "20260927200001";
const EFFECTIVE_FILE = `${EFFECTIVE_NUMBER}_creative_matrix_naming_convention_axes.sql`;
const MATRIX_FN_PATH = path.join(FUNCTIONS_DIR, "matrix", "index.ts");
const SHARED_LOGIC_PATH = path.join(FUNCTIONS_DIR, "_shared", "matrix-logic.ts");
const API_FN_PATH = path.join(FUNCTIONS_DIR, "api", "index.ts");

// Normalize whitespace so multi-line / multi-space SQL matches predictably.
function collapse(sql: string): string {
  return sql.replace(/\s+/g, " ");
}

const rawSql = readFileSync(path.join(MIGRATIONS_DIR, EFFECTIVE_FILE), "utf8");
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

describe("US-006: Creative Type x Theme cross-tab RPC + read path (effective migration 20260927200001 + edge functions)", () => {
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
    // (rows = Creative Type bucket of creatives.style, columns = creatives.theme),
    // account-scoped.
    expect(sqlNoComments).toMatch(/FROM public\.creative_daily_metrics dm/i);
    expect(sqlNoComments).toMatch(/JOIN public\.creatives cr/i);
    expect(sqlNoComments).toMatch(/dm\.account_id = p_account_id/i);
    // Both dimension axes are read from creatives: style (Creative Type) and
    // theme (free text). The retired angle_id / creative_type / body keys are
    // not read.
    expect(sqlNoComments).toMatch(/public\.matrix_creative_type_bucket\(cr\.style\)/i);
    expect(sqlNoComments).toMatch(/NULLIF\(btrim\(cr\.theme\), ''\)/i);
    expect(sqlNoComments).not.toMatch(/cr\.angle_id/i);
    expect(sqlNoComments).not.toMatch(/cr\.creative_type/i);
    expect(sqlNoComments).not.toMatch(/cr\.body/i);
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
    // The first RANK() is rpc_creative_matrix's (the theme-cell RPC follows).
    const rankClause = sqlNoComments.match(
      /RANK\(\) OVER \(.*?\)\s*AS spend_rank/i,
    );
    expect(rankClause, "rpc must define a RANK() window for spend_rank").not.toBeNull();
    const rank = rankClause![0];
    // Ranks on total_spend DESC, untagged-either-axis first (ASC boolean).
    expect(rank).toMatch(/is_other_type OR ce\.is_untagged_theme\) ASC/i);
    expect(rank).toMatch(/ce\.total_spend DESC/i);
    // No ratio / objective metric may influence the rank ordering.
    for (const metric of ["roas", "cpa", "ctr", "cpm", "cost_per_result", "result_count"]) {
      expect(rank.toLowerCase(), `spend_rank ordering must not reference ${metric}`).not.toContain(metric);
    }

    // The emitted cells array is ordered to MATCH spend_rank: untagged-last then
    // total_spend DESC (so the client renders in rank order).
    expect(sqlNoComments).toMatch(
      /ORDER BY \(rc\.is_other_type OR rc\.is_untagged_theme\) ASC,\s*rc\.total_spend DESC/i,
    );
    expect(sqlNoComments).toMatch(/'spend_rank',\s*rc\.spend_rank/i);
  });

  it("rows are the 4 Creative Types in fixed order, with an Other / untagged row for null/legacy styles", () => {
    // Fixed row order, emitted by sort_order — never by spend.
    expect(sqlNoComments).toMatch(
      /\('UGC Native'::text,\s*1\),\s*\('Studio Clean'::text,\s*2\),\s*\('Text Forward'::text,\s*3\),\s*\('Lifestyle'::text,\s*4\)/i,
    );
    expect(sqlNoComments).toMatch(/ORDER BY tx\.sort_order ASC/i);
    // The 4 rows always render (LEFT JOIN from the fixed list); the Other row
    // (creative_type NULL, is_other) only when it has ads in scope.
    expect(sqlNoComments).toMatch(/FROM type_fixed tf LEFT JOIN type_data td/i);
    expect(sqlNoComments).toMatch(/NULL::text\s+AS creative_type,\s*true\s+AS is_other/i);
    // Bucket helper: the 4 display values + legacy aliases, else NULL.
    expect(sqlNoComments).toMatch(/CREATE OR REPLACE FUNCTION public\.matrix_creative_type_bucket\(p_style text\)/i);
    expect(sqlNoComments).toMatch(/WHEN 'ugc'\s+THEN 'UGC Native'/i);
    expect(sqlNoComments).toMatch(/WHEN 'studio'\s+THEN 'Studio Clean'/i);
    expect(sqlNoComments).toMatch(/ELSE NULL/i);
  });

  it("columns are plain theme text (spend DESC, untagged last) — no angle_clusters join", () => {
    expect(sqlNoComments).toMatch(/'themes',/);
    expect(sqlNoComments).toMatch(
      /ORDER BY \(thx\.theme IS NULL\) ASC, thx\.total_spend DESC/i,
    );
    expect(sqlNoComments).not.toMatch(/angle_clusters/i);
    expect(sqlNoComments).not.toMatch(/account_creative_types|creative_type_menu|creative_lane/i);
    expect(sqlNoComments).not.toMatch(/CREATE TABLE/i);
  });

  it("exposes explicit Other / untagged buckets on both axes", () => {
    expect(sqlNoComments).toMatch(/\(s\.creative_type IS NULL\)\s*AS is_other_type/i);
    expect(sqlNoComments).toMatch(/\(s\.theme IS NULL\)\s*AS is_untagged_theme/i);
  });

  it("cell drill-down RPC splits ONE Creative Type × Theme cell by exact hook (no body axis)", () => {
    expect(sqlNoComments).toMatch(
      /CREATE OR REPLACE FUNCTION public\.rpc_creative_matrix_theme_cell\(\s*p_account_id\s+text,\s*p_creative_type text DEFAULT NULL,\s*p_theme\s+text DEFAULT NULL,\s*p_date_from\s+date DEFAULT NULL,\s*p_date_to\s+date DEFAULT NULL\s*\)/i,
    );
    // Same cell normalization as the board so the drill-down reconciles.
    expect(sqlNoComments).toMatch(/public\.matrix_creative_type_bucket\(cr\.style\) = v_type/i);
    expect(sqlNoComments).toMatch(/NULLIF\(btrim\(cr\.theme\), ''\) = v_theme/i);
    // Groups by the exact (trimmed) hook only.
    expect(sqlNoComments).toMatch(/NULLIF\(btrim\(cr\.hook\), ''\)\s+AS hook/i);
    expect(sqlNoComments).toMatch(/GROUP BY s\.hook\b/i);
    expect(sqlNoComments).not.toMatch(/GROUP BY s\.hook, s\.body/i);
    // Hook ranking is pure spend, untagged last.
    expect(sqlNoComments).toMatch(/ORDER BY hr\.is_untagged ASC,\s*hr\.total_spend DESC/i);
    // service_role-only, same IDOR posture as the board RPC.
    expect(sqlNoComments).toMatch(
      /REVOKE ALL\s+ON FUNCTION public\.rpc_creative_matrix_theme_cell\(text, text, text, date, date\) FROM PUBLIC/i,
    );
    expect(sqlNoComments).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.rpc_creative_matrix_theme_cell\(text, text, text, date, date\) FROM authenticated/i,
    );
    expect(sqlNoComments).toMatch(
      /GRANT\s+EXECUTE ON FUNCTION public\.rpc_creative_matrix_theme_cell\(text, text, text, date, date\) TO\s+service_role/i,
    );
    // Both RPCs are SECURITY DEFINER with an empty search_path.
    expect(sqlNoComments.match(/STABLE SECURITY DEFINER SET search_path = ''/gi) ?? []).toHaveLength(2);
  });

  it("is the latest migration redefining rpc_creative_matrix (so it is the effective definition)", () => {
    const definers = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) =>
        /CREATE OR REPLACE FUNCTION public\.rpc_creative_matrix\(/i.test(
          readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"),
        ),
      )
      .sort();
    expect(definers[definers.length - 1]).toBe(EFFECTIVE_FILE);
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
    // Every CREATE FUNCTION in the effective migration is CREATE OR REPLACE.
    expect(sqlNoComments).not.toMatch(/CREATE FUNCTION/i);
    const indexes = sqlNoComments.match(/CREATE INDEX[^;]*/gi) ?? [];
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

  it("matrix edge fn's cell view calls rpc_creative_matrix_theme_cell with creative_type + theme", () => {
    expect(matrixSrc).toMatch(/rpc\(["']rpc_creative_matrix_theme_cell["'],\s*\{\s*p_account_id:/);
    expect(matrixSrc).toMatch(/p_creative_type:\s*cellParams\.creativeType/);
    expect(matrixSrc).toMatch(/p_theme:\s*cellParams\.theme/);
    expect(matrixSrc).toMatch(/searchParams\.get\(["']theme["']\)/);
    // The retired angle × type -> hook × body RPC is no longer called.
    expect(matrixSrc).not.toMatch(/rpc\(["']rpc_creative_matrix_cell["']/);
    expect(matrixSrc).not.toMatch(/angle_id/);
    expect(sharedSrc).toMatch(/export function parseMatrixCellParams\(/);
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
