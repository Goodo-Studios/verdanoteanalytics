/**
 * Settings, Account tab: which client the settings belong to, what an employee may change, and the
 * pointer left where Taxonomy used to be.
 *
 *  - The selected client's name leads the tab, with the ad account under it.
 *  - A builder sees everything: overview (rename, sync, CSV, media), campaign objective, the sync
 *    settings with the cooldown and "Apply to all", and the sync log.
 *  - An employee sees the campaign objective and the thresholds and goals below it, and none of the
 *    builder-only parts (data pull window, cooldown, apply to all, overview, sync log). The Admin tab
 *    (Meta connection, API keys, user management) and the other builder tabs are not listed.
 *  - The Taxonomy tab is a note that links to the client's own Taxonomy tab.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WithClient } from "./clientSelection";

const h = vi.hoisted(() => ({
  role: "builder" as "builder" | "employee",
  setSelectedSlug: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, isBuilder: h.role === "builder", isEmployee: h.role === "employee", isClient: false }),
}));
vi.mock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => ({ isClientPreview: false, isEmployeePreview: false }) }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));
vi.mock("@/hooks/useIsSyncing", () => ({ useIsSyncing: () => false }));
vi.mock("@/components/SyncStatusBanner", () => ({ SyncStatusBanner: () => null }));
vi.mock("@/components/MediaRefreshBanner", () => ({ MediaRefreshBanner: () => null }));

const noop = () => {};
const mutation = { mutate: noop, isPending: false };
vi.mock("@/hooks/useUserSettingsPageState", () => ({
  useUserSettingsPageState: () => ({ loadingProfile: false, accounts: [], users: [], sync: mutation, refreshMedia: mutation, addAccount: mutation, createUser: mutation, deleteUser: mutation, deleteAccount: mutation, updateUser: mutation, renameAccount: mutation }),
}));
const ACCOUNT = { id: "act_glow", name: "Glow Meta", creative_count: 12, is_active: true, optimization_goal: "PURCHASE", last_synced_at: null };
vi.mock("@/hooks/useSettingsPageState", () => ({
  useSettingsPageState: () => ({
    account: ACCOUNT,
    accounts: [ACCOUNT, { id: "act_other", name: "Other Meta", creative_count: 1 }],
    setSelectedAccountId: noop,
    setRenamingAccount: noop, renamingAccount: null, setShowCsvModal: noop, showCsvModal: null, setCsvPreview: noop, setCsvMappings: noop, csvPreview: [], csvMappings: [],
    handleCsvUpload: noop, handleConfirmCsvUpload: noop, uploadMappings: mutation,
    sync: mutation, refreshMedia: mutation, toggleAccount: mutation, renameAccount: mutation, updateAccountSettings: mutation,
    dateRange: "30", setDateRange: noop, roasThreshold: "", setRoasThreshold: noop, spendThreshold: "100", setSpendThreshold: noop,
    winnerKpi: "roas", setWinnerKpi: noop, winnerKpiDirection: "gte", setWinnerKpiDirection: noop, winnerKpiThreshold: "2", setWinnerKpiThreshold: noop,
    killScaleKpi: "roas", setKillScaleKpi: noop, killScaleKpiDirection: "gte", setKillScaleKpiDirection: noop,
    scaleThreshold: "2", setScaleThreshold: noop, killThreshold: "1", setKillThreshold: noop,
    syncCooldownMinutes: "2", setSyncCooldownMinutes: noop, handleSaveCooldown: noop, cooldownLoaded: true,
    handleSave: noop, handleApplyToAll: noop,
    targetRoas: "", setTargetRoas: noop, targetCpa: "", setTargetCpa: noop, targetMonthlySpend: "", setTargetMonthlySpend: noop,
  }),
}));

// Everything that is not under test becomes a marker.
const { marker } = await vi.hoisted(async () => {
  const React = await import("react");
  return { marker: (id: string) => () => React.createElement("div", { "data-testid": id }) };
});
vi.mock("@/components/user-settings/ProfileInfoSection", () => ({ ProfileInfoSection: marker("profile-info") }));
vi.mock("@/components/user-settings/ChangePasswordSection", () => ({ ChangePasswordSection: marker("change-password") }));
vi.mock("@/components/user-settings/MetaConnectionSection", () => ({ MetaConnectionSection: marker("meta-connection") }));
vi.mock("@/components/user-settings/AdAccountsSection", () => ({ AdAccountsSection: marker("ad-accounts") }));
vi.mock("@/components/user-settings/UserManagementSection", () => ({ UserManagementSection: marker("user-management") }));
vi.mock("@/components/user-settings/AddAccountModal", () => ({ AddAccountModal: () => null }));
vi.mock("@/components/user-settings/CreateUserModal", () => ({ CreateUserModal: () => null }));
vi.mock("@/components/user-settings/ConfirmDeleteDialog", () => ({ ConfirmDeleteDialog: () => null }));
vi.mock("@/components/settings/AccountOverviewSection", () => ({ AccountOverviewSection: marker("account-overview") }));
vi.mock("@/components/settings/SyncScheduleSection", () => ({ SyncScheduleSection: marker("sync-schedule") }));
vi.mock("@/components/settings/SyncHistorySection", () => ({ SyncHistorySection: marker("sync-history") }));
vi.mock("@/components/settings/RenameAccountModal", () => ({ RenameAccountModal: () => null }));
vi.mock("@/components/settings/CsvUploadModal", () => ({ CsvUploadModal: () => null }));
vi.mock("@/components/settings/DataHealthSection", () => ({ DataHealthSection: marker("data-health") }));
vi.mock("@/components/settings/SpendDiagnosticSection", () => ({ SpendDiagnosticSection: marker("spend-diagnostic") }));
vi.mock("@/components/settings/DataExportSection", () => ({ DataExportSection: marker("data-export") }));
vi.mock("@/components/settings/NamingConventionSection", () => ({ NamingConventionSection: marker("naming") }));
vi.mock("@/components/settings/ApiKeysSection", () => ({ ApiKeysSection: marker("api-keys") }));
vi.mock("@/components/settings/SystemHealthSection", () => ({ SystemHealthSection: marker("system-health") }));

import SettingsPage from "@/pages/SettingsPage";

const CLIENTS = [
  { slug: "glow", name: "Glow Drip", active: true },
  { slug: "multi", name: "Multi Brand", active: true },
];

function renderSettings(opts: { slug?: string; linked?: Array<{ id: string; name: string }> } = {}) {
  const slug = opts.slug ?? "glow";
  return render(
    <MemoryRouter>
      <WithClient
        slug={slug}
        clients={CLIENTS}
        setSelectedSlug={h.setSelectedSlug}
        linkedAccounts={opts.linked ?? [{ id: "act_glow", name: "Glow Meta" }]}
      >
        <SettingsPage />
      </WithClient>
    </MemoryRouter>,
  );
}
const openTab = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  h.role = "builder";
  h.setSelectedSlug.mockReset();
});

describe("Account tab says which client it is for", () => {
  it("leads with the client name and shows the ad account under it", () => {
    renderSettings();
    openTab("Account");
    expect(screen.getByTestId("settings-account-client-name").textContent).toBe("Glow Drip");
    expect(screen.getByTestId("settings-account-ad-account").textContent).toBe("Ad account: Glow Meta");
    expect(screen.getByTestId("settings-client-select")).toBeTruthy();
  });

  it("falls back to the ad account name, and says so, when it is not linked to the selected client", () => {
    renderSettings({ slug: "multi", linked: [{ id: "act_multi1", name: "Multi One" }] });
    openTab("Account");
    expect(screen.getByTestId("settings-account-client-name").textContent).toBe("Glow Meta");
    expect(screen.getByTestId("settings-account-ad-account").textContent).toBe("This ad account is not linked to a client.");
  });

  it("offers an ad account chooser only when the client has several", () => {
    renderSettings({ linked: [{ id: "act_glow", name: "Glow Meta" }, { id: "act_glow2", name: "Glow Two" }] });
    openTab("Account");
    expect(screen.getByTestId("settings-account-select")).toBeTruthy();
  });

  it("has no chooser for a client with one ad account", () => {
    renderSettings();
    openTab("Account");
    expect(screen.queryByTestId("settings-account-select")).toBeNull();
  });
});

describe("what each role sees on the Account tab", () => {
  it("a builder sees the overview, the objective, the cooldown, Apply to all and the sync log", () => {
    renderSettings();
    openTab("Account");
    expect(screen.getByTestId("account-overview")).toBeTruthy();
    expect(screen.getByText("Campaign Objective")).toBeTruthy();
    expect(screen.getByText("Sync Cooldown")).toBeTruthy();
    expect(screen.getByText("Date Range (days)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply to All Accounts" })).toBeTruthy();
    expect(screen.getByTestId("sync-history")).toBeTruthy();
  });

  it("an employee sees the objective and the thresholds, and none of the builder parts", () => {
    h.role = "employee";
    renderSettings();
    openTab("Account");
    expect(screen.getByText("Campaign Objective")).toBeTruthy();
    expect(screen.getByText("Winner Definition")).toBeTruthy();
    expect(screen.getByText("Kill / Scale Zones")).toBeTruthy();
    expect(screen.getByText("Performance Goals")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save Settings" })).toBeTruthy();
    expect(screen.queryByTestId("account-overview")).toBeNull();
    expect(screen.queryByTestId("sync-history")).toBeNull();
    expect(screen.queryByText("Sync Cooldown")).toBeNull();
    expect(screen.queryByText("Date Range (days)")).toBeNull();
    expect(screen.queryByRole("button", { name: "Apply to All Accounts" })).toBeNull();
  });

  it("an employee has no Admin, Naming, Taxonomy or Health tab, so no Meta connection, API keys or user management", () => {
    h.role = "employee";
    renderSettings();
    const tabs = screen.getAllByRole("button").map((b) => b.textContent);
    expect(tabs).toEqual(["Profile", "Account", "Export"]);
    for (const id of ["meta-connection", "api-keys", "user-management", "system-health"]) expect(screen.queryByTestId(id)).toBeNull();
  });

  it("a builder has the Admin tab with the Meta connection, API keys and user management", () => {
    renderSettings();
    openTab("Admin");
    for (const id of ["meta-connection", "api-keys", "user-management"]) expect(screen.getByTestId(id)).toBeTruthy();
  });
});

describe("Taxonomy moved to the client hub", () => {
  it("the old Settings tab is a note with a link to the selected client's Taxonomy tab", () => {
    renderSettings();
    openTab("Taxonomy");
    const note = screen.getByTestId("settings-taxonomy-moved");
    expect(within(note).getByText("Taxonomy now lives with each client")).toBeTruthy();
    expect(screen.getByTestId("settings-taxonomy-link").getAttribute("href")).toBe("/builder/clients/glow/taxonomy");
    expect(within(note).getByRole("link", { name: "Go to Clients" }).getAttribute("href")).toBe("/builder/clients");
  });

  it("with no client selected the note still points to the client list", () => {
    renderSettings({ slug: "" });
    openTab("Taxonomy");
    expect(screen.queryByTestId("settings-taxonomy-link")).toBeNull();
    expect(screen.getByRole("link", { name: "Go to Clients" })).toBeTruthy();
  });
});
