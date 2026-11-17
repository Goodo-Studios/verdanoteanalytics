// CSV import for the Growth Dashboard. The old JSON export needs the old dashboard open in
// the owner's browser; a CSV can be typed or exported from any spreadsheet. Four kinds, one
// per table of numbers: revenue by month, calls by day, deals, and weekly output counts.
// Every row is checked and reported with its line number; nothing is guessed, and a file with
// any bad row imports nothing. Rows are merged into the saved numbers (a date or month that is
// already stored is replaced, a deal already stored is skipped).
import { parseCsv, type CsvRowError } from "@/lib/csv";
import { ACTS, iso, MONTHS, parseISO, withDefaults, type GrowthState } from "./model";

export type CsvKind = "revenue" | "calls" | "deals" | "outputs";

export const CSV_KINDS: { kind: CsvKind; label: string; columns: string[]; example: string[][] }[] = [
  { kind: "revenue", label: "Revenue by month (July to December)", columns: ["month", "revenue"], example: [["Jul", "42000"], ["Aug", "45500"]] },
  { kind: "calls", label: "Calls by day", columns: ["date", "calls"], example: [["2026-11-02", "6"], ["2026-11-03", "4"]] },
  { kind: "deals", label: "Deals", columns: ["date", "client", "monthly price"], example: [["2026-10-14", "Glow Drip", "4500"]] },
  {
    kind: "outputs",
    label: "Weekly output counts (week ending Friday)",
    columns: ["week ending", ...ACTS.map((a) => a.k)],
    example: [["2026-11-06", ...ACTS.map((a, i) => (i < 3 ? String(a.t) : "0"))]],
  },
];

export interface CsvImportResult {
  kind: CsvKind;
  /** Rows that passed every check. */
  validRows: number;
  errors: CsvRowError[];
  /** A problem with the whole file (empty, missing or unknown columns). */
  fatal: string | null;
  /** What the file adds, to be merged into the saved numbers. */
  patch: Pick<GrowthState, "rev" | "calls" | "deals" | "weeks">;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const emptyPatch = (): CsvImportResult["patch"] => ({ rev: {}, calls: {}, deals: [], weeks: {} });

function validDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(parseISO(s)) === s;
}
/** A plain non-negative number: no currency signs or thousands separators to guess at. */
function toNumber(s: string): number | null {
  if (!/^\d+(\.\d+)?$/.test(s.trim())) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
/** Month index 6 to 11 from Jul, July, 7 or 2026-07; null when it is not July to December. */
function monthIndex(s: string): number | null {
  const t = norm(s);
  const byName = MONTHS.findIndex((m) => t === norm(m) || (t.length >= 3 && new Date(2000, MONTHS.indexOf(m), 1).toLocaleString("en-US", { month: "long" }).toLowerCase() === t));
  if (byName >= 6) return byName;
  const ym = /^\d{4}-(\d{1,2})$/.exec(s.trim());
  const n = ym ? Number(ym[1]) : /^\d{1,2}$/.test(s.trim()) ? Number(s.trim()) : NaN;
  return n >= 7 && n <= 12 ? n - 1 : null;
}

export function parseGrowthCsv(kind: CsvKind, text: string): CsvImportResult {
  const out: CsvImportResult = { kind, validRows: 0, errors: [], fatal: null, patch: emptyPatch() };
  const table = parseCsv(text);
  if (table.length < 2) return { ...out, fatal: "The file needs a header row and at least one row of numbers." };

  const def = CSV_KINDS.find((k) => k.kind === kind)!;
  const headers = table[0].map(norm);
  const wanted = def.columns.map(norm);
  const missing = wanted.filter((c, i) => (kind === "outputs" ? i === 0 && !headers.includes(c) : !headers.includes(c)));
  if (missing.length) return { ...out, fatal: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.` };
  if (kind === "outputs" && !headers.some((h) => ACTS.some((a) => norm(a.k) === h || norm(a.n) === h))) {
    return { ...out, fatal: `Add at least one channel column (${ACTS.map((a) => a.k).join(", ")}).` };
  }
  const unknown = table[0].filter((h) => {
    const n = norm(h);
    return !wanted.includes(n) && !(kind === "outputs" && ACTS.some((a) => norm(a.n) === n));
  });
  if (unknown.length) return { ...out, fatal: `Unknown column${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}.` };

  const col = (row: string[], name: string) => row[headers.indexOf(norm(name))] ?? "";
  const seen = new Map<string, number>();

  table.slice(1).forEach((row, i) => {
    const line = i + 2;
    const fail = (message: string) => void out.errors.push({ line, message });
    if (row.length !== headers.length) return fail(`Expected ${headers.length} values, found ${row.length}`);

    if (kind === "revenue") {
      const m = monthIndex(col(row, "month"));
      const v = toNumber(col(row, "revenue"));
      if (m == null) return fail(`"${col(row, "month")}" is not a month from July to December`);
      if (v == null) return fail(`Revenue "${col(row, "revenue")}" is not a plain number (no $ or commas)`);
      if (seen.has(String(m))) return fail(`${MONTHS[m]} appears more than once (first on line ${seen.get(String(m))})`);
      seen.set(String(m), line);
      out.patch.rev[String(m)] = v;
    } else if (kind === "calls") {
      const d = col(row, "date");
      const v = toNumber(col(row, "calls"));
      if (!validDate(d)) return fail(`"${d}" is not a date (use YYYY-MM-DD)`);
      if (v == null || !Number.isInteger(v)) return fail(`Calls "${col(row, "calls")}" is not a whole number`);
      if (seen.has(d)) return fail(`${d} appears more than once (first on line ${seen.get(d)})`);
      seen.set(d, line);
      out.patch.calls[d] = v;
    } else if (kind === "deals") {
      const d = col(row, "date");
      const price = toNumber(col(row, "monthly price"));
      const client = col(row, "client");
      if (!validDate(d)) return fail(`"${d}" is not a date (use YYYY-MM-DD)`);
      if (!client) return fail("Client is empty");
      if (price == null) return fail(`Monthly price "${col(row, "monthly price")}" is not a plain number (no $ or commas)`);
      const key = `${d}|${client.toLowerCase()}|${price}`;
      if (seen.has(key)) return fail(`This deal repeats line ${seen.get(key)}`);
      seen.set(key, line);
      out.patch.deals.push({ id: `csv-${d}-${norm(client)}-${price}`, date: d, client, price });
    } else {
      const d = col(row, "week ending");
      if (!validDate(d)) return fail(`"${d}" is not a date (use YYYY-MM-DD)`);
      if (parseISO(d).getDay() !== 5) return fail(`${d} is not a Friday; weeks are keyed by their Friday`);
      if (seen.has(d)) return fail(`Week ${d} appears more than once (first on line ${seen.get(d)})`);
      const acts: Record<string, number> = {};
      for (let j = 0; j < headers.length; j++) {
        const act = ACTS.find((a) => norm(a.k) === headers[j] || norm(a.n) === headers[j]);
        if (!act || row[j] === "") continue;
        const v = toNumber(row[j]);
        if (v == null || !Number.isInteger(v)) return fail(`${act.n} "${row[j]}" is not a whole number`);
        acts[act.k] = v;
      }
      seen.set(d, line);
      out.patch.weeks[d] = { total: 0, paid: 0, spend: 0, acts };
    }
    out.validRows++;
  });

  if (out.errors.length === 0 && out.validRows === 0) out.fatal = "No rows found.";
  return out;
}

/** Add a checked CSV into the saved numbers. A month, day or week in the file replaces the stored one. */
export function mergeCsvIntoState(state: GrowthState, patch: CsvImportResult["patch"]): GrowthState {
  const storedDeals = new Set(state.deals.map((d) => `${d.date}|${d.client.toLowerCase()}|${d.price}`));
  const newDeals = patch.deals.filter((d) => !storedDeals.has(`${d.date}|${d.client.toLowerCase()}|${d.price}`));
  const weeks = { ...state.weeks };
  for (const [k, w] of Object.entries(patch.weeks)) {
    // Keep the stored total, paid and spend figures of a week; the file only carries channel counts.
    weeks[k] = { ...(weeks[k] ?? w), acts: { ...(weeks[k]?.acts ?? {}), ...w.acts } };
  }
  return withDefaults({
    ...state,
    rev: { ...state.rev, ...patch.rev },
    calls: { ...state.calls, ...patch.calls },
    deals: [...state.deals, ...newDeals],
    weeks,
  });
}
