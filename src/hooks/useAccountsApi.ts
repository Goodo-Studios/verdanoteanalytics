import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useMutationWithToast } from "./useMutationWithToast";
import type { Account } from "@/types/account";

export function useAccounts(userId?: string | null) {
  return useQuery<Account[]>({
    queryKey: ["accounts", userId ?? "all"],
    queryFn: () => apiFetch("accounts"),
    enabled: userId != null, // != null catches both null and undefined (pre-auth render)
    staleTime: 5 * 60 * 1000, // accounts rarely change; don't re-trigger account selection logic
  });
}

export function useAddAccount() {
  return useMutationWithToast({
    mutationFn: (account: { id: string; name: string }) =>
      apiFetch("accounts", "", { method: "POST", body: JSON.stringify(account) }),
    invalidateKeys: [["accounts"]],
    successMessage: "Account added",
    errorMessage: "Error adding account",
  });
}

export function useToggleAccount() {
  return useMutationWithToast({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      apiFetch("accounts", id, { method: "PUT", body: JSON.stringify({ is_active }) }),
    invalidateKeys: [["accounts"]],
  });
}

export function useRenameAccount() {
  return useMutationWithToast({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { error } = await supabase.from("ad_accounts").update({ name }).eq("id", id);
      if (error) throw error;
    },
    invalidateKeys: [["accounts"]],
    successMessage: "Account renamed",
    errorMessage: "Error renaming account",
  });
}

export function useUpdateAccountSettings() {
  return useMutationWithToast({
    mutationFn: ({ id, ...settings }: { id: string; date_range_days?: number; winner_roas_threshold?: number; iteration_spend_threshold?: number; winner_kpi?: string; winner_kpi_direction?: string; winner_kpi_threshold?: number; scale_threshold?: number; kill_threshold?: number; kill_scale_kpi?: string; kill_scale_kpi_direction?: string; company_description?: string | null; primary_kpi?: string | null; secondary_kpis?: string | null; company_pdf_url?: string | null; creative_analysis_prompt?: string | null; insights_prompt?: string | null; report_schedule?: string; target_roas?: number | null; target_cpa?: number | null; target_monthly_spend?: number | null; client_responsiveness?: string; client_start_date?: string | null; tiktok_advertiser_id?: string | null; tiktok_access_token?: string | null; click_window?: number; view_window?: number; attribution_model?: string; attribution_notes?: string | null; industry_category?: string | null; optimization_goal?: string }) =>
      apiFetch("accounts", id, { method: "PUT", body: JSON.stringify(settings) }),
    invalidateKeys: [["accounts"]],
    successMessage: "Account settings saved",
    errorMessage: "Error saving account settings",
  });
}

export function useDeleteAccount() {
  return useMutationWithToast({
    mutationFn: (id: string) => apiFetch("accounts", id, { method: "DELETE" }),
    invalidateKeys: [["accounts"]],
    successMessage: "Account removed",
    errorMessage: "Error removing account",
  });
}

export function useUploadMappings() {
  return useMutationWithToast({
    mutationFn: ({ accountId, mappings }: { accountId: string; mappings: any[] }) =>
      apiFetch("accounts", `${accountId}/name-mappings`, { method: "POST", body: JSON.stringify({ mappings }) }),
    invalidateKeys: [["accounts"]],
    successMessage: "Mappings uploaded",
    successDescription: (data: any) => `Matched ${data.matched} creatives, ${data.unmatchedCodes} codes pending.`,
    errorMessage: "Upload error",
  });
}
