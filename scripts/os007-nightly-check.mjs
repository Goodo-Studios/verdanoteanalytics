// OS-007 nightly ClickUp comparison on STAGING only. Run by .github/workflows/os007-nightly-check.yml.
// Read-only against ClickUp; the staging function records differences in os_sync_discrepancies
// before repairing them. Prints one JSON line and exits non-zero when the run failed, found
// discrepancies, or could not walk every space.
import { STAGING_PROJECT_REF, exitCodeFor, summarize } from "./os007-nightly-check-lib.mjs";

const u = process.env.STAGING_SUPABASE_URL;
const k = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
if (!u || !u.includes(STAGING_PROJECT_REF)) throw new Error("staging only");
if (!k) throw new Error("STAGING_SUPABASE_SERVICE_ROLE_KEY is not set");

async function run() {
  const r = await fetch(u + "/functions/v1/clickup-os-sync", {
    method: "POST",
    headers: { apikey: k, Authorization: "Bearer " + k, "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "nightly" }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

let res = await run();
// A rate-limited walk reports failed spaces; wait for ClickUp's window and try once more.
if (!res.body.success) {
  await new Promise((s) => setTimeout(s, 90_000));
  res = await run();
}
const summary = summarize(res);
console.log(JSON.stringify(summary));
process.exitCode = exitCodeFor(summary);
