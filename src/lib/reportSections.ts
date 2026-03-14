export type SectionType = "notes" | "metric_summary" | "top_creatives" | "iterations" | "chart" | "tag_breakdown" | "text" | "custom_callout";

export interface ReportSection {
  id: string;
  type: SectionType;
  config: Record<string, any>;
}

export const SECTION_TYPE_META: Record<SectionType, { label: string; icon: string; description: string }> = {
  notes: { label: "Notes", icon: "📝", description: "Your notes to share with this report" },
  metric_summary: { label: "Metric Summary", icon: "📊", description: "Key metrics for the date range" },
  top_creatives: { label: "Top 5 Ads", icon: "🏆", description: "Top 5 performing creatives" },
  iterations: { label: "Top 5 Iterations", icon: "🔄", description: "Top 5 iteration opportunities" },
  chart: { label: "Chart", icon: "📈", description: "Spend or ROAS trend line chart" },
  tag_breakdown: { label: "Tag Breakdown", icon: "🏷️", description: "ROAS by tag category" },
  text: { label: "Text Block", icon: "📄", description: "Rich text / markdown content" },
  custom_callout: { label: "Custom Callout", icon: "⭐", description: "Highlighted stat with icon" },
};

export function createSection(type: SectionType): ReportSection {
  const id = crypto.randomUUID();
  const defaults: Record<SectionType, Record<string, any>> = {
    notes: { content: "" },
    metric_summary: {},
    top_creatives: { count: 5, sortBy: "spend" },
    iterations: { count: 5 },
    chart: { metric: "spend" },
    tag_breakdown: { tagField: "hook" },
    text: { content: "" },
    custom_callout: { icon: "🏆", stat: "", label: "" },
  };
  return { id, type, config: defaults[type] };
}

/** The standard report layout — same for everyone */
export function standardReportSections(): ReportSection[] {
  return [
    { id: "std-notes", type: "notes", config: { content: "" } },
    { id: "std-metrics", type: "metric_summary", config: {} },
    { id: "std-top5", type: "top_creatives", config: { count: 5, sortBy: "spend" } },
    { id: "std-iterations", type: "iterations", config: { count: 5 } },
  ];
}

/** Convert legacy report (no sections) into a sections array */
export function legacySectionsFromReport(_report: any): ReportSection[] {
  return standardReportSections();
}
