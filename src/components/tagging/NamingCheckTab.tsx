import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, FileWarning, Info, Copy, Download } from "lucide-react";
import { useAccountContext } from "@/contexts/AccountContext";
import { loadNamingConfig, validateAdName, type NamingConventionConfig } from "@/components/settings/NamingConventionSection";
import { downloadCSV } from "@/lib/csv";
import { toast } from "sonner";

interface Props {
  creatives: any[];
}

const AVAILABLE_TOKENS: Record<string, string> = {
  account: "Account",
  format: "Format",
  hook: "Hook",
  hooktype: "HookType",
  angle: "Angle",
  creator: "Creator",
  version: "Version",
  date: "Date (MMDD)",
  campaign: "Campaign",
  custom: "Custom Text",
};

/** Build a suggested name from the creative's existing (server-resolved) tags */
function buildSuggestion(creative: any, config: NamingConventionConfig, accountAbbr: string): string {
  const tokenValue = (tokenId: string): string => {
    switch (tokenId) {
      case "account": return accountAbbr;
      case "format": return creative.ad_type || "Format";
      case "hook": return creative.hook || "Hook";
      case "hooktype": return "HookType";
      case "angle": return creative.theme || "Angle";
      case "creator": return creative.person || "Creator";
      case "version": return `v${creative.version || 1}`;
      case "date": {
        const d = new Date(creative.created_at);
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${mm}${dd}`;
      }
      case "campaign": return creative.campaign_name?.split(" ")[0] || "Campaign";
      case "custom": return config.customTexts?.["custom"] || "text";
      default: return tokenId;
    }
  };

  return config.tokens.map(tokenValue).join(config.separator);
}

export function NamingCheckTab({ creatives }: Props) {
  const { selectedAccountId, selectedAccount } = useAccountContext();
  const [showAll, setShowAll] = useState(false);

  const accountAbbr = selectedAccount?.name?.substring(0, 3).toUpperCase() || "ACC";

  const { config, results, summary } = useMemo(() => {
    if (!selectedAccountId || selectedAccountId === "all") {
      return { config: null, results: [], summary: { total: 0, valid: 0, invalid: 0 } };
    }

    const config = loadNamingConfig(selectedAccountId);

    const results = creatives.map((c) => {
      const validation = validateAdName(c.ad_name || "", config);
      return {
        ad_id: c.ad_id,
        ad_name: c.ad_name || "",
        unique_code: c.unique_code || "",
        thumbnail_url: c.thumbnail_url,
        valid: validation.valid,
        issues: validation.issues,
        suggestion: validation.valid ? "" : buildSuggestion(c, config, accountAbbr),
      };
    });

    // Sort: invalid first
    results.sort((a, b) => {
      if (a.valid === b.valid) return 0;
      return a.valid ? 1 : -1;
    });

    const valid = results.filter((r) => r.valid).length;
    return {
      config,
      results,
      summary: { total: results.length, valid, invalid: results.length - valid },
    };
  }, [creatives, selectedAccountId, accountAbbr]);

  if (!selectedAccountId || selectedAccountId === "all") {
    return (
      <div className="glass-panel p-8 text-center max-w-xl mx-auto">
        <FileWarning className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-lg font-heading mb-2">Select an Account</h3>
        <p className="text-sm text-muted-foreground">Choose a specific account from the sidebar to check naming conventions.</p>
      </div>
    );
  }

  if (!config || config.tokens.length === 0) {
    return (
      <div className="glass-panel p-8 text-center max-w-xl mx-auto">
        <Info className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-lg font-heading mb-2">No Naming Convention Set</h3>
        <p className="text-sm text-muted-foreground">
          Configure a naming convention in Account Settings → Naming to enable validation.
        </p>
      </div>
    );
  }

  const compliancePct = summary.total > 0 ? (summary.valid / summary.total) * 100 : 0;
  const invalidResults = results.filter((r) => !r.valid);
  const displayResults = showAll ? results : invalidResults;
  const displayLimit = 100;

  const handleCopySuggestion = (suggestion: string) => {
    navigator.clipboard.writeText(suggestion);
    toast.success("Suggested name copied");
  };

  const handleDownloadCSV = () => {
    const headers = ["Ad ID", "Current Name", "Suggested Name"];
    const rows = invalidResults.map((r) => [r.ad_id, r.ad_name, r.suggestion]);
    downloadCSV("rename-suggestions.csv", headers, rows);
    toast.success(`Downloaded ${rows.length} rename suggestions`);
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="glass-panel p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center text-primary">
            <FileWarning className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <h3 className="card-title">Naming Convention Check</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Template: <code className="text-[11px] font-mono bg-muted px-1 rounded">
                {config.tokens.map((t) => `{${AVAILABLE_TOKENS[t] || t}}`).join(config.separator)}
              </code>
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-3">
          <div className="text-center">
            <div className="metric-value">{summary.total}</div>
            <div className="metric-label">Total</div>
          </div>
          <div className="text-center">
            <div className="metric-value text-[hsl(var(--success))]">{summary.valid}</div>
            <div className="metric-label">Compliant</div>
          </div>
          <div className="text-center">
            <div className="metric-value text-[hsl(var(--destructive))]">{summary.invalid}</div>
            <div className="metric-label">Non-compliant</div>
          </div>
        </div>

        {/* Compliance bar */}
        <div className="h-2.5 w-full bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-success rounded-full transition-all"
            style={{ width: `${compliancePct}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">
          {compliancePct.toFixed(0)}% of creatives follow the naming convention
        </p>
      </div>

      {/* Bulk actions banner */}
      {summary.invalid > 0 && (
        <div className="glass-panel p-4 flex items-center justify-between gap-4">
          <p className="text-sm text-foreground">
            <span className="font-semibold">{summary.invalid} creatives</span> don't follow the naming convention.
            Download a rename list as CSV for use in Meta Ads Manager bulk edit.
          </p>
          <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={handleDownloadCSV}>
            <Download className="h-3.5 w-3.5" /> Download CSV
          </Button>
        </div>
      )}

      {/* Toggle */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={showAll ? "outline" : "default"}
          onClick={() => setShowAll(false)}
          className="text-xs"
        >
          Non-compliant ({summary.invalid})
        </Button>
        <Button
          size="sm"
          variant={showAll ? "default" : "outline"}
          onClick={() => setShowAll(true)}
          className="text-xs"
        >
          All ({summary.total})
        </Button>
      </div>

      {/* Results table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">Status</TableHead>
            <TableHead>Creative Name</TableHead>
            <TableHead>Issues</TableHead>
            <TableHead>Suggested Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {displayResults.slice(0, displayLimit).map((r) => (
            <TableRow key={r.ad_id}>
              <TableCell className="w-8">
                {r.valid ? (
                  <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-[hsl(var(--warning))]" />
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2 max-w-[260px]">
                  {r.thumbnail_url && (
                    <div className="h-7 w-7 rounded bg-muted shrink-0 overflow-hidden">
                      <img src={r.thumbnail_url} alt="" className="h-full w-full object-cover" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{r.ad_name}</p>
                    {r.unique_code && <p className="text-[10px] text-muted-foreground">{r.unique_code}</p>}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                {r.valid ? (
                  <span className="text-xs text-muted-foreground">✓ Compliant</span>
                ) : (
                  <div className="space-y-0.5">
                    {r.issues.map((issue, i) => (
                      <p key={i} className="text-xs text-[hsl(var(--warning))]">• {issue}</p>
                    ))}
                  </div>
                )}
              </TableCell>
              <TableCell>
                {!r.valid && r.suggestion && (
                  <div className="flex items-center gap-1.5">
                    <code className="text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded truncate max-w-[220px] block">
                      {r.suggestion}
                    </code>
                    <button
                      onClick={() => handleCopySuggestion(r.suggestion)}
                      className="text-muted-foreground hover:text-foreground shrink-0"
                      title="Copy suggestion"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {displayResults.length > displayLimit && (
        <p className="text-xs text-muted-foreground text-center">Showing first {displayLimit} of {displayResults.length} creatives</p>
      )}
    </div>
  );
}
