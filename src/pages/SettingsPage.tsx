import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { SyncStatusBanner } from "@/components/SyncStatusBanner";
import { MediaRefreshBanner } from "@/components/MediaRefreshBanner";
import { Loader2, User, Settings as SettingsIcon, Shield, FileOutput, Tags, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Profile / User sections
import { ProfileInfoSection } from "@/components/user-settings/ProfileInfoSection";
import { ChangePasswordSection } from "@/components/user-settings/ChangePasswordSection";
import { MetaConnectionSection } from "@/components/user-settings/MetaConnectionSection";
import { AdAccountsSection } from "@/components/user-settings/AdAccountsSection";
import { UserManagementSection } from "@/components/user-settings/UserManagementSection";
import { AddAccountModal } from "@/components/user-settings/AddAccountModal";
import { CreateUserModal } from "@/components/user-settings/CreateUserModal";
import { ConfirmDeleteDialog } from "@/components/user-settings/ConfirmDeleteDialog";

// Account settings sections
import { AccountOverviewSection } from "@/components/settings/AccountOverviewSection";
import { SyncSettingsSection } from "@/components/settings/SyncSettingsSection";
import { SyncScheduleSection } from "@/components/settings/SyncScheduleSection";
import { SyncHistorySection } from "@/components/settings/SyncHistorySection";
import { RenameAccountModal } from "@/components/settings/RenameAccountModal";
import { CsvUploadModal } from "@/components/settings/CsvUploadModal";
import { DataHealthSection } from "@/components/settings/DataHealthSection";
import { SpendDiagnosticSection } from "@/components/settings/SpendDiagnosticSection";
import { DataExportSection } from "@/components/settings/DataExportSection";
import { NamingConventionSection } from "@/components/settings/NamingConventionSection";
import { ApiKeysSection } from "@/components/settings/ApiKeysSection";

import { useUserSettingsPageState } from "@/hooks/useUserSettingsPageState";
import { useSettingsPageState } from "@/hooks/useSettingsPageState";
import { useIsSyncing } from "@/hooks/useIsSyncing";
import { useAuth } from "@/contexts/AuthContext";
import { useClientPreview } from "@/hooks/useClientPreviewMode";

type Tab = "profile" | "account" | "naming" | "export" | "admin";

const SettingsPage = () => {
  const userState = useUserSettingsPageState();
  const accountState = useSettingsPageState();
  const isSyncing = useIsSyncing();
  const { isBuilder: realBuilder, isEmployee: realEmployee, isClient: realClient } = useAuth();
  const { isClientPreview, isEmployeePreview } = useClientPreview();

  // Derive effective role flags accounting for preview mode
  const effectiveIsClient = realClient || isClientPreview;
  const effectiveIsEmployee = (realEmployee || isEmployeePreview) && !isClientPreview;
  const effectiveIsBuilder = realBuilder && !isClientPreview && !isEmployeePreview;

  const [activeTab, setActiveTab] = useState<Tab>("profile");

  // Build tabs based on effective role
  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "profile", label: "Profile", icon: <User className="h-3.5 w-3.5" /> },
  ];

  if (effectiveIsBuilder || effectiveIsEmployee) {
    tabs.push({ key: "account", label: "Account", icon: <SettingsIcon className="h-3.5 w-3.5" /> });
  }
  if (effectiveIsBuilder) {
    tabs.push({ key: "naming", label: "Naming", icon: <Tags className="h-3.5 w-3.5" /> });
  }
  if (effectiveIsBuilder || effectiveIsEmployee) {
    tabs.push({ key: "export", label: "Export", icon: <FileOutput className="h-3.5 w-3.5" /> });
  }
  if (effectiveIsBuilder) {
    tabs.push({ key: "admin", label: "Admin", icon: <Shield className="h-3.5 w-3.5" /> });
  }

  if (userState.loadingProfile) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-heading text-[32px] text-forest">Settings</h1>
          <p className="font-body text-[13px] text-slate font-light mt-1">
            {effectiveIsClient
              ? "Manage your profile and security."
              : "Manage your profile, account configuration, and admin preferences."}
          </p>
        </div>
      </div>

      {!effectiveIsClient && <SyncStatusBanner />}
      {!effectiveIsClient && <MediaRefreshBanner />}

      {/* Tab bar - only show if multiple tabs */}
      {tabs.length > 1 && (
        <div className="flex gap-1 mb-6 border-b border-border-light overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={cn(
                "flex items-center gap-1.5 font-body text-[13px] font-medium px-4 py-2.5 border-b-2 transition-colors -mb-px whitespace-nowrap",
                activeTab === t.key
                  ? "border-verdant text-forest"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border-light",
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Profile Tab */}
      {activeTab === "profile" && (
        <div className="max-w-2xl space-y-8">
          <ProfileInfoSection
            email={userState.email}
            displayName={userState.displayName}
            setDisplayName={userState.setDisplayName}
            role={userState.role}
            savingProfile={userState.savingProfile}
            onSave={userState.handleSaveProfile}
          />
          <ChangePasswordSection
            newPassword={userState.newPassword}
            setNewPassword={userState.setNewPassword}
            confirmPassword={userState.confirmPassword}
            setConfirmPassword={userState.setConfirmPassword}
            savingPassword={userState.savingPassword}
            onChangePassword={userState.handleChangePassword}
          />
          {effectiveIsBuilder && <AgencyHomeToggle />}
        </div>
      )}

      {/* Account Tab */}
      {activeTab === "account" && (effectiveIsBuilder || effectiveIsEmployee) && (
        <div className="max-w-2xl space-y-8">
          {!accountState.account ? (
            <>
              {accountState.accounts.length > 0 ? (
                <>
                  <div className="glass-panel p-6 space-y-4">
                    <p className="font-body text-[13px] text-slate mb-3">Select an account to configure its settings:</p>
                    <div className="space-y-2">
                      {accountState.accounts.map((acc: any) => (
                        <button key={acc.id} onClick={() => accountState.setSelectedAccountId(acc.id)}
                          className="w-full flex items-center justify-between p-3 rounded-md border border-border hover:bg-accent transition-colors text-left">
                          <div>
                            <div className="font-body text-[14px] font-medium text-charcoal">{acc.name}</div>
                            <div className="font-data text-[12px] text-sage">{acc.creative_count} creatives</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                  {effectiveIsBuilder && (
                    <div className="max-w-4xl space-y-8">
                      <SpendDiagnosticSection />
                      <DataHealthSection />
                    </div>
                  )}
                </>
              ) : (
                <div className="glass-panel p-8 flex flex-col items-center justify-center text-center">
                  <p className="font-body text-[13px] text-slate">Add ad accounts in the Admin tab to get started.</p>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="mb-4">
                <h2 className="font-heading text-[20px] text-forest">{accountState.account.name}</h2>
                <p className="font-body text-[12px] text-slate">Configure sync preferences for this account.</p>
              </div>
              <AccountOverviewSection
                account={accountState.account}
                onRename={() => accountState.setRenamingAccount({ id: accountState.account!.id, name: accountState.account!.name })}
                onSync={() => accountState.sync.mutate({ account_id: accountState.account!.id })}
                syncPending={accountState.sync.isPending || isSyncing}
                onUploadCsv={() => { accountState.setShowCsvModal(accountState.account!.id); accountState.setCsvPreview([]); accountState.setCsvMappings([]); }}
                onToggle={(checked) => accountState.toggleAccount.mutate({ id: accountState.account!.id, is_active: checked })}
                onRefreshMedia={() => accountState.refreshMedia.mutate({ account_id: accountState.account!.id })}
                refreshMediaPending={accountState.refreshMedia.isPending}
              />
              <SyncSettingsSection
                dateRange={accountState.dateRange} setDateRange={accountState.setDateRange}
                roasThreshold={accountState.roasThreshold} setRoasThreshold={accountState.setRoasThreshold}
                spendThreshold={accountState.spendThreshold} setSpendThreshold={accountState.setSpendThreshold}
                winnerKpi={accountState.winnerKpi} setWinnerKpi={accountState.setWinnerKpi}
                winnerKpiDirection={accountState.winnerKpiDirection} setWinnerKpiDirection={accountState.setWinnerKpiDirection}
                winnerKpiThreshold={accountState.winnerKpiThreshold} setWinnerKpiThreshold={accountState.setWinnerKpiThreshold}
                killScaleKpi={accountState.killScaleKpi} setKillScaleKpi={accountState.setKillScaleKpi}
                killScaleKpiDirection={accountState.killScaleKpiDirection} setKillScaleKpiDirection={accountState.setKillScaleKpiDirection}
                scaleThreshold={accountState.scaleThreshold} setScaleThreshold={accountState.setScaleThreshold}
                killThreshold={accountState.killThreshold} setKillThreshold={accountState.setKillThreshold}
                syncCooldownMinutes={accountState.syncCooldownMinutes} setSyncCooldownMinutes={accountState.setSyncCooldownMinutes}
                onSaveCooldown={accountState.handleSaveCooldown}
                onSave={accountState.handleSave} onApplyToAll={accountState.handleApplyToAll}
                saving={accountState.updateAccountSettings.isPending} showApplyAll={accountState.accounts.length > 1}
                targetRoas={accountState.targetRoas} setTargetRoas={accountState.setTargetRoas}
                targetCpa={accountState.targetCpa} setTargetCpa={accountState.setTargetCpa}
                targetMonthlySpend={accountState.targetMonthlySpend} setTargetMonthlySpend={accountState.setTargetMonthlySpend}
              />
              <SyncHistorySection accountId={accountState.account.id} />
            </>
          )}
        </div>
      )}

      {/* Naming Tab */}
      {activeTab === "naming" && isBuilder && (
        <NamingConventionSection />
      )}

      {/* Export Tab */}
      {activeTab === "export" && (
        <div className="max-w-3xl">
          <DataExportSection />
        </div>
      )}

      {/* Admin Tab */}
      {activeTab === "admin" && isBuilder && (
        <div className="max-w-2xl space-y-8">
          <MetaConnectionSection metaStatus={userState.metaStatus} metaUser={userState.metaUser} onTestConnection={userState.handleTestConnection} />
          <AdAccountsSection
            accounts={userState.accounts}
            syncPending={userState.sync.isPending || isSyncing}
            onSyncAll={() => userState.sync.mutate({ account_id: "all" })}
            onRefreshAllMedia={() => userState.refreshMedia.mutate(undefined)}
            refreshAllMediaPending={userState.refreshMedia.isPending}
            onOpenAddModal={userState.handleOpenAddModal}
            onRename={userState.setRenamingAccount}
            onDelete={userState.setShowDeleteConfirm}
          />
          <UserManagementSection
            users={userState.users}
            accounts={userState.accounts}
            onCreateUser={() => userState.setShowCreateUser(true)}
            onDeleteUser={userState.setShowDeleteUserConfirm}
          />
          <SyncScheduleSection
            accounts={accountState.accounts}
            onSyncAll={() => { accountState.accounts.forEach((acc: any) => { accountState.sync.mutate({ account_id: acc.id }); }); }}
            onSyncAccount={(accountId) => { accountState.sync.mutate({ account_id: accountId }); }}
            isSyncing={accountState.sync.isPending || isSyncing}
          />
          <SyncHistorySection />
          <div className="border-t border-border pt-8">
            <ApiKeysSection />
          </div>
        </div>
      )}

      {/* Modals from account settings */}
      <RenameAccountModal
        account={accountState.renamingAccount}
        onClose={() => accountState.setRenamingAccount(null)}
        onRename={(params) => accountState.renameAccount.mutate(params)}
        onChange={accountState.setRenamingAccount}
        isPending={accountState.renameAccount.isPending}
      />
      <CsvUploadModal
        open={!!accountState.showCsvModal}
        onClose={() => { accountState.setShowCsvModal(null); accountState.setCsvPreview([]); accountState.setCsvMappings([]); }}
        csvPreview={accountState.csvPreview}
        csvMappings={accountState.csvMappings}
        onFileChange={accountState.handleCsvUpload}
        onConfirm={accountState.handleConfirmCsvUpload}
        isPending={accountState.uploadMappings.isPending}
      />

      {/* Modals from admin/user settings */}
      <AddAccountModal
        open={userState.showAddModal} onOpenChange={userState.setShowAddModal}
        loading={userState.loadingAccounts} availableAccounts={userState.availableAccounts}
        existingIds={userState.existingIds} onAdd={userState.handleAddAccount} addPending={userState.addAccount.isPending}
      />
      <RenameAccountModal
        account={userState.renamingAccount} onClose={() => userState.setRenamingAccount(null)}
        onRename={(params) => userState.renameAccount.mutate(params, { onSuccess: () => userState.setRenamingAccount(null) })}
        onChange={userState.setRenamingAccount} isPending={userState.renameAccount.isPending}
      />
      <ConfirmDeleteDialog
        open={!!userState.showDeleteConfirm} onOpenChange={() => userState.setShowDeleteConfirm(null)}
        title="Remove Account"
        description="This will remove the account and all its creatives and name mappings. This action cannot be undone."
        actionLabel="Remove Account"
        onConfirm={() => { if (userState.showDeleteConfirm) userState.deleteAccount.mutate(userState.showDeleteConfirm); userState.setShowDeleteConfirm(null); }}
      />
      <CreateUserModal
        open={userState.showCreateUser} onOpenChange={userState.setShowCreateUser}
        email={userState.newUserEmail} setEmail={userState.setNewUserEmail}
        password={userState.newUserPassword} setPassword={userState.setNewUserPassword}
        name={userState.newUserName} setName={userState.setNewUserName}
        role={userState.newUserRole} setRole={userState.setNewUserRole}
        accountIds={userState.newUserAccountIds} setAccountIds={userState.setNewUserAccountIds}
        accounts={userState.accounts} onSubmit={userState.handleCreateUser} isPending={userState.createUser.isPending}
      />
      <ConfirmDeleteDialog
        open={!!userState.showDeleteUserConfirm} onOpenChange={() => userState.setShowDeleteUserConfirm(null)}
        title="Delete User"
        description="This will permanently delete this user account. This action cannot be undone."
        actionLabel="Delete User"
        onConfirm={() => { if (userState.showDeleteUserConfirm) userState.deleteUser.mutate(userState.showDeleteUserConfirm); userState.setShowDeleteUserConfirm(null); }}
      />
    </AppLayout>
  );
};

function AgencyHomeToggle() {
  const [enabled, setEnabled] = useState(() => localStorage.getItem("verdanote_agency_default_home") === "true");

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    localStorage.setItem("verdanote_agency_default_home", String(next));
  };

  return (
    <div className="border-t border-border pt-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="font-body text-[14px] font-medium text-foreground">Agency Dashboard as Home</p>
            <p className="font-body text-[12px] text-muted-foreground">Use the agency view as your default landing page</p>
          </div>
        </div>
        <button
          onClick={toggle}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? "bg-primary" : "bg-muted"}`}
        >
          <span className={`inline-block h-4 w-4 rounded-full bg-card shadow transition-transform ${enabled ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>
    </div>
  );
}

export default SettingsPage;
