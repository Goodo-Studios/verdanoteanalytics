import assert from "node:assert/strict";
import test from "node:test";
import { evaluateBundleBudget } from "./check-bundle-budget.mjs";

test("bundle budget accepts assets within per-chunk and total limits", () => {
  assert.deepEqual(
    evaluateBundleBudget([
      { name: "main.js", bytes: 200 },
      { name: "chart.js", bytes: 300 },
    ], { maxChunkBytes: 300, maxTotalBytes: 500 }),
    [],
  );
});

test("bundle budget reports oversized chunks and total output", () => {
  assert.deepEqual(
    evaluateBundleBudget([
      { name: "main.js", bytes: 301 },
      { name: "chart.js", bytes: 250 },
    ], { maxChunkBytes: 300, maxTotalBytes: 500 }),
    [
      "main.js is 301 bytes (limit 300)",
      "total JavaScript is 551 bytes (limit 500)",
    ],
  );
});
