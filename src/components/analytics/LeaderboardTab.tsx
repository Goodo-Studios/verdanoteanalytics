import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useAccountContext } from "@/contexts/AccountContext";
import { getLibrary, type LibraryDimension } from "@/lib/api";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function fmtSpend(n: number): string {
  return usd.format(Number(n) || 0);
}

function fmtRoas(n: number): string {
  return `${(Number(n) || 0).toFixed(2)}x`;
}

function fmtCtr(n: number): string {
  // avg_ctr is already a percentage (Meta's `ctr` field, e.g. 1.67 = 1.67%) —
  // same convention as creatives.ctr everywhere else in the app. Do NOT ×100.
  return `${(Number(n) || 0).toFixed(2)}%`;
}

/** Ranked own-ad hook/angle leaderboard. Numbers come verbatim from the
 * GET /library RPC-backed endpoint — rows are rendered in the order received,
 * with no client-side sort, re-rank, or recompute. The single source of truth
 * is the SQL RPC surfaced through the api. */
export function LeaderboardTab() {
  const { selectedAccountId } = useAccountContext();
  const [dimension, setDimension] = useState<LibraryDimension>("hook");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["hook-angle-library", selectedAccountId, dimension],
    enabled: !!selectedAccountId,
    queryFn: () => getLibrary(selectedAccountId!, dimension),
  });

  const dimLabel = dimension === "hook" ? "Hook" : "Angle";

  return (
    <section>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Performance Leaderboard</h2>
          <p className="text-xs text-muted-foreground">
            Your own ads ranked by spend, grouped by {dimension === "hook" ? "hook" : "angle"}.
          </p>
        </div>

        {/* Dimension toggle: Hook ↔ Angle (theme) */}
        <div
          className="inline-flex rounded-lg border border-border p-0.5 bg-muted/40 self-start"
          role="tablist"
          aria-label="Leaderboard dimension"
        >
          {(["hook", "theme"] as LibraryDimension[]).map((d) => {
            const active = dimension === d;
            return (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setDimension(d)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {d === "hook" ? "Hook" : "Angle"}
              </button>
            );
          })}
        </div>
      </div>

      {!selectedAccountId ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Select an account to view its {dimension === "hook" ? "hook" : "angle"} leaderboard.
        </div>
      ) : isLoading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
          Loading leaderboard…
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive">
          Failed to load leaderboard{error instanceof Error ? `: ${error.message}` : "."}
        </div>
      ) : !data || data.rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center space-y-1">
          <p className="text-sm text-muted-foreground">
            No {dimension === "hook" ? "hook" : "angle"} performance data yet for this account.
          </p>
          <p className="text-xs text-muted-foreground">
            Once your ads accrue spend and tagging, ranked rows appear here.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {/* Coverage header — tag coverage prominent, spend breakdown alongside. */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-3 border-b border-border bg-muted/30">
            <div className="flex items-baseline gap-2">
              <span className="text-sm text-muted-foreground">Tag coverage:</span>
              <span className="text-2xl font-bold text-foreground tabular-nums">
                {(Number(data.coverage.tag_coverage_pct) || 0).toFixed(1)}%
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
              <span>
                Tagged{" "}
                <span className="font-medium text-foreground">{fmtSpend(data.coverage.tagged_spend)}</span>
              </span>
              <span>
                Untagged{" "}
                <span className="font-medium text-foreground">{fmtSpend(data.coverage.untagged_spend)}</span>
              </span>
              <span>
                Total{" "}
                <span className="font-medium text-foreground">{fmtSpend(data.coverage.total_spend)}</span>
              </span>
            </div>
          </div>

          {/* Column headers */}
          <div className="hidden sm:grid grid-cols-[2.5rem_minmax(0,1fr)_7rem_4rem_5rem_5rem] gap-3 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground border-b border-border">
            <span>#</span>
            <span>{dimLabel}</span>
            <span className="text-right">Spend</span>
            <span className="text-right">Ads</span>
            <span className="text-right">ROAS</span>
            <span className="text-right">CTR</span>
          </div>

          {/* Rows — rendered in API order (is_untagged ASC, total_spend DESC). */}
          <div>
            {data.rows.map((row, idx) => (
              <div
                key={`${dimension}-${row.is_untagged ? "untagged" : row.label}-${idx}`}
                className={`grid grid-cols-[2.5rem_minmax(0,1fr)_7rem_4rem_5rem_5rem] gap-3 px-4 py-3 items-center text-sm ${
                  row.is_untagged
                    ? "border-t-2 border-dashed border-border bg-muted/20 text-muted-foreground"
                    : "border-t border-border"
                }`}
              >
                <span className="text-xs text-muted-foreground tabular-nums">
                  {row.is_untagged ? "—" : idx + 1}
                </span>
                <span className="truncate font-medium text-foreground">
                  {row.is_untagged ? (
                    <span className="italic text-muted-foreground">Untagged</span>
                  ) : (
                    row.label
                  )}
                </span>
                <span className="text-right font-semibold text-foreground tabular-nums">
                  {fmtSpend(row.total_spend)}
                </span>
                <span className="text-right tabular-nums">{Number(row.n_ads) || 0}</span>
                <span className="text-right tabular-nums">{fmtRoas(row.avg_roas)}</span>
                <span className="text-right tabular-nums">{fmtCtr(row.avg_ctr)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
