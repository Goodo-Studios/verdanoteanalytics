import assert from "node:assert/strict";
import test from "node:test";
import { exitCodeFor, summarize } from "./os007-nightly-check-lib.mjs";

const ok = { success: true, discrepancies: 0, seen: 120, failedSpaces: [] };

test("clean run exits 0", () => {
  assert.equal(exitCodeFor(ok), 0);
  assert.equal(exitCodeFor({ ...ok, failedSpaces: null }), 0);
});

test("unsuccessful run exits 1", () => {
  assert.equal(exitCodeFor({ ...ok, success: false }), 1);
});

test("any discrepancy exits 1", () => {
  assert.equal(exitCodeFor({ ...ok, discrepancies: 3 }), 1);
  assert.equal(exitCodeFor({ ...ok, discrepancies: null }), 1);
});

test("failed spaces exit 1", () => {
  assert.equal(exitCodeFor({ ...ok, failedSpaces: ["space-1"] }), 1);
});

test("summarize maps an error response to a failing summary", () => {
  const s = summarize({ status: 500, body: {} }, "t");
  assert.deepEqual(s, {
    at: "t", http: 500, runId: null, success: false, discrepancies: null, seen: null, failedSpaces: null,
  });
  assert.equal(exitCodeFor(s), 1);
});
