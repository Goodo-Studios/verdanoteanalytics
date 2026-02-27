import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useMutationWithToast } from "./useMutationWithToast";
import { supabase } from "@/integrations/supabase/client";

export function useReports() {
  return useQuery({ queryKey: ["reports"], queryFn: () => apiFetch("reports") });
}

export function useGenerateReport() {
  return useMutationWithToast({
    mutationFn: (params: { report_name: string; account_id?: string; date_start?: string; date_end?: string }) =>
      apiFetch("reports", "", { method: "POST", body: JSON.stringify(params) }),
    invalidateKeys: [["reports"]],
    successMessage: "Report generated",
    errorMessage: "Error generating report",
  });
}

export function useDeleteReport() {
  return useMutationWithToast({
    mutationFn: (id: string) => apiFetch("reports", id, { method: "DELETE" }),
    invalidateKeys: [["reports"]],
    successMessage: "Report deleted",
    errorMessage: "Error deleting report",
  });
}

export function useSendReportToSlack() {
  return useMutationWithToast({
    mutationFn: (id: string) => apiFetch("reports", `slack/${id}`, { method: "POST" }),
    successMessage: "Report sent to Slack",
    errorMessage: "Error sending to Slack",
  });
}

export function useReportSchedules() {
  return useQuery({
    queryKey: ["report-schedules"],
    queryFn: async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.from("report_schedules").select("*").order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

export function useUpsertReportSchedule() {
  return useMutationWithToast({
    mutationFn: async (schedule: {
      account_id: string; cadence: string; enabled: boolean;
      report_name_template?: string; date_range_days?: number;
      deliver_to_app?: boolean; deliver_to_slack?: boolean;
    }) => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase
        .from("report_schedules")
        .upsert(schedule, { onConflict: "account_id,cadence" })
        .select().single();
      if (error) throw error;
      return data;
    },
    invalidateKeys: [["report-schedules"]],
    successMessage: "Schedule updated",
    errorMessage: "Error updating schedule",
  });
}

export function useUpdateReportSections() {
  return useMutationWithToast({
    mutationFn: async ({ id, sections, report_name }: { id: string; sections: any[]; report_name?: string }) => {
      const update: Record<string, any> = { sections };
      if (report_name) update.report_name = report_name;
      const { data, error } = await supabase.from("reports").update(update).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    invalidateKeys: [["reports"]],
    successMessage: "Report saved",
    errorMessage: "Error saving report",
  });
}
