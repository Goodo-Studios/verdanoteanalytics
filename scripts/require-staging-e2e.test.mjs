// Audit Batch 9 (production E2E order): the production deploy must only go out when the same code
// passed the browser tests on staging. A promotion merge on main has the same file tree as the
// staging commit it promotes, so the gate matches staging runs by tree.
import assert from "node:assert/strict";
import { test } from "node:test";
import { STAGING_E2E_JOB, STAGING_E2E_STEP, findGreenStagingRun } from "./require-staging-e2e-lib.mjs";

const job = (stepConclusion, conclusion = "success") => ({
  name: STAGING_E2E_JOB,
  conclusion,
  steps: [
    { name: "Check staging E2E configuration", conclusion: "success" },
    { name: STAGING_E2E_STEP, conclusion: stepConclusion },
  ],
});

function deps({ trees, jobs }) {
  return {
    treeOf: async (sha) => trees[sha],
    jobsOf: async (id) => jobs[id] ?? [],
  };
}

const runs = [
  { id: 2, head_sha: "s2" },
  { id: 1, head_sha: "s1" },
];

test("a staging run with the same tree whose browser tests passed lets the release go", async () => {
  const r = await findGreenStagingRun({
    treeSha: "T1",
    runs,
    ...deps({ trees: { s2: "T2", s1: "T1" }, jobs: { 1: [job("success")] } }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.run.id, 1);
});

test("no staging run for this tree blocks the release", async () => {
  const r = await findGreenStagingRun({
    treeSha: "T9",
    runs,
    ...deps({ trees: { s2: "T2", s1: "T1" }, jobs: { 1: [job("success")], 2: [job("success")] } }),
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /No staging run/);
});

test("staging browser tests that failed block the release", async () => {
  const r = await findGreenStagingRun({
    treeSha: "T1",
    runs,
    ...deps({ trees: { s1: "T1" }, jobs: { 1: [job("failure", "failure")] } }),
  });
  assert.equal(r.ok, false);
});

test("staging browser tests that were skipped (secrets missing) do not count as green", async () => {
  const r = await findGreenStagingRun({
    treeSha: "T1",
    runs,
    ...deps({ trees: { s1: "T1" }, jobs: { 1: [job("skipped")] } }),
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /did not pass/);
});

test("a newer green run for the same tree wins over an older failed one", async () => {
  const r = await findGreenStagingRun({
    treeSha: "T1",
    runs,
    ...deps({ trees: { s2: "T1", s1: "T1" }, jobs: { 2: [job("success")], 1: [job("failure", "failure")] } }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.run.id, 2);
});
