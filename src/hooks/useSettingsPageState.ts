import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAccounts, useToggleAccount, useRenameAccount, useUploadMappings, useUpdateAccountSettings } from "@/hooks/useAccountsApi";
import { useSync, useRefreshMedia } from "@/hooks/useSyncApi";
import { useAccountContext } from "@/contexts/AccountContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { DEFAULT_CREATIVE_PROMPT, DEFAULT_INSIGHTS_PROMPT } from "@/components/settings/AIContextSection";
import { useSettings, useSaveSettings } from "@/hooks/useSettingsApi";

export function useSettingsPageState() {
  const { isBuilder } = useAuth();
  const { selectedAccountId, selectedAccount, setSelectedAccountId } = useAccountContext();
  const { data: rawAccounts } = useAccounts();
  const accounts = [...(rawAccounts || [])].sort((a: any, b: any) => a.name.localeCompare(b.name));

  const toggleAccount = useToggleAccount();
  const renameAccount = useRenameAccount();
  const uploadMappings = useUploadMappings();
  const updateAccountSettings = useUpdateAccountSettings();
  const sync = useSync();
  const refreshMedia = useRefreshMedia();
  const queryClient = useQueryClient();
  const { data: globalSettings } = useSettings();
  const saveSettings = useSaveSettings();

  // Modal state
  const [renamingAccount, setRenamingAccount] = useState<{ id: string; name: string } | null>(null);
  const [showCsvModal, setShowCsvModal] = useState<string | null>(null);
  const [csvPreview, setCsvPreview] = useState<any[]>([]);
  const [csvMappings, setCsvMappings] = useState<any[]>([]);
  

  const account = selectedAccountId === "all"
    ? null
    : (accounts || []).find((a: any) => a.id === selectedAccountId);

  // Form state
  const [dateRange, setDateRange] = useState("");
  const [roasThreshold, setRoasThreshold] = useState("");
  const [spendThreshold, setSpendThreshold] = useState("");
  const [winnerKpi, setWinnerKpi] = useState("roas");
  const [winnerKpiDirection, setWinnerKpiDirection] = useState("gte");
  const [winnerKpiThreshold, setWinnerKpiThreshold] = useState("2.0");
  const [scaleThreshold, setScaleThreshold] = useState("2.0");
  const [killThreshold, setKillThreshold] = useState("1.0");
  const [killScaleKpi, setKillScaleKpi] = useState("roas");
  const [killScaleKpiDirection, setKillScaleKpiDirection] = useState("gte");
  const [primaryKpi, setPrimaryKpi] = useState("");
  const [secondaryKpis, setSecondaryKpis] = useState("");
  const [companyPdfUrl, setCompanyPdfUrl] = useState<string | null>(null);
  const [creativePrompt, setCreativePrompt] = useState("");
  const [insightsPrompt, setInsightsPrompt] = useState("");
  const [initialized, setInitialized] = useState<string | null>(null);
  const [targetRoas, setTargetRoas] = useState("");
  const [targetCpa, setTargetCpa] = useState("");
  const [targetMonthlySpend, setTargetMonthlySpend] = useState("");
  // Global cooldown setting (from settings table, not per-account)
  const [syncCooldownMinutes, setSyncCooldownMinutes] = useState(() => {
    if (!globalSettings) return "0";
    const row = (globalSettings as any[]).find?.((r: any) => r.key === "sync_cooldown_minutes");
    return row?.value ?? "0";
  });

  // Sync form state when account changes
  if (account && initialized !== account.id) {
    setDateRange(String(account.date_range_days || 30));
    setRoasThreshold(String(account.winner_roas_threshold || 2.0));
    setSpendThreshold(String(account.iteration_spend_threshold || 50));
    setWinnerKpi(account.winner_kpi || "roas");
    setWinnerKpiDirection(account.winner_kpi_direction || "gte");
    setWinnerKpiThreshold(String(account.winner_kpi_threshold ?? account.winner_roas_threshold ?? 2.0));
    setScaleThreshold(String(account.scale_threshold ?? 2.0));
    setKillThreshold(String(account.kill_threshold ?? 1.0));
    setKillScaleKpi((account as any).kill_scale_kpi || "roas");
    setKillScaleKpiDirection((account as any).kill_scale_kpi_direction || "gte");
    setPrimaryKpi(account.primary_kpi || "Purchase ROAS > 1.5x");
    setSecondaryKpis(account.secondary_kpis || "CTR, Hook Rate, Volume");
    setCompanyPdfUrl((account as any).company_pdf_url || null);
    setCreativePrompt((account as any).creative_analysis_prompt || DEFAULT_CREATIVE_PROMPT);
    setInsightsPrompt((account as any).insights_prompt || DEFAULT_INSIGHTS_PROMPT);
    setTargetRoas((account as any).target_roas != null ? String((account as any).target_roas) : "");
    setTargetCpa((account as any).target_cpa != null ? String((account as any).target_cpa) : "");
    setTargetMonthlySpend((account as any).target_monthly_spend != null ? String((account as any).target_monthly_spend) : "");
    setInitialized(account.id);
  }

  const handleSaveCooldown = useCallback(() => {
    saveSettings.mutate({ sync_cooldown_minutes: syncCooldownMinutes });
  }, [syncCooldownMinutes, saveSettings]);

  const handleSave = useCallback(() => {
    if (!account) return;
    updateAccountSettings.mutate({
      id: account.id,
      date_range_days: parseInt(dateRange) || 30,
      winner_roas_threshold: parseFloat(roasThreshold) || 2.0,
      iteration_spend_threshold: parseFloat(spendThreshold) || 50,
      winner_kpi: winnerKpi,
      winner_kpi_direction: winnerKpiDirection,
      winner_kpi_threshold: parseFloat(winnerKpiThreshold) || 2.0,
      scale_threshold: parseFloat(scaleThreshold) || 2.0,
      kill_threshold: parseFloat(killThreshold) || 1.0,
      kill_scale_kpi: killScaleKpi,
      kill_scale_kpi_direction: killScaleKpiDirection,
      primary_kpi: primaryKpi || null,
      secondary_kpis: secondaryKpis || null,
      creative_analysis_prompt: creativePrompt === DEFAULT_CREATIVE_PROMPT ? null : creativePrompt || null,
      insights_prompt: insightsPrompt === DEFAULT_INSIGHTS_PROMPT ? null : insightsPrompt || null,
      target_roas: targetRoas ? parseFloat(targetRoas) : null,
      target_cpa: targetCpa ? parseFloat(targetCpa) : null,
      target_monthly_spend: targetMonthlySpend ? parseFloat(targetMonthlySpend) : null,
    });
  }, [account, dateRange, roasThreshold, spendThreshold, winnerKpi, winnerKpiDirection, winnerKpiThreshold, scaleThreshold, killThreshold, killScaleKpi, killScaleKpiDirection, primaryKpi, secondaryKpis, creativePrompt, insightsPrompt, targetRoas, targetCpa, targetMonthlySpend, updateAccountSettings]);

  const handleApplyToAll = useCallback(() => {
    (accounts || []).forEach((acc: any) => {
      updateAccountSettings.mutate({
        id: acc.id,
        date_range_days: parseInt(dateRange) || 30,
        winner_roas_threshold: parseFloat(roasThreshold) || 2.0,
        iteration_spend_threshold: parseFloat(spendThreshold) || 50,
      });
    });
  }, [accounts, dateRange, roasThreshold, spendThreshold, updateAccountSettings]);

  const [applyingPrompts, setApplyingPrompts] = useState(false);
  const [applyProgress, setApplyProgress] = useState({ current: 0, total: 0 });

  const handleApplyPromptsToAll = useCallback(async () => {
    const allAccounts = (accounts || []) as any[];
    const promptValues: Record<string, string | null> = {
      creative_analysis_prompt: creativePrompt === DEFAULT_CREATIVE_PROMPT ? null : creativePrompt || null,
      insights_prompt: insightsPrompt === DEFAULT_INSIGHTS_PROMPT ? null : insightsPrompt || null,
    };
    setApplyingPrompts(true);
    setApplyProgress({ current: 0, total: allAccounts.length });
    try {
      const ids = allAccounts.map((a: any) => a.id);
      const { error } = await supabase.from("ad_accounts").update(promptValues).in("id", ids);
      if (error) throw error;
      setApplyProgress({ current: allAccounts.length, total: allAccounts.length });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast.success(`Prompts applied to all ${allAccounts.length} accounts`);
    } catch (e: any) {
      toast.error("Failed to apply prompts", { description: e.message });
    } finally {
      setApplyingPrompts(false);
    }
  }, [accounts, creativePrompt, insightsPrompt, queryClient]);

  const handleCsvUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split("\n").filter((l) => l.trim());
      if (lines.length < 2) { toast.error("Invalid CSV — file must have headers and at least one row."); return; }
      const headers = lines[0].split(",").map((h) => h.trim());
      const required = ["UniqueCode", "Type", "Person", "Style", "Product", "Hook", "Theme"];
      const missing = required.filter((r) => !headers.includes(r));
      if (missing.length > 0) { toast.error(`Missing columns: ${missing.join(", ")}`); return; }
      const rows = lines.slice(1).map((line) => {
        const values = line.split(",").map((v) => v.trim());
        const row: Record<string, string> = {};
        headers.forEach((h, i) => { row[h] = values[i] || ""; });
        return row;
      });
      setCsvPreview(rows.slice(0, 5));
      setCsvMappings(rows);
    };
    reader.readAsText(file);
  }, []);

  const handleConfirmCsvUpload = useCallback(async () => {
    if (!showCsvModal || csvMappings.length === 0) return;
    await uploadMappings.mutateAsync({ accountId: showCsvModal, mappings: csvMappings });
    setShowCsvModal(null);
    setCsvPreview([]);
    setCsvMappings([]);
  }, [showCsvModal, csvMappings, uploadMappings]);

  return {
    isBuilder, accounts, account, selectedAccountId, setSelectedAccountId,
    // Mutations
    toggleAccount, renameAccount, sync, refreshMedia, updateAccountSettings, uploadMappings,
    // Modal state
    renamingAccount, setRenamingAccount,
    showCsvModal, setShowCsvModal, csvPreview, setCsvPreview, csvMappings, setCsvMappings,
    // Form state
    dateRange, setDateRange, roasThreshold, setRoasThreshold, spendThreshold, setSpendThreshold,
    winnerKpi, setWinnerKpi, winnerKpiDirection, setWinnerKpiDirection,
    winnerKpiThreshold, setWinnerKpiThreshold,
    killScaleKpi, setKillScaleKpi, killScaleKpiDirection, setKillScaleKpiDirection,
    scaleThreshold, setScaleThreshold, killThreshold, setKillThreshold,
    primaryKpi, setPrimaryKpi, secondaryKpis, setSecondaryKpis,
    companyPdfUrl, setCompanyPdfUrl,
    creativePrompt, setCreativePrompt, insightsPrompt, setInsightsPrompt,
    syncCooldownMinutes, setSyncCooldownMinutes,
    targetRoas, setTargetRoas, targetCpa, setTargetCpa, targetMonthlySpend, setTargetMonthlySpend,
    // Handlers
    handleSave, handleApplyToAll, handleSaveCooldown,
    applyingPrompts, applyProgress, handleApplyPromptsToAll,
    handleCsvUpload, handleConfirmCsvUpload,
  };
}
