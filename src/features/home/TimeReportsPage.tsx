// Time reports (OS-013): /{role}/time/reports, under the Time tab of Home. Staff only (route guard).
//
// Pick a range (this week, last week, this month, last month, or two dates), a grouping (client,
// person, task, content type, category) and filters, and see each group's hours and share of the
// total as a calm list. Download CSV saves one row per entry for the same range and filters.
//
// A builder sees everyone and can filter by person. A member sees only their own time (row rules
// enforce that), so the person filter and the person grouping are not offered to them, as in Goodo
// Time. Only completed entries count; a running timer is left out until it stops.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState, LoadingState, PageHeader, PageShell, SelectField, TextField } from "@/components/page-kit";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useClientPreview } from "@/hooks/useClientPreviewMode";
import { useRolePrefix } from "@/hooks/useRolePath";
import { useTimeReport } from "@/hooks/useTimeReports";
import {
  GROUP_BY_OPTIONS,
  RANGE_PRESETS,
  applyFilters,
  csvFileName,
  decimalHours,
  filterOptions,
  hmm,
  presetDates,
  rangeLabel,
  reportCsv,
  resolveRange,
  summarise,
  type GroupBy,
  type RangePreset,
} from "@/lib/timeReports";
import { HomeTabs } from "./HomeTabs";

const PRESET_OPTIONS = [...RANGE_PRESETS, { value: "custom" as const, label: "Custom dates" }];

/** Saves text as a file in the browser. */
function download(text: string, name: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function TimeReportsPage() {
  const prefix = useRolePrefix();
  const { isBuilder } = useAuth();
  const { isEmployeePreview } = useClientPreview();
  const seesEveryone = isBuilder && !isEmployeePreview;

  const [preset, setPreset] = useState<RangePreset>("this-week");
  const initial = useMemo(() => presetDates("this-week"), []);
  const [custom, setCustom] = useState<{ from: string; to: string }>(initial);
  const [groupBy, setGroupBy] = useState<GroupBy>("client");
  const [client, setClient] = useState("");
  const [person, setPerson] = useState("");

  const resolved = useMemo(() => resolveRange(preset, custom), [preset, custom]);
  const range = resolved.range;
  const report = useTimeReport(range?.fromIso ?? null, range?.toIso ?? null);

  const groupOptions = seesEveryone ? GROUP_BY_OPTIONS : GROUP_BY_OPTIONS.filter((o) => o.value !== "person");
  const activeGroup = !seesEveryone && groupBy === "person" ? "client" : groupBy;

  const all = useMemo(() => report.data ?? [], [report.data]);
  const filtered = useMemo(() => applyFilters(all, { client, person: seesEveryone ? person : "" }), [all, client, person, seesEveryone]);
  const summary = useMemo(() => summarise(filtered, activeGroup), [filtered, activeGroup]);
  const clientOptions = useMemo(() => filterOptions(all, "client"), [all]);
  const personOptions = useMemo(() => (seesEveryone ? filterOptions(all, "person") : []), [all, seesEveryone]);

  const onPreset = (value: RangePreset) => {
    // Custom starts from the range on screen, so switching keeps the same days.
    if (value === "custom" && range) setCustom({ from: range.from, to: range.to });
    setPreset(value);
  };

  return (
    <PageShell data-testid="time-reports-page">
      <PageHeader
        title="Time reports"
        description={seesEveryone ? "Everyone's tracked time, grouped your way. Running timers count once they stop." : "Your tracked time, grouped your way. Running timers count once they stop."}
        className="mb-2"
      />
      <HomeTabs active="time" />
      <p className="text-sm">
        <Link to={`${prefix}/time`} className="underline">Back to my week</Link>
      </p>

      <div className="flex flex-wrap items-end gap-3" data-testid="time-report-controls">
        <SelectField
          label="Range"
          value={preset}
          onChange={(e) => onPreset(e.target.value as RangePreset)}
          options={PRESET_OPTIONS}
          data-testid="time-report-preset"
        />
        {preset === "custom" ? (
          <>
            <TextField label="From" type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} data-testid="time-report-from" />
            <TextField label="To" type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} data-testid="time-report-to" />
          </>
        ) : null}
        <SelectField
          label="Group by"
          value={activeGroup}
          onChange={(e) => setGroupBy(e.target.value as GroupBy)}
          options={groupOptions}
          data-testid="time-report-group"
        />
        <SelectField label="Client" value={client} onChange={(e) => setClient(e.target.value)} placeholder="All clients" options={clientOptions} data-testid="time-report-client" />
        {seesEveryone ? (
          <SelectField label="Person" value={person} onChange={(e) => setPerson(e.target.value)} placeholder="Everyone" options={personOptions} data-testid="time-report-person" />
        ) : null}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={!range || report.isLoading || report.isError}
          onClick={() => range && download(reportCsv(filtered), csvFileName(range))}
          data-testid="time-report-csv"
        >
          Download CSV
        </Button>
      </div>

      {resolved.error ? (
        <p role="alert" className="text-sm text-[var(--gos-late)]" data-testid="time-report-range-error">
          {resolved.error}
        </p>
      ) : null}

      {!range ? null : report.isLoading ? (
        <LoadingState label="Loading the report" />
      ) : report.isError ? (
        <div data-testid="time-report-error">
          <ErrorState message="The report could not load, so this is not the same as having no time." onRetry={() => void report.refetch()} />
        </div>
      ) : (
        <section aria-labelledby="time-report-heading" className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="time-report-heading" className="text-sm font-semibold" data-testid="time-report-range">
              {rangeLabel(range)}
            </h2>
            <span className="text-sm" data-testid="time-report-total">
              Total <span className="font-semibold tabular-nums">{decimalHours(summary.totalSeconds)} h</span>
              <span className="text-muted-foreground"> ({hmm(summary.totalSeconds)}, {summary.entryCount} {summary.entryCount === 1 ? "entry" : "entries"})</span>
            </span>
          </div>
          {summary.groups.length === 0 ? (
            <div data-testid="time-report-empty">
              <EmptyState title="No time in this range." description="Pick another range, or clear the filters." />
            </div>
          ) : (
            <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 bg-card" data-testid="time-report-groups">
              {summary.groups.map((g) => (
                <li key={g.key} className="px-4 py-2 text-sm" data-testid="time-report-group-row">
                  <div className="flex items-baseline gap-3">
                    <span className="min-w-0 flex-1 truncate font-medium" data-testid="time-report-group-label">{g.label}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{Math.round(g.share * 100)}%</span>
                    <span className="w-20 shrink-0 text-right tabular-nums" data-testid="time-report-group-hours">{decimalHours(g.seconds)} h</span>
                  </div>
                  <div className="mt-1 h-1 w-full rounded-full bg-[var(--gos-acc2)]" aria-hidden>
                    <div className="h-1 rounded-full bg-[var(--gos-ink)] opacity-60" style={{ width: `${Math.max(1, g.share * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </PageShell>
  );
}
