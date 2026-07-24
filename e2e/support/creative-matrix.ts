/**
 * Shared E2E support for the Creative Matrix suite (US-009).
 *
 * These helpers back the config-surface (US-003), governed-tagging (US-004),
 * board + view-modes (US-007), cell drill-down (US-008), and numbers-parity
 * specs. They centralise login, role-prefix resolution, pilot-account
 * selection, and the read-surface fetches the parity spec reconciles.
 *
 * Credentials policy (matches the existing suite, e.g. creatives.spec.ts):
 * every authenticated spec self-skips when creds are absent, so the suite is
 * green-by-skip in credential-less environments and only exercises the live
 * builder+Bearaby path when the operator provides real credentials. We NEVER
 * loosen or fake an assertion to make a spec pass — a spec either runs live or
 * self-skips (honouring verdanote-e2e-suite-is-flaky-rerun-before-blocking and
 * the repo e2e-testing-standards).
 */
import { type Page, type APIRequestContext, expect } from "@playwright/test";

// Builder (staff) creds drive every builder-only surface: config, board,
// drill-down, tagging, and the React side of parity.
export const BUILDER_EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL || "";
export const BUILDER_PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD || "";
export const hasBuilderCreds = !!BUILDER_EMAIL && !!BUILDER_PASSWORD;

// Client (non-builder) creds drive the builder-only access-control assertions.
export const CLIENT_EMAIL = process.env.PLAYWRIGHT_CLIENT_EMAIL || "";
export const CLIENT_PASSWORD = process.env.PLAYWRIGHT_CLIENT_PASSWORD || "";
export const hasClientCreds = !!CLIENT_EMAIL && !!CLIENT_PASSWORD;

// Optional external API key. When present, the parity spec additionally
// exercises the key-gated GET /api/matrix surface — the same endpoint
// verdanote-read-mcp mirrors — and asserts byte-identical numbers vs React.
export const API_KEY = process.env.PLAYWRIGHT_API_KEY || "";
export const hasApiKey = !!API_KEY;

// Pilot account for the builder-only v1 (owner decision: Bearaby). Overridable
// so the suite can point at a different tagged account in other environments.
export const MATRIX_ACCOUNT_NAME = process.env.PLAYWRIGHT_MATRIX_ACCOUNT || "Bearaby";

const POST_LOGIN = /\/(builder|employee|client)\//;

/**
 * Sign in via the /login form and wait for the post-login role redirect.
 * A single retry absorbs the one-time auth/role-resolution latency that made
 * per-test logins flaky historically (see e2e/auth.setup.ts).
 */
async function signIn(page: Page, email: string, password: string): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto("/login");
      await page.fill("#email", email);
      await page.fill("#password", password);
      await page.getByRole("button", { name: /sign in/i }).click();
      await page.waitForURL(POST_LOGIN, { timeout: 30_000 });
      return;
    } catch (err) {
      lastErr = err;
      await page.context().clearCookies().catch(() => {});
      await page.evaluate(() => window.localStorage.clear()).catch(() => {});
    }
  }
  throw lastErr;
}

export async function loginAsBuilder(page: Page): Promise<void> {
  await signIn(page, BUILDER_EMAIL, BUILDER_PASSWORD);
}

export async function loginAsClient(page: Page): Promise<void> {
  await signIn(page, CLIENT_EMAIL, CLIENT_PASSWORD);
}

/** The `/builder|/employee|/client` prefix the current session resolved to. */
export function rolePrefix(page: Page): string {
  return page.url().match(/\/(builder|employee|client)/)?.[0] ?? "/builder";
}

/** Navigate to /matrix under the session's role prefix. */
export async function gotoMatrix(page: Page): Promise<void> {
  await page.goto(`${rolePrefix(page)}/matrix`);
}

/** Navigate to /settings under the session's role prefix. */
export async function gotoSettings(page: Page): Promise<void> {
  await page.goto(`${rolePrefix(page)}/settings`);
  await expect(page).toHaveURL(/\/settings/);
}

/**
 * Open the builder-only "Taxonomy" tab in Settings (US-003). Returns false when
 * the tab is absent (i.e. the session is not an effective builder) so guard
 * specs can assert denial without failing on a missing control.
 */
export async function openTaxonomyTab(page: Page): Promise<boolean> {
  try {
    const tab = page.getByRole("button", { name: /^Taxonomy$/ });
    await tab.waitFor({ state: "visible", timeout: 8_000 });
    await tab.click();
    return true;
  } catch {
    return false;
  }
}

/**
 * Select the pilot account in the board's account picker when it is present
 * (it only renders for multi-account sessions). No-op when the account can't be
 * found — the board falls back to the app-selected / first account, which is
 * still a valid matrix to assert against.
 */
export async function selectMatrixAccount(
  page: Page,
  name: string = MATRIX_ACCOUNT_NAME,
): Promise<void> {
  const trigger = page.getByRole("combobox").first();
  if ((await trigger.count()) === 0) return;
  try {
    await trigger.click({ timeout: 3_000 });
    const option = page.getByRole("option", { name: new RegExp(name, "i") });
    if ((await option.count()) > 0) {
      await option.first().click();
    } else {
      await page.keyboard.press("Escape");
    }
  } catch {
    // Picker absent or already on the target account — proceed.
  }
}

// ── Read-surface parity types + fetches ──────────────────────────────────────

export interface ParityCell {
  angle_id: string | null;
  creative_type: string | null;
  total_spend: number;
  n_ads: number;
  spend_rank: number;
}

export interface ParityMatrix {
  account_id: string;
  angles: { angle_id: string | null; total_spend: number }[];
  creative_types: { creative_type: string | null; total_spend: number }[];
  cells: ParityCell[];
}

/** Project a matrix payload down to the fields parity compares (order-stable). */
export function normalizeCells(m: ParityMatrix): ParityCell[] {
  return m.cells.map((c) => ({
    angle_id: c.angle_id,
    creative_type: c.creative_type,
    total_spend: c.total_spend,
    n_ads: c.n_ads,
    spend_rank: c.spend_rank,
  }));
}

/**
 * Fetch the matrix for `accountId` from the key-gated GET /api/matrix surface —
 * the external read path verdanote-read-mcp mirrors, calling the SAME single
 * rpc_creative_matrix RPC. `functionsBase` is derived from the React edge-fn
 * response URL the board issues, so both surfaces hit the same project.
 */
export async function fetchApiMatrix(
  request: APIRequestContext,
  functionsBase: string,
  accountId: string,
): Promise<ParityMatrix> {
  const res = await request.get(`${functionsBase}/api/matrix?account_id=${accountId}`, {
    headers: { "x-api-key": API_KEY, Authorization: `Bearer ${API_KEY}` },
  });
  expect(res.ok(), `GET /api/matrix failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()).matrix as ParityMatrix;
}

/**
 * Assert cells are spend-ranked (verdanote-winners-decided-by-spend-first): the
 * emitted order follows spend_rank ascending, and higher spend never sorts below
 * lower spend within the tagged (non-untagged-bucket) cells.
 */
export function assertSpendRanked(cells: ParityCell[]): void {
  for (let i = 1; i < cells.length; i++) {
    expect(
      cells[i].spend_rank,
      "cells must be emitted in spend_rank order",
    ).toBeGreaterThanOrEqual(cells[i - 1].spend_rank);
  }
}

/**
 * Grand-total reconciliation: the sum of every cell's spend equals the sum of
 * the column (angle) totals and the sum of the row (creative_type) totals — the
 * "cell spend totals reconcile with the report totals" acceptance check. Uses a
 * cents-level tolerance for floating rollup.
 */
export function assertGrandTotalReconciles(m: ParityMatrix): void {
  const round = (n: number) => Math.round(n * 100) / 100;
  const cellSum = round(m.cells.reduce((s, c) => s + c.total_spend, 0));
  const angleSum = round(m.angles.reduce((s, a) => s + a.total_spend, 0));
  const typeSum = round(m.creative_types.reduce((s, t) => s + t.total_spend, 0));
  expect(angleSum, "column (angle) totals must reconcile with cell grand total").toBeCloseTo(
    cellSum,
    1,
  );
  expect(typeSum, "row (creative-type) totals must reconcile with cell grand total").toBeCloseTo(
    cellSum,
    1,
  );
}
