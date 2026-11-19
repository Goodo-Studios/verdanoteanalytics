// Import existing time entries from a CSV (Time log). Choose or paste the file, check it, read
// the preview, then import. Each row is written through the same save hook as a manual entry,
// so the database's own rules (no overlap with saved time, end after start) still apply and a
// refused row is reported with its line. Active clients only.
import { useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { downloadCSV } from "@/lib/csv";
import { useSaveEntry, useTimeClients } from "@/hooks/useTimer";
import { formatHours } from "@/lib/timeLog";
import { MAX_TIME_IMPORT_ROWS, parseTimeCsv, type TimeImportResult } from "@/lib/timeImport";

const MAX_CHARS = 200_000;
const PREVIEW_ROWS = 10;
const TEMPLATE = {
  headers: ["Date", "Start", "End", "Client", "Category", "Description"],
  rows: [["2026-11-02", "09:00", "10:30", "Internal", "Admin", "Weekly planning"]],
};

export function TimeImportPanel({ onClose }: { onClose: () => void }) {
  const clients = useTimeClients();
  const save = useSaveEntry();
  const [text, setText] = useState("");
  const [result, setResult] = useState<TimeImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{ line: number; message: string }[]>([]);
  const [summary, setSummary] = useState<string | null>(null);

  const check = (t: string) => {
    setSummary(null);
    setFailed([]);
    if (t.length > MAX_CHARS) {
      setResult({ rows: [], errors: [], fatal: "That file is too large for a list of time entries.", totalSeconds: 0 });
      return;
    }
    setResult(parseTimeCsv(t, clients.data ?? []));
  };
  const readFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const t = await f.text();
    setText(t);
    check(t);
  };

  const ready = !!result && !result.fatal && result.errors.length === 0 && result.rows.length > 0;

  const run = async () => {
    if (!result) return;
    setBusy(true);
    setFailed([]);
    const problems: { line: number; message: string }[] = [];
    let added = 0;
    for (const r of result.rows) {
      try {
        await save.mutateAsync({
          values: {
            task_id: null,
            client_slug: r.clientSlug,
            is_internal: r.clientSlug === null,
            category: r.category,
            description: r.description,
            start_at: r.startAt,
            end_at: r.endAt,
          },
        });
        added++;
      } catch (e) {
        problems.push({ line: r.line, message: (e as Error).message });
      }
    }
    setBusy(false);
    setFailed(problems);
    setSummary(`Added ${added} of ${result.rows.length} ${result.rows.length === 1 ? "entry" : "entries"}.${problems.length ? ` ${problems.length} could not be added.` : ""}`);
    if (added > 0) toast.success(`Added ${added} ${added === 1 ? "entry" : "entries"}.`);
    if (problems.length === 0) {
      setResult(null);
      setText("");
    } else {
      // Keep only the rows that failed, so importing again never repeats the ones already added.
      const bad = new Set(problems.map((p) => p.line));
      const rows = result.rows.filter((r) => bad.has(r.line));
      setResult({ ...result, rows, totalSeconds: rows.reduce((n, r) => n + r.seconds, 0) });
    }
  };

  return (
    <section aria-label="Import time entries" className="space-y-3 rounded-lg border border-border/60 bg-card p-4" data-testid="time-import">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Import time entries from a CSV</h2>
          <p className="text-xs text-muted-foreground">
            Columns: Date, Start, End (or Hours), Client (an active client or Internal), Category, Description. Times are studio time
            (Eastern). Entries are added to your own time. A file from the Time report export works as it is. Up to {MAX_TIME_IMPORT_ROWS} rows
            at a time; every row is checked first and a file with a wrong row imports nothing.
          </p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <p className="text-xs">
        <button type="button" className="underline" onClick={() => downloadCSV("time-import-template.csv", TEMPLATE.headers, TEMPLATE.rows)}>
          Download a template
        </button>
      </p>
      <Textarea
        aria-label="Time CSV text"
        className="min-h-[100px] font-mono text-xs"
        placeholder="Paste CSV text, or choose a file below"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setResult(null);
          setSummary(null);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Input type="file" accept=".csv,text/csv" aria-label="Time CSV file" className="w-auto" onChange={readFile} />
        <Button type="button" size="sm" variant="outline" onClick={() => check(text)} disabled={clients.isLoading} data-testid="time-import-check">
          Check CSV
        </Button>
      </div>
      {clients.isError ? <p role="alert" className="text-sm text-[var(--gos-late)]">The client list could not load, so clients cannot be checked. Try again later.</p> : null}
      {result?.fatal ? (
        <p role="alert" className="text-sm text-[var(--gos-late)]" data-testid="time-import-fatal">{result.fatal}</p>
      ) : null}
      {result && !result.fatal && result.errors.length > 0 ? (
        <div role="alert" className="text-sm text-[var(--gos-late)]" data-testid="time-import-errors">
          <p>{result.errors.length} {result.errors.length === 1 ? "row needs" : "rows need"} fixing. Nothing was imported.</p>
          <ul className="list-disc pl-5">
            {result.errors.slice(0, 10).map((e) => (
              <li key={`${e.line}:${e.message}`}>Line {e.line}: {e.message}</li>
            ))}
          </ul>
          {result.errors.length > 10 ? <p>and {result.errors.length - 10} more.</p> : null}
        </div>
      ) : null}
      {ready && result ? (
        <div className="space-y-2" data-testid="time-import-preview">
          <p className="text-sm">
            {result.rows.length} {result.rows.length === 1 ? "entry" : "entries"} ready, {formatHours(result.totalSeconds)} in total.
          </p>
          <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 text-sm">
            {result.rows.slice(0, PREVIEW_ROWS).map((r) => (
              <li key={r.line} className="flex flex-wrap gap-3 px-3 py-1.5" data-testid="time-import-row">
                <span className="tabular-nums text-muted-foreground">{r.date} {r.start} to {r.end}</span>
                <span className="font-medium">{r.clientLabel} · {r.category}</span>
                {r.description ? <span className="text-muted-foreground">{r.description}</span> : null}
              </li>
            ))}
          </ul>
          {result.rows.length > PREVIEW_ROWS ? <p className="text-xs text-muted-foreground">and {result.rows.length - PREVIEW_ROWS} more.</p> : null}
          <Button type="button" size="sm" onClick={() => void run()} disabled={busy} data-testid="time-import-run">
            {busy ? "Importing..." : `Import ${result.rows.length} ${result.rows.length === 1 ? "entry" : "entries"}`}
          </Button>
        </div>
      ) : null}
      {summary ? <p role="status" className="text-sm" data-testid="time-import-summary">{summary}</p> : null}
      {failed.length > 0 ? (
        <ul role="alert" className="list-disc pl-5 text-sm text-[var(--gos-late)]" data-testid="time-import-failed">
          {failed.slice(0, 10).map((p) => (
            <li key={p.line}>Line {p.line}: {p.message}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
