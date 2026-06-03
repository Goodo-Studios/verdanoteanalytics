/**
 * Regression — internal sync/media-refresh progress banners must never render
 * for a client, nor for a builder previewing the client view.
 *
 * Both banners are self-gated (return null when the effective view is a
 * client), so they are safe at every call site. These tests drive a *running*
 * sync/refresh through mocked data hooks, then assert the banner is suppressed
 * for client + client-preview and still shown for a builder.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Role drivers (mutable, set per test). ---
let authValue: { isClient: boolean; isBuilder: boolean; isEmployee: boolean };
let previewValue: { isClientPreview: boolean; isEmployeePreview: boolean };

function setView(kind: "builder" | "client" | "client-preview") {
  authValue = {
    isClient: kind === "client",
    isBuilder: kind !== "client",
    isEmployee: false,
  };
  previewValue = {
    isClientPreview: kind === "client-preview",
    isEmployeePreview: false,
  };
}

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => authValue }));
vi.mock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => previewValue }));

// --- A running sync + a running media-refresh, so the banners WOULD render. ---
const RUNNING_SYNC_LOG = {
  id: "sync-1",
  status: "running",
  account_id: "acc1",
  started_at: "2026-06-02T22:00:00.000Z",
  current_phase: 4,
  creatives_fetched: 357,
  creatives_upserted: 391,
};
const RUNNING_MEDIA_LOG = {
  id: "media-1",
  status: "running",
  account_id: "acc1",
  started_at: "2026-06-02T22:00:00.000Z",
  current_phase: 2,
  thumbs_total: 100,
  thumbs_cached: 40,
};

vi.mock("@/hooks/useIsSyncing", () => ({ useIsSyncing: () => true }));
vi.mock("@/hooks/useSyncApi", () => ({
  useSyncHistory: () => ({ data: [RUNNING_SYNC_LOG] }),
  useCancelSync: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useMediaRefreshStatus", () => ({
  useIsRefreshingMedia: () => true,
  useMediaRefreshLogs: () => ({ data: [RUNNING_MEDIA_LOG] }),
}));
vi.mock("@/hooks/useAccountsApi", () => ({
  useAccounts: () => ({ data: [{ id: "acc1", name: "Velora" }] }),
}));

import { SyncStatusBanner } from "@/components/SyncStatusBanner";
import { MediaRefreshBanner } from "@/components/MediaRefreshBanner";

describe("SyncStatusBanner — client gate", () => {
  beforeEach(() => setView("builder"));

  it("renders the sync progress for a builder when a sync is running", () => {
    setView("builder");
    render(<SyncStatusBanner />);
    expect(screen.getByText(/Syncing/)).toBeInTheDocument();
  });

  it("renders NOTHING for a real client", () => {
    setView("client");
    const { container } = render(<SyncStatusBanner />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/Syncing/)).toBeNull();
  });

  it("renders NOTHING for a builder previewing the client view", () => {
    setView("client-preview");
    const { container } = render(<SyncStatusBanner />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/Syncing/)).toBeNull();
  });
});

describe("MediaRefreshBanner — client gate", () => {
  beforeEach(() => setView("builder"));

  it("renders the media-refresh progress for a builder when a refresh is running", () => {
    setView("builder");
    render(<MediaRefreshBanner />);
    expect(screen.getByText(/Refreshing media/)).toBeInTheDocument();
  });

  it("renders NOTHING for a real client", () => {
    setView("client");
    const { container } = render(<MediaRefreshBanner />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/Refreshing media/)).toBeNull();
  });

  it("renders NOTHING for a builder previewing the client view", () => {
    setView("client-preview");
    const { container } = render(<MediaRefreshBanner />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/Refreshing media/)).toBeNull();
  });
});
