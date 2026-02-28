import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import { MetricCardSkeletonRow } from "@/components/skeletons/MetricCardSkeleton";
import { ChartSkeleton } from "@/components/skeletons/ChartSkeleton";
import { SaveViewButton } from "@/components/SaveViewButton";
import { CreativeDetailModal } from "@/components/CreativeDetailModal";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { TrendsTab } from "@/components/analytics/TrendsTab";
import { WinRateTab } from "@/components/analytics/WinRateTab";
import { ScaleTab } from "@/components/analytics/ScaleTab";
import { KillTab } from "@/components/analytics/KillTab";
import { IterationsTab } from "@/components/analytics/IterationsTab";
import { TagInsightsTab } from "@/components/analytics/TagInsightsTab";
import { BenchmarksTab } from "@/components/analytics/BenchmarksTab";
import { VideoTab } from "@/components/analytics/VideoTab";
import { CrossPlatformTab } from "@/components/analytics/CrossPlatformTab";
import { CreativeDnaTab } from "@/components/analytics/CreativeDnaTab";
import { AgingTab } from "@/components/analytics/AgingTab";
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
      <AppLayout>
        <div className="space-y-6">
          <div className="h-8 w-48 rounded-md bg-muted relative overflow-hidden"><div className="absolute inset-0 shimmer-slide" /></div>
          <MetricCardSkeletonRow />
          <ChartSkeleton />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <PageHeader
        title="Analytics"
        description="Win rate analysis, scale & kill recommendations, and iteration priorities."
        actions={
          <div className="flex items-center gap-2">
            <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onChange={(from, to) => { setDateFrom(from); setDateTo(to); }} />
            <SaveViewButton getConfig={() => ({
              page: "/analytics",
              ...(selectedAccountId && selectedAccountId !== "all" ? { account_id: selectedAccountId } : {}),
              analytics_tab: activeTab,
              ...(dateFrom ? { date_from: dateFrom } : {}),
              ...(dateTo ? { date_to: dateTo } : {}),
            })} />
          </div>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-transparent border-b border-border-light rounded-none p-0 h-auto gap-0 flex-wrap">
          {["trends", "winrate", "scale", "kill", "iterations", "taginsights", "dna", "aging", ...(canBenchmark ? ["video", "benchmarks", "crossplatform"] : [])].map((tab) => {
            const labels: Record<string, string> = { winrate: "Win Rate", taginsights: "Tag Insights", dna: "Creative DNA", aging: "Aging", video: "Video", benchmarks: "Benchmarks", crossplatform: "Cross-Platform" };
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

        <TabsContent value="trends" className="space-y-4">
          <TrendsTab trendData={filteredTrendData} isLoading={trendsLoading} />
        </TabsContent>
        <TabsContent value="winrate" className="space-y-4">
          <WinRateTab creatives={creatives} roasThreshold={roasThreshold} spendThreshold={spendThreshold} defaultSlice={defaultSlice} winnerKpi={selectedAccount?.winner_kpi} winnerKpiDirection={selectedAccount?.winner_kpi_direction} winnerKpiThreshold={parseFloat(selectedAccount?.winner_kpi_threshold || "0") || undefined} />
        </TabsContent>
        <TabsContent value="scale" className="space-y-4">
          <ScaleTab creatives={creatives} config={killScaleConfig} onCreativeClick={setSelectedCreative} />
        </TabsContent>
        <TabsContent value="kill" className="space-y-4">
          <KillTab creatives={creatives} config={killScaleConfig} onCreativeClick={setSelectedCreative} />
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
        <TabsContent value="aging" className="space-y-4">
          <AgingTab
            creatives={creatives}
            scaleThreshold={killScaleConfig.scaleAt}
            killThreshold={killScaleConfig.killAt}
            spendThreshold={spendThreshold}
            onCreativeClick={setSelectedCreative}
          />
        </TabsContent>
        {canBenchmark && (
          <TabsContent value="video" className="space-y-4">
            <VideoTab creatives={creatives} killThreshold={killScaleConfig.killAt} onCreativeClick={setSelectedCreative} />
          </TabsContent>
        )}
        {canBenchmark && (
          <TabsContent value="benchmarks" className="space-y-4">
            <BenchmarksTab />
          </TabsContent>
        )}
        {canBenchmark && (
          <TabsContent value="crossplatform" className="space-y-4">
            <CrossPlatformTab creatives={creatives} trendData={filteredTrendData} onCreativeClick={setSelectedCreative} />
          </TabsContent>
        )}
      </Tabs>

      <CreativeDetailModal creative={selectedCreative} open={!!selectedCreative} onClose={() => setSelectedCreative(null)} />
    </AppLayout>
  );
};

export default AnalyticsPage;
