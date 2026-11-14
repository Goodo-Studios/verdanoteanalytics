// ClickUp write-back on Integration health (Goodo OS story OS-017). Builders only: what the
// write-back worker holds, has sent, is retrying or gave up on, and the latest clashes, read through
// clickup_writeback_overview(). Write-back is off unless the functions have
// CLICKUP_WRITEBACK_ENABLED=true and a list allow-list; the banner says so plainly.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fmtWhen } from "@/lib/formatters";
import { COUNT_LABELS, FIELD_LABEL, isOverview, type WritebackOverview } from "./writebackModel";

const show = (v: string | null) => (v === null || v === "" ? "empty" : v);

const rpcDb = supabase as unknown as {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
};

export function ClickUpWritebackSection({ refresh }: { refresh?: string }) {
  const [data, setData] = useState<WritebackOverview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    setProblem(null);
    const { data: d, error } = await rpcDb.rpc("clickup_writeback_overview");
    if (error) {
      setData(null);
      setProblem(error.code === "42501" ? "Only builders can see ClickUp write-back." : "ClickUp write-back status could not load.");
      return;
    }
    if (!isOverview(d)) {
      setData(null);
      setProblem("ClickUp write-back status could not load.");
      return;
    }
    setData(d);
  }, []);

  useEffect(() => {
    void load();
  }, [load, refresh]);

  return (
    <section aria-labelledby="ih-clickup-writeback" className="space-y-2" data-testid="clickup-writeback">
      <h2 id="ih-clickup-writeback" className="text-base font-semibold">ClickUp write-back</h2>
      {problem ? <p className="text-sm text-muted-foreground">{problem}</p> : null}
      {data ? (
        <>
          {data.enabled ? (
            <p className="text-sm" data-testid="clickup-writeback-banner">
              Write-back is on for {data.allowedListIds.length === 0 ? "no lists" : `ClickUp list ${data.allowedListIds.join(", ")}`}.
              {data.blockedReason ? ` ${data.blockedReason}.` : ""} Changes on any other list are held.
            </p>
          ) : (
            <p className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900" data-testid="clickup-writeback-banner">
              Write-back is off. Changes made in the app are recorded and held; nothing is written to ClickUp.
            </p>
          )}
          <p className="text-[12px] text-muted-foreground">
            {data.lastRunAt ? `Last run ${fmtWhen(data.lastRunAt)}` : "The write-back worker has not run yet."}
          </p>
          <ul className="flex flex-wrap gap-2 text-sm" aria-label="Write-back counts">
            {COUNT_LABELS.map(([key, label]) => (
              <li key={key} className="rounded border border-input px-2 py-1" data-testid={`clickup-writeback-count-${key}`}>
                {label}: {data.counts[key] ?? 0}
              </li>
            ))}
          </ul>
          <h3 className="text-sm font-semibold">Recent failures</h3>
          {data.failures.length === 0 ? (
            <p className="text-sm text-muted-foreground">No failed writes.</p>
          ) : (
            <ul className="space-y-1 text-sm" aria-label="Recent failures">
              {data.failures.map((f) => (
                <li key={f.id} className="rounded border border-input p-2">
                  {FIELD_LABEL[f.field] ?? f.field} on task {f.clickupTaskId} · {f.attempts} attempt{f.attempts === 1 ? "" : "s"} ·{" "}
                  {f.state === "failed" ? "gave up" : `next try ${fmtWhen(f.nextAttemptAt)}`}
                  {f.lastError ? <span className="block text-muted-foreground">{f.lastError}</span> : null}
                </li>
              ))}
            </ul>
          )}
          <h3 className="text-sm font-semibold">Recent clashes</h3>
          {data.clashes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No changes made in both places.</p>
          ) : (
            <ul className="space-y-1 text-sm" aria-label="Recent clashes">
              {data.clashes.map((c) => (
                <li key={c.id} className="rounded border border-input p-2">
                  {FIELD_LABEL[c.field] ?? c.field} on task {c.clickupTaskId} · app: {show(c.appValue)} · ClickUp: {show(c.clickupValue)} ·{" "}
                  {c.winner === "app" ? "app kept" : "ClickUp kept"} · {fmtWhen(c.createdAt)}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
