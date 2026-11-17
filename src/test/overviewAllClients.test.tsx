/**
 * Creative > Overview with "All clients" picked in the top client switcher shows the agency
 * overview. A picked client, and any client login, still gets the single-client overview.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  preview: { isClientPreview: false } as Record<string, unknown>,
  selection: {} as Record<string, unknown>,
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => h.auth }));
vi.mock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => h.preview }));
vi.mock("@/contexts/ClientSelectionContext", () => ({ useClientSelection: () => h.selection }));
vi.mock("@/contexts/AccountContext", () => ({
  useAccountContext: () => ({ accounts: [], isLoading: false, selectedAccountId: "all", setSelectedAccountId: vi.fn() }),
}));
vi.mock("@/pages/AgencyDashboardPage", () => ({ default: () => <div data-testid="agency-page">agency overview</div> }));
vi.mock("@/hooks/useOverviewPageState", () => ({
  useOverviewPageState: () => ({
    accountName: "Glow Drip",
    lastSyncedAgo: null,
    dateFrom: undefined,
    dateTo: undefined,
    setDateRange: vi.fn(),
    metrics: { totalSpend: 0, activeCount: 0, avgCpa: 0, avgRoas: 0, winRate: 0, avgCtr: 0 },
    prevMetrics: null,
    hasPrevPeriod: false,
    isLoading: false,
    creatives: [],
    selectedAccountId: "act_a",
  }),
}));
vi.mock("@/hooks/useSyncApi", () => ({ useSync: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock("@/hooks/usePipelineTasks", () => ({ useOwnClientLinks: () => ({ data: [], isLoading: false }) }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));
vi.mock("@/components/DateRangeFilter", () => ({ DateRangeFilter: () => <div /> }));
vi.mock("@/components/client/WaitingOnYouLine", () => ({ WaitingOnYouLine: () => <div /> }));
vi.mock("@/features/client-pages/ClientHomeLead", () => ({ ClientHomeLead: () => <div /> }));

import OverviewPage from "@/pages/OverviewPage";

const renderPage = () => render(<MemoryRouter><OverviewPage /></MemoryRouter>);

beforeEach(() => {
  h.auth = { isBuilder: true, isEmployee: false, isClient: false };
  h.preview = { isClientPreview: false };
  h.selection = { selectedSlug: "", isLoading: false, clients: [{ slug: "glow", name: "Glow Drip", active: true }] };
});

describe("Creative overview and the All clients choice", () => {
  it("shows the agency overview for staff when All clients is selected", async () => {
    renderPage();
    expect(await screen.findByTestId("agency-page")).toBeInTheDocument();
  });

  it("shows the agency overview for an employee too", async () => {
    h.auth = { isBuilder: false, isEmployee: true, isClient: false };
    renderPage();
    expect(await screen.findByTestId("agency-page")).toBeInTheDocument();
  });

  it("shows the single-client overview once a client is picked", () => {
    h.selection = { ...h.selection, selectedSlug: "glow" };
    renderPage();
    expect(screen.queryByTestId("agency-page")).toBeNull();
    expect(screen.getByText("Glow Drip")).toBeInTheDocument();
  });

  it("waits instead of flashing the agency view while the client list loads", () => {
    h.selection = { selectedSlug: "", isLoading: true, clients: [] };
    renderPage();
    expect(screen.queryByTestId("agency-page")).toBeNull();
  });

  it("never shows the agency overview to a client login", () => {
    h.auth = { isBuilder: false, isEmployee: false, isClient: true };
    renderPage();
    expect(screen.queryByTestId("agency-page")).toBeNull();
  });

  it("never shows the agency overview to a builder previewing the client view", () => {
    h.preview = { isClientPreview: true };
    renderPage();
    expect(screen.queryByTestId("agency-page")).toBeNull();
  });
});
