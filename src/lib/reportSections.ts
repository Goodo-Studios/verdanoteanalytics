export type SectionType = "text" | "metric_summary" | "top_creatives" | "chart" | "tag_breakdown" | "custom_callout";

export interface ReportSection {
  id: string;
  type: SectionType;
  config: Record<string, any>;
}

export const SECTION_TYPE_META: Record<SectionType, { label: string; icon: string; description: string }> = {
  text: { label: "Text Block", icon: "📝", description: "Rich text / markdown content" },
  metric_summary: { label: "Metric Summary", icon: "📊", description: "Key metrics for the date range" },
  top_creatives: { label: "Top Creatives", icon: "🏆", description: "Top N creatives grid" },
  chart: { label: "Chart", icon: "📈", description: "Spend or ROAS trend line chart" },
  tag_breakdown: { label: "Tag Breakdown", icon: "🏷️", description: "ROAS by tag category" },
  custom_callout: { label: "Custom Callout", icon: "⭐", description: "Highlighted stat with icon" },
};

export function createSection(type: SectionType): ReportSection {
  const id = crypto.randomUUID();
  const defaults: Record<SectionType, Record<string, any>> = {
    text: { content: "" },
    metric_summary: {},
    top_creatives: { count: 6, sortBy: "spend" },
    chart: { metric: "spend" },
    tag_breakdown: { tagField: "hook" },
    custom_callout: { icon: "🏆", stat: "", label: "" },
  };
  return { id, type, config: defaults[type] };
}

/** Convert legacy report (no sections) into a sections array */
export function legacySectionsFromReport(report: any): ReportSection[] {
  const sections: ReportSection[] = [];
  // Always show metrics summary
  sections.push({ id: "legacy-metrics", type: "metric_summary", config: {} });
  // Top performers as a top_creatives section
  const topPerformers = (() => { try { return JSON.parse(report.top_performers || "[]"); } catch { return []; } })();
  if (topPerformers.length > 0) {
    sections.push({ id: "legacy-top", type: "top_creatives", config: { count: Math.min(topPerformers.length, 10), sortBy: "spend" } });
  }
  return sections;
}
