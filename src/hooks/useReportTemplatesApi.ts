import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMutationWithToast } from "./useMutationWithToast";
import { ReportSection } from "@/lib/reportSections";

export interface ReportTemplate {
  id: string;
  name: string;
  description: string | null;
  sections: ReportSection[];
  is_default: boolean;
  created_by: string | null;
  created_at: string;
}

const SEED_TEMPLATES: Omit<ReportTemplate, "id" | "created_by" | "created_at">[] = [
  {
    name: "Monthly Performance Report",
    description: "Full month overview with metrics, top creatives, tag breakdown, and trend chart",
    is_default: true,
    sections: [
      { id: "tpl-ms-1", type: "metric_summary", config: {} },
      { id: "tpl-tc-1", type: "top_creatives", config: { count: 6, sortBy: "spend" } },
      { id: "tpl-tb-1", type: "tag_breakdown", config: { tagField: "hook" } },
      { id: "tpl-ch-1", type: "chart", config: { metric: "roas" } },
      { id: "tpl-tx-1", type: "text", config: { content: "## Recommendations\n\n_Add your recommendations here._" } },
    ],
  },
  {
    name: "Weekly Check-in",
    description: "Quick weekly snapshot with top performers and a highlight callout",
    is_default: false,
    sections: [
      { id: "tpl-ms-2", type: "metric_summary", config: {} },
      { id: "tpl-tc-2", type: "top_creatives", config: { count: 3, sortBy: "roas" } },
      { id: "tpl-cc-2", type: "custom_callout", config: { icon: "🏆", stat: "", label: "Best creative of the week" } },
      { id: "tpl-tx-2", type: "text", config: { content: "## Notes\n\n_Add your notes here._" } },
    ],
  },
  {
    name: "Creative Review",
    description: "Deep dive into creative performance with tag analysis",
    is_default: false,
    sections: [
      { id: "tpl-tx-3a", type: "text", config: { content: "## Context\n\n_Describe the review context._" } },
      { id: "tpl-tc-3", type: "top_creatives", config: { count: 9, sortBy: "spend" } },
      { id: "tpl-tb-3", type: "tag_breakdown", config: { tagField: "hook" } },
      { id: "tpl-tx-3b", type: "text", config: { content: "## What's Working\n\n" } },
      { id: "tpl-tx-3c", type: "text", config: { content: "## Recommendations\n\n" } },
    ],
  },
  {
    name: "Executive Summary",
    description: "High-level overview with key callout stats and a brief narrative",
    is_default: false,
    sections: [
      { id: "tpl-cc-4a", type: "custom_callout", config: { icon: "📈", stat: "", label: "ROAS" } },
      { id: "tpl-cc-4b", type: "custom_callout", config: { icon: "💰", stat: "", label: "Total Spend" } },
      { id: "tpl-cc-4c", type: "custom_callout", config: { icon: "🛒", stat: "", label: "Purchases" } },
      { id: "tpl-tx-4", type: "text", config: { content: "## Narrative\n\n_Add executive summary here._" } },
      { id: "tpl-tc-4", type: "top_creatives", config: { count: 3, sortBy: "roas" } },
    ],
  },
];

export function useReportTemplates() {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ["report-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("report_templates")
        .select("*")
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;

      // Seed if empty
      if (data.length === 0) {
        const { data: user } = await supabase.auth.getUser();
        const userId = user?.user?.id;
      const inserts = SEED_TEMPLATES.map((t) => ({
          ...t,
          sections: t.sections as any,
          created_by: userId || null,
        }));
        const { data: seeded, error: seedError } = await supabase
          .from("report_templates")
          .insert(inserts)
          .select("*");
        if (seedError) throw seedError;
        return (seeded || []) as unknown as ReportTemplate[];
      }

      return data as unknown as ReportTemplate[];
    },
  });
}

export function useCreateReportTemplate() {
  return useMutationWithToast({
    mutationFn: async (params: { name: string; description?: string; sections: ReportSection[] }) => {
      const { data: user } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("report_templates")
        .insert({
          name: params.name,
          description: params.description || null,
          sections: params.sections as unknown as any,
          created_by: user?.user?.id || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    invalidateKeys: [["report-templates"]],
    successMessage: "Template saved",
    errorMessage: "Error saving template",
  });
}

export function useUpdateReportTemplate() {
  return useMutationWithToast({
    mutationFn: async (params: { id: string; name?: string; description?: string; sections?: ReportSection[]; is_default?: boolean }) => {
      const update: Record<string, any> = {};
      if (params.name !== undefined) update.name = params.name;
      if (params.description !== undefined) update.description = params.description;
      if (params.sections !== undefined) update.sections = params.sections;
      if (params.is_default !== undefined) {
        // If setting as default, unset others first
        if (params.is_default) {
          await supabase.from("report_templates").update({ is_default: false }).neq("id", params.id);
        }
        update.is_default = params.is_default;
      }
      const { data, error } = await supabase
        .from("report_templates")
        .update(update)
        .eq("id", params.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    invalidateKeys: [["report-templates"]],
    successMessage: "Template updated",
    errorMessage: "Error updating template",
  });
}

export function useDeleteReportTemplate() {
  return useMutationWithToast({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("report_templates").delete().eq("id", id);
      if (error) throw error;
    },
    invalidateKeys: [["report-templates"]],
    successMessage: "Template deleted",
    errorMessage: "Error deleting template",
  });
}
