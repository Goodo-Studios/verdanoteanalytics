import { useState, useEffect } from "react";
import { AppLayout } from "@/components/AppLayout";

import { SyncStatusBanner } from "@/components/SyncStatusBanner";
import { MediaRefreshBanner } from "@/components/MediaRefreshBanner";
import { PageHeader } from "@/components/PageHeader";
import { AccountOverviewSection } from "@/components/settings/AccountOverviewSection";
import { SyncSettingsSection } from "@/components/settings/SyncSettingsSection";
import { SyncScheduleSection } from "@/components/settings/SyncScheduleSection";
import { SyncHistorySection } from "@/components/settings/SyncHistorySection";
import { RenameAccountModal } from "@/components/settings/RenameAccountModal";
import { CsvUploadModal } from "@/components/settings/CsvUploadModal";
import { AIBriefModal } from "@/components/settings/AIBriefModal";
import { WeeklyRetroModal } from "@/components/settings/WeeklyRetroModal";
import { DataHealthSection } from "@/components/settings/DataHealthSection";
import { DataExportSection } from "@/components/settings/DataExportSection";

import { ClientHealthSection } from "@/components/settings/ClientHealthSection";
import { ApiKeysSection } from "@/components/settings/ApiKeysSection";


import { AttributionSection } from "@/components/settings/AttributionSection";
import { AccountSetupChecklist, useAccountNeedsOnboarding } from "@/components/settings/AccountSetupChecklist";
import { OnboardingChecklistModal } from "@/components/settings/OnboardingChecklistModal";

import { TransitionTab } from "@/components/settings/TransitionTab";
import { NamingConventionSection } from "@/components/settings/NamingConventionSection";
import { useSettingsPageState } from "@/hooks/useSettingsPageState";
import { useIsSyncing } from "@/hooks/useIsSyncing";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

type SettingsTab = "setup" | "account" | "naming" | "export" | "api" | "transition";

const SettingsPage = () => {
  const s = useSettingsPageState();
  const isSyncing = useIsSyncing();
  const { isBuilder, isEmployee } = useAuth();
  const canBrief = isBuilder || isEmployee;
  const [showBriefModal, setShowBriefModal] = useState(false);
  const [showRetroModal, setShowRetroModal] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("account");
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);

  const needsOnboarding = useAccountNeedsOnboarding(s.account);

  // Auto-show onboarding modal for new accounts
  useEffect(() => {
    if (needsOnboarding && s.account) {
      const dismissKey = `onboarding_dismissed_${s.account.id}`;
      if (!sessionStorage.getItem(dismissKey)) {
        setShowOnboardingModal(true);
        sessionStorage.setItem(dismissKey, "1");
      }
    }
  }, [needsOnboarding, s.account]);

  const tabBar = (
    <div className="flex gap-1 mb-6 border-b border-border-light overflow-x-auto">
      <TabButton active={activeTab === "setup"} onClick={() => setActiveTab("setup")}>Account Setup</TabButton>
      <TabButton active={activeTab === "account"} onClick={() => setActiveTab("account")}>Account</TabButton>
      
      
      {isBuilder && <TabButton active={activeTab === "naming"} onClick={() => setActiveTab("naming")}>Naming</TabButton>}
      <TabButton active={activeTab === "export"} onClick={() => setActiveTab("export")}>Export</TabButton>
      <TabButton active={activeTab === "api"} onClick={() => setActiveTab("api")}>API Access</TabButton>
      
      {isBuilder && <TabButton active={activeTab === "transition"} onClick={() => setActiveTab("transition")}>Transition</TabButton>}
    </div>
  );

  // No account selected
  if (!s.account) {
    if (s.accounts.length > 0) {
      return (
        <AppLayout>
          <PageHeader title="Account Settings" description="Select a specific ad account from the sidebar to view its settings." />
          {isBuilder && tabBar}
          {activeTab === "account" || activeTab === "setup" ? (
            <>
              <div className="max-w-2xl">
                <div className="glass-panel p-6 space-y-4">
                  <p className="font-body text-[13px] text-slate mb-3">Select an account to configure its settings:</p>
                  <div className="space-y-2">
                    {s.accounts.map((acc: any) => (
                      <button key={acc.id} onClick={() => s.setSelectedAccountId(acc.id)}
                        className="w-full flex items-center justify-between p-3 rounded-md border border-border hover:bg-accent transition-colors text-left">
                        <div>
                          <div className="font-body text-[14px] font-medium text-charcoal">{acc.name}</div>
                          <div className="font-data text-[12px] text-sage">{acc.creative_count} creatives</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {isBuilder && (
                <div className="max-w-4xl mt-8">
                  <DataHealthSection />
                </div>
              )}
            </>
          ) : activeTab === "api" ? (
            <div className="max-w-2xl"><ApiKeysSection /></div>
          ) : (
            <div className="max-w-3xl"><DataExportSection /></div>
          )}
        </AppLayout>
      );
    }
    return (
      <AppLayout>
        <PageHeader title="Account Settings" description="No ad accounts configured yet." />
        <div className="max-w-2xl">
          <div className="glass-panel p-8 flex flex-col items-center justify-center text-center">
            <p className="font-body text-[13px] text-slate">Add ad accounts in User Settings → Admin to get started.</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex items-start justify-between mb-2">
        <div>
          <h1 className="font-heading text-[32px] text-forest">{s.account.name} — Settings</h1>
          <p className="font-body text-[13px] text-slate font-light mt-1">Configure sync preferences for this account.</p>
        </div>
      </div>

      {(isBuilder || isEmployee) && tabBar}

      <SyncStatusBanner />
      <MediaRefreshBanner />

      {activeTab === "setup" ? (
        <AccountSetupChecklist account={s.account} onSwitchTab={(tab) => setActiveTab(tab as SettingsTab)} />
      ) : activeTab === "account" ? (
        <div className="max-w-2xl space-y-8">
          <AccountOverviewSection
            account={s.account}
            onRename={() => s.setRenamingAccount({ id: s.account!.id, name: s.account!.name })}
            onSync={() => s.sync.mutate({ account_id: s.account!.id })}
            syncPending={s.sync.isPending || isSyncing}
            onUploadCsv={() => { s.setShowCsvModal(s.account!.id); s.setCsvPreview([]); s.setCsvMappings([]); }}
            onToggle={(checked) => s.toggleAccount.mutate({ id: s.account!.id, is_active: checked })}
            onRefreshMedia={() => s.refreshMedia.mutate({ account_id: s.account!.id })}
            refreshMediaPending={s.refreshMedia.isPending}
            onAIBrief={() => setShowBriefModal(true)}
            showAIBrief={canBrief}
            onWeeklyRetro={() => setShowRetroModal(true)}
            showWeeklyRetro={canBrief}
          />
          <SyncSettingsSection
            dateRange={s.dateRange} setDateRange={s.setDateRange}
            roasThreshold={s.roasThreshold} setRoasThreshold={s.setRoasThreshold}
            spendThreshold={s.spendThreshold} setSpendThreshold={s.setSpendThreshold}
            winnerKpi={s.winnerKpi} setWinnerKpi={s.setWinnerKpi}
            winnerKpiDirection={s.winnerKpiDirection} setWinnerKpiDirection={s.setWinnerKpiDirection}
            winnerKpiThreshold={s.winnerKpiThreshold} setWinnerKpiThreshold={s.setWinnerKpiThreshold}
            killScaleKpi={s.killScaleKpi} setKillScaleKpi={s.setKillScaleKpi}
            killScaleKpiDirection={s.killScaleKpiDirection} setKillScaleKpiDirection={s.setKillScaleKpiDirection}
            scaleThreshold={s.scaleThreshold} setScaleThreshold={s.setScaleThreshold}
            killThreshold={s.killThreshold} setKillThreshold={s.setKillThreshold}
            syncCooldownMinutes={s.syncCooldownMinutes} setSyncCooldownMinutes={s.setSyncCooldownMinutes}
            onSaveCooldown={s.handleSaveCooldown}
            onSave={s.handleSave} onApplyToAll={s.handleApplyToAll}
            saving={s.updateAccountSettings.isPending} showApplyAll={s.accounts.length > 1}
            targetRoas={s.targetRoas} setTargetRoas={s.setTargetRoas}
            targetCpa={s.targetCpa} setTargetCpa={s.setTargetCpa}
            targetMonthlySpend={s.targetMonthlySpend} setTargetMonthlySpend={s.setTargetMonthlySpend}
          />
          <SyncScheduleSection
            accounts={s.accounts}
            onSyncAll={() => { s.accounts.forEach((acc: any) => { s.sync.mutate({ account_id: acc.id }); }); }}
            isSyncing={s.sync.isPending || isSyncing}
          />
          <SyncHistorySection accountId={s.account.id} />
          {(isBuilder || isEmployee) && <AttributionSection account={s.account} />}
          {(isBuilder || isEmployee) && <ClientHealthSection account={s.account} />}
        </div>
      ) : activeTab === "naming" ? (
        <NamingConventionSection />
      ) : activeTab === "api" ? (
        <div className="max-w-2xl"><ApiKeysSection /></div>
      ) : activeTab === "transition" ? (
        <TransitionTab account={s.account} />
      ) : (
        <div className="max-w-3xl"><DataExportSection /></div>
      )}

      <RenameAccountModal
        account={s.renamingAccount}
        onClose={() => s.setRenamingAccount(null)}
        onRename={(params) => s.renameAccount.mutate(params)}
        onChange={s.setRenamingAccount}
        isPending={s.renameAccount.isPending}
      />
      <CsvUploadModal
        open={!!s.showCsvModal}
        onClose={() => { s.setShowCsvModal(null); s.setCsvPreview([]); s.setCsvMappings([]); }}
        csvPreview={s.csvPreview}
        csvMappings={s.csvMappings}
        onFileChange={s.handleCsvUpload}
        onConfirm={s.handleConfirmCsvUpload}
        isPending={s.uploadMappings.isPending}
      />
      <AIBriefModal open={showBriefModal} onClose={() => setShowBriefModal(false)} account={s.account} />
      <WeeklyRetroModal open={showRetroModal} onClose={() => setShowRetroModal(false)} account={s.account} />
      <OnboardingChecklistModal
        open={showOnboardingModal}
        onClose={() => setShowOnboardingModal(false)}
        account={s.account}
        onSwitchTab={(tab) => setActiveTab(tab as SettingsTab)}
      />
    </AppLayout>
  );
};

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "font-body text-[13px] font-medium px-4 py-2.5 border-b-2 transition-colors -mb-px whitespace-nowrap",
        active
          ? "border-verdant text-forest"
          : "border-transparent text-muted-foreground hover:text-foreground hover:border-border-light",
      )}
    >
      {children}
    </button>
  );
}

export default SettingsPage;
