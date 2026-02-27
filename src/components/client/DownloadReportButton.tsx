import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCallback } from "react";

interface DownloadReportProps {
  accountName: string;
  metrics: { totalSpend: number; avgRoas: number; avgCpa: number; avgCtr: number; winRate: number };
  topPerformers: any[];
  storyContent?: string;
}

function fmt$(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

export function DownloadReportButton({ accountName, metrics, topPerformers, storyContent }: DownloadReportProps) {
  const handleDownload = useCallback(() => {
    const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    const topHtml = topPerformers.slice(0, 3).map((c: any) => {
      const roas = (Number(c.roas) || 0).toFixed(2);
      const spend = fmt$(Number(c.spend) || 0);
      const thumb = c.thumbnail_url
        ? `<img src="${c.thumbnail_url}" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:6px;margin-bottom:8px;" />`
        : `<div style="width:100%;aspect-ratio:16/9;background:#f0ebe3;border-radius:6px;margin-bottom:8px;display:flex;align-items:center;justify-content:center;color:#a8a090;font-size:12px;">No preview</div>`;
      return `<div style="flex:1;min-width:180px;">
        ${thumb}
        <p style="font-weight:600;font-size:13px;margin:0 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.ad_name}</p>
        <p style="font-size:12px;color:#6b7280;margin:0;">ROAS: ${roas}x · Spend: ${spend}</p>
      </div>`;
    }).join("");

    const storySection = storyContent
      ? `<div style="margin-top:28px;padding:16px;border:1px solid #e2ede7;border-radius:8px;">
          <h3 style="font-family:serif;font-size:16px;color:#1b4332;margin:0 0 8px;">This Period's Highlights</h3>
          <p style="font-size:14px;color:#2c2c2c;line-height:1.7;margin:0;white-space:pre-wrap;">${storyContent.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
        </div>`
      : "";

    const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>${accountName} — Performance Report</title>
<style>
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #2c2c2c; }
  h1 { font-family: Georgia, serif; color: #1b4332; font-size: 28px; margin: 0; }
  h2 { font-family: Georgia, serif; color: #1b4332; font-size: 18px; margin: 28px 0 12px; }
  .subtitle { color: #6b7280; font-size: 13px; margin: 4px 0 0; }
  .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 24px; }
  .metric-box { padding: 16px; border: 1px solid #e2ede7; border-radius: 8px; text-align: center; }
  .metric-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; font-weight: 500; }
  .metric-val { font-size: 28px; font-weight: 600; margin-top: 4px; color: #2c2c2c; }
  .top-grid { display: flex; gap: 16px; margin-top: 12px; }
  .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e2ede7; text-align: center; color: #a8a090; font-size: 11px; }
</style>
</head><body>
<h1>${accountName}</h1>
<p class="subtitle">Creative Performance Report · ${today}</p>

<div class="metrics">
  <div class="metric-box"><div class="metric-label">Total Spend</div><div class="metric-val">${fmt$(metrics.totalSpend)}</div></div>
  <div class="metric-box"><div class="metric-label">ROAS</div><div class="metric-val">${metrics.avgRoas.toFixed(2)}x</div></div>
  <div class="metric-box"><div class="metric-label">CPA</div><div class="metric-val">${fmt$(metrics.avgCpa)}</div></div>
  <div class="metric-box"><div class="metric-label">Win Rate</div><div class="metric-val">${metrics.winRate.toFixed(1)}%</div></div>
</div>

${topPerformers.length > 0 ? `<h2>Top Performers</h2><div class="top-grid">${topHtml}</div>` : ""}

${storySection}

<div class="footer">
  <p>Powered by Goodo Studios × Verdanote</p>
</div>

<script>window.onload = function() { window.print(); }</script>
</body></html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (win) {
      win.onafterprint = () => URL.revokeObjectURL(url);
    }
  }, [accountName, metrics, topPerformers, storyContent]);

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDownload}
      className="gap-1.5 font-body text-[12px]"
    >
      <Download className="h-3 w-3" />
      Download Report
    </Button>
  );
}
