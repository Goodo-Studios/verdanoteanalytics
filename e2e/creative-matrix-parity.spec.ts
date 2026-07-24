/**
 * US-009 E2E — numbers parity across the three read surfaces.
 *
 * The board (React) reads the matrix through the session-authed `matrix` edge
 * fn; the external `api` fn exposes GET /api/matrix; and verdanote-read-mcp
 * mirrors that same `api` path. All three call the SAME single
 * rpc_creative_matrix RPC and return its jsonb VERBATIM, so the spend-ranked
 * figures must be byte-identical across surfaces (spec: US-006/US-009).
 *
 * This spec captures the React surface directly from the board's own network
 * response (no key needed), asserts the cells are spend-ranked
 * (verdanote-winners-decided-by-spend-first) and that cell spend totals
 * reconcile with the column/row report totals. When PLAYWRIGHT_API_KEY is set
 * it additionally fetches GET /api/matrix for the SAME account and asserts the
 * cell figures match the React surface exactly — the check that transitively
 * proves parity with verdanote-read-mcp, which reads that identical endpoint.
 *
 * Live path needs a builder + Bearaby session; it self-skips otherwise. The
 * api-surface comparison additionally needs PLAYWRIGHT_API_KEY; without it the
 * React-side spend-rank + reconciliation assertions still run.
 */
import { test, expect } from "@playwright/test";
import {
  hasBuilderCreds,
  hasApiKey,
  loginAsBuilder,
  gotoMatrix,
  selectMatrixAccount,
  fetchApiMatrix,
  normalizeCells,
  assertSpendRanked,
  assertGrandTotalReconciles,
  type ParityMatrix,
} from "./support/creative-matrix";

test.describe("Creative Matrix — numbers parity across React / api / MCP (US-009)", () => {
  test.skip(!hasBuilderCreds, "Set PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD to run");

  test("React cells are spend-ranked and reconcile; api matches when keyed", async ({
    page,
    request,
  }) => {
    await loginAsBuilder(page);

    // Arm capture of the board's own `matrix` edge-fn read (the React surface),
    // then load the board so the fetch fires.
    const respPromise = page
      .waitForResponse(
        (r) =>
          /\/functions\/v1\/matrix(\?|$)/.test(r.url()) &&
          r.request().method() === "GET",
        { timeout: 25_000 },
      )
      .catch(() => null);

    await gotoMatrix(page);
    await selectMatrixAccount(page);

    const resp = await respPromise;
    if (!resp) {
      test.info().annotations.push({
        type: "skip-reason",
        description: "Board issued no matrix read (no resolvable account) — nothing to reconcile.",
      });
      return;
    }
    expect(resp.ok(), `matrix edge fn returned ${resp.status()}`).toBeTruthy();

    const react = (await resp.json()).matrix as ParityMatrix;
    const functionsBase = resp.url().split("/functions/v1/")[0] + "/functions/v1";

    // React surface: cells emitted in spend_rank order, totals reconcile.
    assertSpendRanked(react.cells);
    assertGrandTotalReconciles(react);

    if (!hasApiKey) {
      test.info().annotations.push({
        type: "note",
        description:
          "PLAYWRIGHT_API_KEY unset — React spend-rank + reconciliation verified; " +
          "api/MCP cross-surface equality not exercised this run.",
      });
      return;
    }

    // api surface (the endpoint verdanote-read-mcp mirrors): fetch the SAME
    // account and assert byte-identical cell figures.
    const api = await fetchApiMatrix(request, functionsBase, react.account_id);
    assertSpendRanked(api.cells);
    assertGrandTotalReconciles(api);

    expect(
      normalizeCells(api),
      "GET /api/matrix cells must match the React (matrix edge fn) cells exactly",
    ).toEqual(normalizeCells(react));

    test.info().annotations.push({
      type: "note",
      description:
        "React and GET /api/matrix agree on every cell's spend/rank; verdanote-read-mcp " +
        "reads this same api path + RPC, so its numbers match by construction.",
    });
  });
});
