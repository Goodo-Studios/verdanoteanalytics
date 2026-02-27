import { ReportSection } from "@/lib/reportSections";
import { TextSection } from "./sections/TextSection";
import { MetricSummarySection } from "./sections/MetricSummarySection";
import { TopCreativesSection } from "./sections/TopCreativesSection";
import { ChartSection } from "./sections/ChartSection";
import { TagBreakdownSection } from "./sections/TagBreakdownSection";
import { CustomCalloutSection } from "./sections/CustomCalloutSection";

interface SectionRendererProps {
  section: ReportSection;
  report: any;
  isEditing?: boolean;
  onConfigChange?: (config: Record<string, any>) => void;
}

export function SectionRenderer({ section, report, isEditing, onConfigChange }: SectionRendererProps) {
  const props = { config: section.config, report, isEditing, onConfigChange };

  switch (section.type) {
    case "text": return <TextSection {...props} />;
    case "metric_summary": return <MetricSummarySection {...props} />;
    case "top_creatives": return <TopCreativesSection {...props} />;
    case "chart": return <ChartSection {...props} />;
    case "tag_breakdown": return <TagBreakdownSection {...props} />;
    case "custom_callout": return <CustomCalloutSection {...props} />;
    default: return null;
  }
}
