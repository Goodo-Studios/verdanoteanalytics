#!/usr/bin/env node
// Production release gate (audit Batch 9): refuse to deploy to production unless the same code
// (same file tree) passed the browser tests on staging. Runs in the deploy-functions job before
// any deploy. Needs GITHUB_TOKEN with actions: read, GITHUB_REPOSITORY and GITHUB_SHA.
import { findGreenStagingRun } from "./require-staging-e2e-lib.mjs";

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const sha = process.env.GITHUB_SHA;
if (!token || !repo || !sha) {
  console.error("::error title=Staging E2E gate::GITHUB_TOKEN, GITHUB_REPOSITORY and GITHUB_SHA are required.");
  process.exit(1);
}

async function gh(path) {
  const res = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API ${path}: ${res.status}`);
  return res.json();
}

const treeCache = new Map();
async function treeOf(commit) {
  if (!treeCache.has(commit)) treeCache.set(commit, (await gh(`git/commits/${commit}`)).tree.sha);
  return treeCache.get(commit);
}

try {
  const treeSha = await treeOf(sha);
  const { workflow_runs: runs } = await gh(
    "actions/workflows/ci.yml/runs?branch=staging&event=push&status=completed&per_page=30",
  );
  const result = await findGreenStagingRun({
    treeSha,
    runs,
    treeOf,
    jobsOf: async (id) => (await gh(`actions/runs/${id}/jobs?per_page=100`)).jobs,
  });
  if (!result.ok) {
    console.error(`::error title=Staging E2E gate::${result.reason}`);
    process.exit(1);
  }
  console.log(`Staging browser tests passed for this code in run ${result.run.id} (${result.run.head_sha}).`);
} catch (err) {
  console.error(`::error title=Staging E2E gate::${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
