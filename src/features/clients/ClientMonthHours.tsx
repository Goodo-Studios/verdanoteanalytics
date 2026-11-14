// Client hub (OS-013): hours tracked for this client this month against its monthly scope hours,
// for example "12.5 h of 20 h this month", with a thin bar that turns the late colour when over.
// The month is the calendar month in the studio zone (America/New_York). Only completed entries
// tagged with this client count.
//
// Staff only. A client login, or a builder previewing the client view, never sees it (and row
// rules hide time and clients from clients anyway). A builder sees the whole team's hours and can
// set the scope hours; an employee's row rules show only their own time, so the card says so.
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/page-kit";
import { useAuth } from "@/contexts/AuthContext";
import { useClientPreview } from "@/hooks/useClientPreviewMode";
import { useClientMonthHours, useSetScopeHours } from "@/hooks/useTimeReports";
import { resolveRange, scopeStatus } from "@/lib/timeReports";

function ScopeHoursForm({ slug, current, onDone }: { slug: string; current: number | null; onDone: () => void }) {
  const set = useSetScopeHours(slug);
  const [value, setValue] = useState(current == null ? "" : String(current));
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="mt-2 flex flex-wrap items-end gap-2"
      aria-label="Set scope hours"
      onSubmit={(e) => {
        e.preventDefault();
        const text = value.trim();
        const hours = text === "" ? null : Number(text);
        if (hours !== null && !(Number.isFinite(hours) && hours > 0 && hours <= 744)) {
          setError("Enter hours between 0 and 744, or leave it empty to clear.");
          return;
        }
        setError(null);
        set.mutate(hours, { onSuccess: onDone, onError: (err) => setError((err as Error).message) });
      }}
    >
      <TextField label="Scope hours per month" type="number" step={0.5} value={value} onChange={(e) => setValue(e.target.value)} data-testid="scope-hours-input" />
      <Button type="submit" size="sm" variant="outline" disabled={set.isPending} data-testid="scope-hours-save">
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
      {error ? (
        <p role="alert" className="w-full text-sm text-[var(--gos-late)]">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function ClientMonthHours({ slug, now }: { slug: string; now?: Date }) {
  const { isBuilder, isEmployee, isClient } = useAuth();
  const { isClientPreview, isEmployeePreview } = useClientPreview();
  const staff = (isBuilder || isEmployee) && !isClient && !isClientPreview;
  const realBuilder = isBuilder && !isEmployeePreview && staff;
  const month = useMemo(() => resolveRange("this-month", {}, now ?? new Date()).range!, [now]);
  const q = useClientMonthHours(slug, month.fromIso, month.toIso, staff);
  const [editing, setEditing] = useState(false);

  if (!staff) return null;

  const status = q.data ? scopeStatus(q.data.seconds, q.data.scopeHours) : null;
  const width = status?.ratio == null ? 0 : Math.min(100, status.ratio * 100);

  return (
    <div className="rounded-lg border border-border bg-card p-4" data-testid="client-month-hours">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Hours this month</h2>
        {realBuilder && !editing && q.data ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)} data-testid="scope-hours-edit">
            {q.data.scopeHours == null ? "Set scope hours" : "Change scope hours"}
          </Button>
        ) : null}
      </div>
      {q.isLoading ? (
        <p className="mt-1 text-sm text-muted-foreground">Loading hours</p>
      ) : q.isError || !status ? (
        <p role="alert" className="mt-1 text-sm text-muted-foreground" data-testid="client-month-hours-error">
          Hours could not load.
        </p>
      ) : (
        <>
          <p className={`mt-1 text-sm tabular-nums ${status.over ? "text-[var(--gos-late)]" : ""}`} data-testid="client-month-hours-text" data-over={status.over ? "true" : "false"}>
            {status.text}
          </p>
          {status.ratio == null ? null : (
            <div
              className="mt-2 h-1 w-full rounded-full bg-[var(--gos-acc2)]"
              role="img"
              aria-label={`${Math.round(status.ratio * 100)} percent of scope hours used`}
              data-testid="client-month-hours-bar"
            >
              <div className={`h-1 rounded-full ${status.over ? "bg-[var(--gos-late)]" : "bg-[var(--gos-ink)] opacity-60"}`} style={{ width: `${width}%` }} />
            </div>
          )}
          {realBuilder ? null : <p className="mt-2 text-xs text-muted-foreground">Counts only your own time. Admins see the whole team.</p>}
        </>
      )}
      {editing && q.data ? <ScopeHoursForm slug={slug} current={q.data.scopeHours} onDone={() => setEditing(false)} /> : null}
    </div>
  );
}
