// "Last run" line for the two scheduled checks (phase 4 PR 3): the budget check on Operating costs
// and the alert check on Integration health. Reads the newest check_runs row for the check. A run
// that failed says so, and a load error is not shown as "not run yet".
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CHECK_RUN_COLUMNS } from "@/lib/pageQueries";
import { syncAgo } from "@/features/clients/setupModel";

export interface CheckRun {
  check_key: string;
  trigger: "manual" | "scheduled";
  outcome: "ok" | "failed";
  created_at: string;
}

interface Result {
  data: unknown;
  error: { message: string } | null;
}
interface Query extends PromiseLike<Result> {
  eq(column: string, value: string): Query;
  order(column: string, options: { ascending: boolean }): Query;
  limit(n: number): Query;
}
const db = supabase as unknown as { from(table: string): { select(columns: string): Query } };

/** The sentence shown for the newest run, or for none. */
export function lastRunText(run: CheckRun | null, scheduleNote: string, now: Date): string {
  if (!run) return `Not run yet. ${scheduleNote}`;
  const who = run.trigger === "scheduled" ? "by the schedule" : "by hand";
  const when = syncAgo(run.created_at, now);
  return run.outcome === "failed" ? `Last run ${when} (${who}) did not finish. ${scheduleNote}` : `Last run ${when} (${who}). ${scheduleNote}`;
}

export function LastRunLine({ checkKey, scheduleNote, refresh }: { checkKey: "budget_check" | "alert_check"; scheduleNote: string; refresh?: unknown }) {
  const [state, setState] = useState<{ run: CheckRun | null } | "error" | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await db.from("check_runs").select(CHECK_RUN_COLUMNS).eq("check_key", checkKey).order("created_at", { ascending: false }).limit(1);
        if (cancelled) return;
        if (r.error) return setState("error");
        setState({ run: Array.isArray(r.data) ? ((r.data[0] as CheckRun | undefined) ?? null) : null });
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [checkKey, refresh]);

  if (state === null) return null;
  return (
    <p className="text-[12px] text-muted-foreground" data-testid={`last-run-${checkKey}`}>
      {state === "error" ? "When this last ran could not load." : lastRunText(state.run, scheduleNote, new Date())}
    </p>
  );
}
