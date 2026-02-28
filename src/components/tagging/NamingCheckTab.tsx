import { useMemo } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, FileWarning, Info } from "lucide-react";
import { useAccountContext } from "@/contexts/AccountContext";
import { loadNamingConfig, validateAdName } from "@/components/settings/NamingConventionSection";

interface Props {
  creatives: any[];
}

export function NamingCheckTab({ creatives }: Props) {
  const { selectedAccountId, selectedAccount } = useAccountContext();

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
        tag_source: c.tag_source,
        thumbnail_url: c.thumbnail_url,
        valid: validation.valid,
        issues: validation.issues,
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
  }, [creatives, selectedAccountId]);

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

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="glass-panel p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center text-primary">
            <FileWarning className="h-4 w-4" />
          </div>
          <div>
            <h3 className="card-title">Naming Convention Check</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Template: <code className="text-[11px] font-mono bg-muted px-1 rounded">
                {config.tokens.map((t) => `{${t}}`).join(config.separator)}
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
            className="h-full bg-success rounded-full transition-progress"
            style={{ width: `${compliancePct}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">
          {compliancePct.toFixed(0)}% of creatives follow the naming convention
        </p>
      </div>

      {/* Results table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">Status</TableHead>
            <TableHead>Creative Name</TableHead>
            <TableHead>Issues</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.slice(0, 100).map((r) => (
            <TableRow key={r.ad_id}>
              <TableCell className="w-8">
                {r.valid ? (
                  <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-[hsl(var(--warning))]" />
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2 max-w-[300px]">
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
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {results.length > 100 && (
        <p className="text-xs text-muted-foreground text-center">Showing first 100 of {results.length} creatives</p>
      )}
    </div>
  );
}
