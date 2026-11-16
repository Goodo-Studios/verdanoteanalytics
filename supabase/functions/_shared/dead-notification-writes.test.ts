// Audit plan item 5.2: stop writing the in-app `notifications` and `performance_changelog` tables.
//
// Nothing in the app reads either table. The sync's winner/concern comparison also never fired,
// because snapshot_prior_roas runs before it, so "previous" ROAS always equalled the current one.
// Matthew decided to stop writing them. The tables and their data stay for a later cleanup.
// The Slack winner/concern alerts (runSnapshotAlerts) read prior_roas and must keep working.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const sync = await Deno.readTextFile(new URL("../sync/index.ts", import.meta.url));
const reports = await Deno.readTextFile(new URL("../reports/index.ts", import.meta.url));

function tableUses(src: string, table: string): number {
  return src.split(`.from("${table}")`).length - 1;
}

Deno.test("sync no longer writes in-app notifications", () => {
  assertEquals(tableUses(sync, "notifications"), 0);
});

Deno.test("sync no longer writes performance_changelog", () => {
  assertEquals(tableUses(sync, "performance_changelog"), 0);
});

Deno.test("the monthly report rollup no longer writes in-app notifications", () => {
  assertEquals(tableUses(reports, "notifications"), 0);
});

Deno.test("sync still runs the Slack winner/concern alerts before snapshotting prior_roas", () => {
  const alerts = sync.indexOf("await runSnapshotAlerts(");
  const snapshot = sync.indexOf('rpc("snapshot_prior_roas"');
  assert(alerts > 0, "runSnapshotAlerts is still called");
  assert(snapshot > 0, "snapshot_prior_roas is still called (the Slack alert and the library read prior_roas)");
  assert(alerts < snapshot, "the alerts compare against the previous snapshot, so they run first");
});
