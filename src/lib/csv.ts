/**
 * Parse a single CSV line into field values.
 * - Commas inside double-quoted fields do not split.
 * - Boundary quotes are stripped from the value (`"Style, Modern"` → `Style, Modern`).
 * - RFC 4180 escaped quotes are honored: `""` inside a quoted field is a literal `"`.
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'; // escaped quote — emit one literal quote
        i++;
      } else {
        inQuotes = !inQuotes; // boundary quote — not part of the value
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * One CSV cell. Text a spreadsheet would run as a formula (starting with =, +, -, @, tab or
 * carriage return) gets a leading apostrophe; real numbers, negative ones included, are left
 * as numbers (audit 2.4).
 */
export function escapeCsvCell(val: string): string {
  if (val == null) return "";
  let s = String(val);
  const isNumber = s.trim() !== "" && Number.isFinite(Number(s));
  if (!isNumber && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Parse a whole CSV file into rows of trimmed values (RFC 4180). Unlike splitting on
 * "\n" first, a quoted value may contain commas, escaped quotes ("") and line breaks
 * (audit 5.9). Handles \r\n and \n endings and a leading byte-order mark, and skips
 * blank lines.
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const endRow = () => {
    row.push(field.trim());
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
    field = "";
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endRow();
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

export const TAG_MAPPING_COLUMNS = ["UniqueCode", "Type", "Person", "Style", "Product", "Hook", "Theme"] as const;

export interface CsvRowError {
  /** 1-based line of the row in the file (the header is line 1). */
  line: number;
  message: string;
}

export interface TagMappingsCsvResult {
  rows: Record<string, string>[];
  errors: CsvRowError[];
  /** A problem with the whole file (no rows, missing columns). */
  fatal: string | null;
}

/**
 * Parse and check a tag mapping CSV before anything is sent (audit 5.9). Every row is
 * checked: a value count that does not match the header, an empty UniqueCode, or a
 * UniqueCode repeated in the file is reported with its line number.
 */
export function parseTagMappingsCsv(text: string): TagMappingsCsvResult {
  const table = parseCsv(text);
  if (table.length < 2) {
    return { rows: [], errors: [], fatal: "Invalid CSV: the file needs a header row and at least one row." };
  }
  const headers = table[0];
  const missing = TAG_MAPPING_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length > 0) return { rows: [], errors: [], fatal: `Missing columns: ${missing.join(", ")}` };

  const rows: Record<string, string>[] = [];
  const errors: CsvRowError[] = [];
  const seen = new Map<string, number>();
  table.slice(1).forEach((values, i) => {
    const line = i + 2;
    if (values.length !== headers.length) {
      errors.push({ line, message: `Expected ${headers.length} values, found ${values.length}` });
      return;
    }
    const row: Record<string, string> = {};
    headers.forEach((h, j) => {
      row[h] = values[j] ?? "";
    });
    const code = row.UniqueCode;
    if (!code) {
      errors.push({ line, message: "UniqueCode is empty" });
      return;
    }
    const first = seen.get(code);
    if (first !== undefined) {
      errors.push({ line, message: `UniqueCode ${code} appears more than once (first on line ${first})` });
      return;
    }
    seen.set(code, line);
    rows.push(row);
  });
  return { rows, errors, fatal: null };
}

/** One short message for a toast, listing the first few row errors. */
export function describeCsvErrors(errors: CsvRowError[], max = 3): string {
  const shown = errors.slice(0, max).map((e) => `Line ${e.line}: ${e.message}`);
  const more = errors.length > max ? ` (and ${errors.length - max} more)` : "";
  return shown.join("; ") + more;
}

export function downloadCSV(filename: string, headers: string[], rows: string[][]) {
  const escape = escapeCsvCell;

  const csvContent = [
    headers.map(escape).join(","),
    ...rows.map((row) => row.map(escape).join(",")),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportCreativesCSV(creatives: any[]) {
  const headers = [
    "Ad ID", "Ad Name", "Unique Code", "Status", "Type", "Person", "Creative Type",
    "Hook", "Product", "Theme", "Tag Source", "Campaign", "Ad Set",
    "Spend", "ROAS", "CPA", "CTR", "CPM", "Clicks", "Impressions", "Purchases",
  ];
  const rows = creatives.map((c) => [
    c.ad_id || "", c.ad_name || "", c.unique_code || "", c.ad_status || "",
    c.ad_type || "", c.person || "", c.style || "", c.hook || "",
    c.product || "", c.theme || "", c.tag_source || "",
    c.campaign_name || "", c.adset_name || "",
    String(c.spend || 0), String(c.roas || 0), String(c.cpa || 0),
    String(c.ctr || 0), String(c.cpm || 0), String(c.clicks || 0),
    String(c.impressions || 0), String(c.purchases || 0),
  ]);
  downloadCSV("creatives-export.csv", headers, rows);
}

export function exportReportCSV(report: any) {
  const headers = ["Metric", "Value"];
  const rows = [
    ["Report Name", report.report_name],
    ["Generated", new Date(report.created_at).toLocaleString()],
    ["Creatives", String(report.creative_count || 0)],
    ["Total Spend", `$${report.total_spend || 0}`],
    ["Blended ROAS", `${report.blended_roas || 0}x`],
    ["Average CPA", `$${report.average_cpa || 0}`],
    ["Average CTR", `${report.average_ctr || 0}%`],
    ["Win Rate", `${report.win_rate || 0}%`],
    ["Tags Parsed", String(report.tags_parsed_count || 0)],
    ["Tags CSV", String(report.tags_csv_count || 0)],
    ["Tags Manual", String(report.tags_manual_count || 0)],
    ["Tags Untagged", String(report.tags_untagged_count || 0)],
  ];

  // Add top performers
  try {
    const top = JSON.parse(report.top_performers || "[]");
    if (top.length) {
      rows.push(["", ""], ["Top Performers", ""]);
      rows.push(["Name", "ROAS / CPA / Spend"]);
      top.forEach((p: any) => rows.push([p.ad_name, `${p.roas}x / $${p.cpa} / $${p.spend}`]));
    }
  } catch {}

  downloadCSV(`report-${(report.report_name ?? 'report').replace(/\s+/g, "-")}.csv`, headers, rows);
}
