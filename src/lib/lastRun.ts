// Wording for the "last run" line of the two scheduled checks (phase 4 PR 3). No network here.
import { syncAgo } from "@/features/clients/setupModel";

export interface CheckRun {
  check_key: string;
  trigger: "manual" | "scheduled";
  outcome: "ok" | "failed";
  created_at: string;
}

/** The sentence shown for the newest run, or for none. */
export function lastRunText(run: CheckRun | null, scheduleNote: string, now: Date): string {
  if (!run) return `Not run yet. ${scheduleNote}`;
  const who = run.trigger === "scheduled" ? "by the schedule" : "by hand";
  const when = syncAgo(run.created_at, now);
  return run.outcome === "failed" ? `Last run ${when} (${who}) did not finish. ${scheduleNote}` : `Last run ${when} (${who}). ${scheduleNote}`;
}
