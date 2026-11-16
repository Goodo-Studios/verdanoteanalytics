// Logic for scripts/require-staging-e2e.mjs, kept apart so it can be tested without GitHub.
//
// A promotion to main (merge of staging) has the same file tree as the staging commit it
// promotes, so a staging CI run counts for this release when its commit has the same tree and
// its staging browser test step passed. A skipped step (staging secrets missing) does not count.

export const STAGING_E2E_JOB = "E2E tests on STAGING (Playwright)";
export const STAGING_E2E_STEP = "Run staging browser tests";

/**
 * @param {{ treeSha: string, runs: Array<{ id: number, head_sha: string }>,
 *           treeOf: (sha: string) => Promise<string | undefined>,
 *           jobsOf: (runId: number) => Promise<Array<{ name: string, conclusion: string | null,
 *                     steps?: Array<{ name: string, conclusion: string | null }> }>> }} args
 *   runs: completed staging push runs, newest first.
 */
export async function findGreenStagingRun({ treeSha, runs, treeOf, jobsOf }) {
  let sameTree = 0;
  for (const run of runs) {
    if ((await treeOf(run.head_sha)) !== treeSha) continue;
    sameTree++;
    const jobs = await jobsOf(run.id);
    const e2e = jobs.find((j) => j.name === STAGING_E2E_JOB);
    const step = e2e?.steps?.find((s) => s.name === STAGING_E2E_STEP);
    if (e2e?.conclusion === "success" && step?.conclusion === "success") return { ok: true, run };
  }
  if (sameTree === 0) {
    return { ok: false, reason: `No staging run found for tree ${treeSha}. Merge and test this code on staging first.` };
  }
  return {
    ok: false,
    reason: `Staging browser tests did not pass for tree ${treeSha} (${sameTree} staging run(s) checked).`,
  };
}
