import { DateRangeFilter } from "@/components/DateRangeFilter";
import { useOverviewPageState } from "@/hooks/useOverviewPageState";
import { useSync } from "@/hooks/useSyncApi";
import { useAuth } from "@/contexts/AuthContext";
import { useClientPreview } from "@/hooks/useClientPreviewMode";
import { Button } from "@/components/ui/button";
import { WaitingOnYouLine } from "@/components/client/WaitingOnYouLine";
import { ClientHomeLead } from "@/features/client-pages/ClientHomeLead";
import { RefreshCw } from "lucide-react";
import { Navigate } from "react-router-dom";
import { useAccountContext } from "@/contexts/AccountContext";
import { useRolePrefix } from "@/hooks/useRolePath";
import { useOwnClientLinks } from "@/hooks/usePipelineTasks";
import { clientLanding } from "@/lib/pipelineCycles";
import { EmptyState, LoadingState, MetricCard, MetricGrid, PageHeader, PageShell } from "@/components/page-kit";
import { fmt$, fmtN, fmtPct, delta, deltaInverse } from "@/lib/formatters";

const OverviewPage = () => {
  const sync = useSync();
  const { isClient } = useAuth();
  const { isClientPreview } = useClientPreview();
  const effectiveClient = isClient || isClientPreview;

  const {
    accountName,
    lastSyncedAgo,
    dateFrom, dateTo, setDateRange,
    metrics, prevMetrics, hasPrevPeriod,
    isLoading,
    creatives,
    selectedAccountId,
  } = useOverviewPageState();

  // A client with no ad account but a link to a client has no metrics to show: it lands on its pipeline.
  // The links are read only for a real client login with no ad account (the answer is not needed otherwise).
  const prefix = useRolePrefix();
  const { accounts, isLoading: accountsLoading } = useAccountContext();
  const links = useOwnClientLinks(isClient && !accountsLoading && accounts.length === 0);
  const landing = clientLanding({
    isClient,
    accountsLoading,
    accountCount: accounts.length,
    linksLoading: links.isLoading,
    linkCount: links.data?.length ?? 0,
  });

  const subtitle = [
    dateFrom && dateTo ? `${dateFrom} → ${dateTo}` : "All time",
    lastSyncedAgo ? `Synced ${lastSyncedAgo}` : null,
    !isLoading ? `${fmtN(creatives.length)} creatives` : null,
  ].filter(Boolean).join(" · ");

  if (landing === "pipeline") return <Navigate to={`${prefix}/pipeline`} replace />;
  if (landing === "wait") return <LoadingState label="Loading overview" variant="cards" />;

  const syncNow = () => sync.mutate({ account_id: selectedAccountId && selectedAccountId !== "all" ? selectedAccountId : undefined });
  const isEmpty = !isLoading && creatives.length === 0;

  return (
    <PageShell wide>
      {/* A client's first screen (OS-019): the one item that needs them and a short list, then the
          content pipeline line (waiting count and current cycle), then the metrics. Real client
          logins only. */}
      {isClient ? <ClientHomeLead /> : null}
      {isClient ? <WaitingOnYouLine /> : null}
      <PageHeader
        title={accountName}
        description={subtitle}
        className="mb-0"
        actions={
          <>
            <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onChange={setDateRange} />
            {!effectiveClient && (
              <Button size="sm" onClick={syncNow} disabled={sync.isPending}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                {sync.isPending ? "Syncing" : "Sync"}
              </Button>
            )}
          </>
        }
      />

      {/* Metrics */}
      {isLoading ? (
        <LoadingState label="Loading metrics" variant="cards" count={6} />
      ) : (
        <MetricGrid className="sm:grid-cols-3">
          <MetricCard label="Total Spend" value={fmt$(metrics.totalSpend)} trendLabel="vs prior period" trend={hasPrevPeriod ? delta(metrics.totalSpend, prevMetrics?.totalSpend) : undefined} />
          <MetricCard label="Active Creatives" value={fmtN(metrics.activeCount)} trendLabel="vs prior period" trend={hasPrevPeriod ? delta(metrics.activeCount, prevMetrics?.activeCount) : undefined} />
          <MetricCard label="Avg CPA" value={fmt$(metrics.avgCpa)} inverse trendLabel="vs prior period" trend={hasPrevPeriod ? deltaInverse(metrics.avgCpa, prevMetrics?.avgCpa) : undefined} />
          <MetricCard label="Avg ROAS" value={`${metrics.avgRoas.toFixed(2)}x`} trendLabel="vs prior period" trend={hasPrevPeriod ? delta(metrics.avgRoas, prevMetrics?.avgRoas) : undefined} />
          <MetricCard label="Win Rate" value={fmtPct(metrics.winRate)} />
          <MetricCard label="Blended CTR" value={fmtPct(metrics.avgCtr)} trendLabel="vs prior period" trend={hasPrevPeriod ? delta(metrics.avgCtr, prevMetrics?.avgCtr) : undefined} />
        </MetricGrid>
      )}
      {/* Zero metrics are still shown above; this says why and offers the one way forward. */}
      {isEmpty ? (
        <EmptyState
          title="No ad data for these dates"
          description={effectiveClient ? "Nothing ran in this date range. Try a wider range." : "Nothing has synced for this range yet. Sync to pull in the latest spend."}
          action={
            effectiveClient ? (
              <Button size="sm" variant="outline" onClick={() => setDateRange(undefined, undefined)}>Show all time</Button>
            ) : (
              <Button size="sm" onClick={syncNow} disabled={sync.isPending}>Sync now</Button>
            )
          }
        />
      ) : null}
    </PageShell>
  );
};

export default OverviewPage;
