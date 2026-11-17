// In-app CSV import for the Growth Dashboard (see csvImport.ts). Choose what the file holds,
// pick or paste it, check it, read the preview, then add it to the saved numbers.
import { useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { downloadCSV } from "@/lib/csv";
import { CSV_KINDS, mergeCsvIntoState, parseGrowthCsv, type CsvImportResult, type CsvKind } from "./csvImport";
import type { GrowthState } from "./model";

const MAX_CSV_CHARS = 500_000;

export function CsvImportBlock({ state, onImport }: { state: GrowthState; onImport: (next: GrowthState) => Promise<void> }) {
  const [kind, setKind] = useState<CsvKind>("revenue");
  const [text, setText] = useState("");
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const def = CSV_KINDS.find((k) => k.kind === kind)!;

  const check = (t: string) => {
    setDone(null);
    setSaveError(null);
    setResult(t.length > MAX_CSV_CHARS ? { kind, validRows: 0, errors: [], fatal: "That file is too large for a CSV of numbers.", patch: { rev: {}, calls: {}, deals: [], weeks: {} } } : parseGrowthCsv(kind, t));
  };
  const readFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const t = await f.text();
    setText(t);
    check(t);
  };

  const ok = result && !result.fatal && result.errors.length === 0 && result.validRows > 0;
  const previewRows = result ? [...Object.entries(result.patch.rev), ...Object.entries(result.patch.calls), ...result.patch.deals.map((d) => [d.date, `${d.client}, $${d.price}`] as const), ...Object.keys(result.patch.weeks).map((w) => [w, "channel counts"] as const)].slice(0, 5) : [];

  return (
    <section aria-label="CSV import" className="space-y-3 rounded-lg border border-input p-4" data-testid="growth-csv-import">
      <div>
        <h3 className="text-[15px] font-semibold">Import from a CSV</h3>
        <p className="text-[13px] text-muted-foreground">
          No need for the old dashboard. Export or type the numbers in any spreadsheet, save as CSV, and add them here. Every row is
          checked first; if any row is wrong nothing is imported. Months, days and weeks already saved are replaced by the file; deals
          already saved are skipped.
        </p>
      </div>
      <label className="block text-[13px]">
        <span className="mr-2 font-medium">What is in the file</span>
        <select
          aria-label="CSV contents"
          className="h-9 rounded-md border border-input bg-background px-2 text-[13px]"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as CsvKind);
            setResult(null);
            setDone(null);
          }}
        >
          {CSV_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>{k.label}</option>
          ))}
        </select>
      </label>
      <p className="text-[12px] text-muted-foreground">
        Columns: <span className="font-mono">{def.columns.join(", ")}</span>.{" "}
        <button type="button" className="underline" onClick={() => downloadCSV(`growth-${kind}-template.csv`, def.columns, def.example)}>
          Download a template
        </button>
      </p>
      <Textarea
        aria-label="CSV text"
        className="min-h-[100px] font-mono text-[12px]"
        placeholder="Paste CSV text, or choose a file below"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setResult(null);
          setDone(null);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Input type="file" accept=".csv,text/csv" aria-label="CSV file" className="w-auto" onChange={readFile} />
        <Button variant="outline" onClick={() => check(text)}>Check CSV</Button>
      </div>
      {result?.fatal ? <p className="text-[13px] text-destructive" role="alert" data-testid="growth-csv-fatal">{result.fatal}</p> : null}
      {result && !result.fatal && result.errors.length > 0 ? (
        <div className="text-[13px] text-destructive" role="alert" data-testid="growth-csv-errors">
          <p>{result.errors.length} {result.errors.length === 1 ? "row needs" : "rows need"} fixing. Nothing was imported.</p>
          <ul className="list-disc pl-5">
            {result.errors.slice(0, 10).map((e) => <li key={e.line}>Line {e.line}: {e.message}</li>)}
          </ul>
          {result.errors.length > 10 ? <p>and {result.errors.length - 10} more.</p> : null}
        </div>
      ) : null}
      {ok ? (
        <div className="space-y-2 rounded-md border border-input bg-muted/30 p-3 text-[13px]" data-testid="growth-csv-preview">
          <p>{result.validRows} {result.validRows === 1 ? "row is" : "rows are"} ready to add. First rows: {previewRows.map(([a, b]) => `${a}: ${b}`).join(" | ")}</p>
          {saveError ? <p className="text-destructive" role="alert">{saveError}</p> : null}
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setSaveError(null);
              try {
                await onImport(mergeCsvIntoState(state, result.patch));
                setDone(`Added ${result.validRows} ${result.validRows === 1 ? "row" : "rows"} to the saved numbers.`);
                setResult(null);
                setText("");
              } catch (e) {
                setSaveError(`Could not save: ${e instanceof Error ? e.message : "try again"}`);
              } finally {
                setBusy(false);
              }
            }}
          >
            Add to saved numbers
          </Button>
        </div>
      ) : null}
      {done ? <p className="text-[13px] text-emerald-700" role="status">{done}</p> : null}
    </section>
  );
}
