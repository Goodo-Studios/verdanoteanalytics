/**
 * Print-only layout for PDF export.
 * Hidden on screen via .print-only class — rendered in DOM but display:none until @media print.
 */

interface Props {
  report: any;
  previousReport?: any;
  topCreatives: any[];
  tagBreakdown: { tag: string; avgRoas: number; count: number; spendPct: number }[];
  highlights: string[];
}

function fmtCurrency(v: number | null) {
  if (v === null || v === undefined) return "—";
  return `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function fmtDelta(current: number | null, previous: number | null) {
  if (!current || !previous || previous === 0) return null;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const sign = pct >= 0 ? "▲" : "▼";
  return { label: `${sign} ${Math.abs(pct).toFixed(0)}%`, isPositive: pct >= 0 };
}

export function ReportPrintLayout({ report, previousReport, topCreatives, tagBreakdown, highlights }: Props) {
  const prev = previousReport;
  const dateRange = report.date_range_start && report.date_range_end
    ? `${new Date(report.date_range_start).toLocaleDateString()} – ${new Date(report.date_range_end).toLocaleDateString()}`
    : report.date_range_days
      ? `Last ${report.date_range_days} days`
      : "";

  const heroMetrics = [
    { label: "Total Spend", value: fmtCurrency(report.total_spend), delta: fmtDelta(report.total_spend, prev?.total_spend) },
    { label: "ROAS", value: report.blended_roas ? `${Number(report.blended_roas).toFixed(2)}x` : "—", delta: fmtDelta(report.blended_roas, prev?.blended_roas) },
    { label: "Purchases", value: report.creative_count != null ? String(report.creative_count) : "—", delta: fmtDelta(report.creative_count, prev?.creative_count) },
    { label: "CPA", value: fmtCurrency(report.average_cpa), delta: fmtDelta(report.average_cpa, prev?.average_cpa) },
  ];

  return (
    <div className="print-only print-report-wrapper" style={{ display: "none" }}>
      {/* ═══════════════ PAGE 1 — COVER ═══════════════ */}
      <div className="print-cover">
        <h1>{report.report_name}</h1>
        {dateRange && <div className="print-subtitle">{dateRange}</div>}
        <div className="print-meta" style={{ marginTop: "32pt" }}>
          <div style={{ fontSize: "10pt", color: "#888" }}>
            Generated {new Date(report.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
          </div>
          <div style={{ marginTop: "24pt", fontSize: "11pt", color: "#555", fontWeight: 500 }}>
            Prepared by Goodo Studios
          </div>
          <div style={{ fontSize: "9pt", color: "#999", marginTop: "4pt" }}>
            goodostudios.com
          </div>
        </div>
      </div>

      {/* ═══════════════ PAGE 2 — EXECUTIVE SUMMARY ═══════════════ */}
      <div className="print-page-break">
        <h2 className="print-section-title">Executive Summary</h2>
        {dateRange && (
          <p style={{ fontSize: "10pt", color: "#666", marginBottom: "12pt" }}>
            Period: {dateRange}
          </p>
        )}

        <div className="print-metrics-grid">
          {heroMetrics.map((m) => (
            <div key={m.label} className="print-metric-card">
              <div className="print-metric-label">{m.label}</div>
              <div className="print-metric-value">{m.value}</div>
              {m.delta && (
                <div
                  className="print-metric-delta"
                  style={{ color: m.delta.isPositive ? "#16a34a" : "#dc2626" }}
                >
                  {m.delta.label} vs. prior period
                </div>
              )}
            </div>
          ))}
        </div>

        {highlights.length > 0 && (
          <div className="print-highlights" style={{ marginTop: "16pt" }}>
            <h3 style={{ fontFamily: "Georgia, serif", fontSize: "12pt", color: "#0d3b25", marginBottom: "8pt" }}>
              Key Highlights
            </h3>
            <ul>
              {highlights.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ═══════════════ PAGE 3+ — CREATIVE PERFORMANCE ═══════════════ */}
      {topCreatives.length > 0 && (
        <div className="print-page-break">
          <h2 className="print-section-title">Top Creative Performance</h2>
          <div className="print-creatives-grid">
            {topCreatives.slice(0, 6).map((c) => (
              <div key={c.ad_id} className="print-creative-cell">
                {c.thumbnail_url && (
                  <img src={c.thumbnail_url} alt="" />
                )}
                <div style={{ fontSize: "10pt", fontWeight: 600, color: "#1a1a1a", marginBottom: "3pt" }}>
                  {c.ad_name?.slice(0, 60)}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9pt" }}>
                  <span style={{
                    background: Number(c.roas) >= 2 ? "#dcfce7" : "#fef3c7",
                    color: Number(c.roas) >= 2 ? "#166534" : "#92400e",
                    padding: "2pt 6pt",
                    borderRadius: "3px",
                    fontWeight: 600,
                  }}>
                    {Number(c.roas || 0).toFixed(2)}x ROAS
                  </span>
                  <span style={{ color: "#666" }}>
                    {fmtCurrency(c.spend)} spend
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══════════════ FINAL PAGE — TAG BREAKDOWN ═══════════════ */}
      {tagBreakdown.length > 0 && (
        <div className="print-page-break">
          <h2 className="print-section-title">Tag Breakdown</h2>
          <table className="print-tag-table">
            <thead>
              <tr>
                <th>Tag / Hook Type</th>
                <th style={{ textAlign: "right" }}>Avg ROAS</th>
                <th style={{ textAlign: "right" }}>Creatives</th>
                <th style={{ textAlign: "right" }}>% of Spend</th>
              </tr>
            </thead>
            <tbody>
              {tagBreakdown.map((row) => (
                <tr key={row.tag}>
                  <td style={{ fontWeight: 500 }}>{row.tag}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {row.avgRoas.toFixed(2)}x
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {row.count}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {row.spendPct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
