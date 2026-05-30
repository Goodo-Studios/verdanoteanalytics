import { PageHeader } from "@/components/PageHeader";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import { MetricCardSkeletonRow } from "@/components/skeletons/MetricCardSkeleton";
import { ChartSkeleton } from "@/components/skeletons/ChartSkeleton";

import { CreativeDetailModal } from "@/components/CreativeDetailModal";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { TrendsTab } from "@/components/analytics/TrendsTab";

import { IterationsTab } from "@/components/analytics/IterationsTab";
import { TagInsightsTab } from "@/components/analytics/TagInsightsTab";

import { VideoTab } from "@/components/analytics/VideoTab";

import { CreativeDnaTab } from "@/components/analytics/CreativeDnaTab";
import { LeaderboardTab } from "@/components/analytics/LeaderboardTab";

import { useAnalyticsPageState } from "@/hooks/useAnalyticsPageState";
import { useAuth } from "@/contexts/AuthContext";

const AnalyticsPage = () => {
  const { isBuilder, isEmployee } = useAuth();
  const canBenchmark = isBuilder || isEmployee;
  const [searchParams] = useSearchParams();
  const defaultSlice = searchParams.get("slice") || "ad_type";
  const {
    activeTab, setActiveTab, selectedCreative, setSelectedCreative,
    dateFrom, dateTo, setDateFrom, setDateTo,
    selectedAccountId, selectedAccount,
    creatives, isLoading, filteredTrendData, trendsLoading,
    roasThreshold, spendThreshold, killScaleConfig,
  } = useAnalyticsPageState();

  if (isLoading) {
    return (
      <>
        <div className="space-y-6">
          <div className="h-8 w-48 rounded-md bg-muted relative overflow-hidden"><div className="absolute inset-0 shimmer-slide" /></div>
          <MetricCardSkeletonRow />
          <ChartSkeleton />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Win rate analysis, scale & kill recommendations, and iteration priorities."
        actions={
          <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onChange={(from, to) => { setDateFrom(from); setDateTo(to); }} />
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-transparent border-b border-border-light rounded-none p-0 h-auto gap-0 flex-wrap">
        {["leaderboard", "trends", "iterations", "taginsights", "dna", ...(canBenchmark ? ["video"] : [])].map((tab) => {
            const labels: Record<string, string> = { leaderboard: "Leaderboard", taginsights: "Tag Insights", dna: "Creative DNA", video: "Video" };
            return (
              <TabsTrigger
                key={tab}
                value={tab}
                className="font-body text-[14px] font-medium text-slate data-[state=active]:text-forest data-[state=active]:font-semibold data-[state=active]:border-b-2 data-[state=active]:border-verdant data-[state=active]:shadow-none rounded-none px-4 py-2.5 bg-transparent"
              >
                {labels[tab] || tab.charAt(0).toUpperCase() + tab.slice(1)}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value="leaderboard" className="space-y-4">
          <LeaderboardTab />
        </TabsContent>
        <TabsContent value="trends" className="space-y-4">
          <TrendsTab trendData={filteredTrendData} isLoading={trendsLoading} />
        </TabsContent>
        <TabsContent value="iterations" className="space-y-4">
          <IterationsTab creatives={creatives} spendThreshold={spendThreshold} onCreativeClick={setSelectedCreative} />
        </TabsContent>
        <TabsContent value="taginsights" className="space-y-4">
          <TagInsightsTab
            creatives={creatives}
            spendThreshold={spendThreshold}
            winnerKpi={selectedAccount?.winner_kpi}
            winnerKpiDirection={selectedAccount?.winner_kpi_direction}
            winnerKpiThreshold={parseFloat(selectedAccount?.winner_kpi_threshold || "0") || roasThreshold}
          />
        </TabsContent>
        <TabsContent value="dna" className="space-y-4">
          <CreativeDnaTab
            creatives={creatives}
            scaleThreshold={killScaleConfig.scaleAt}
            spendThreshold={spendThreshold}
            accountName={selectedAccount?.name}
            killScaleKpi={killScaleConfig.winnerKpi}
            killScaleKpiDirection={killScaleConfig.winnerKpiDirection}
          />
        </TabsContent>
        {canBenchmark && (
          <TabsContent value="video" className="space-y-4">
            <VideoTab creatives={creatives} onCreativeClick={setSelectedCreative} />
          </TabsContent>
        )}
      </Tabs>

      <CreativeDetailModal creative={selectedCreative} open={!!selectedCreative} onClose={() => setSelectedCreative(null)} />
    </>
  );
};

export default AnalyticsPage;
