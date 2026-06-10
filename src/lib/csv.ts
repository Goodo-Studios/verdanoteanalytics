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

export function downloadCSV(filename: string, headers: string[], rows: string[][]) {
  const escape = (val: string) => {
    if (val == null) return '';
    const s = String(val);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

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
    "Ad ID", "Ad Name", "Unique Code", "Status", "Type", "Person", "Style",
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
