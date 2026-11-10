/**
 * Integration health (consolidation step 4a, port of the Goodo OS page).
 *
 * - The page calls the integration-health function with GET and renders each
 *   connector's state, its problems and notes, the work queue and owner alerts.
 * - A refused or failed call shows the function's error and no overview.
 * - "Check again" calls the function again.
 * - The work queue links to the Operations page (step 4d).
 * - describePattern / describeNote turn every server code into a sentence.
 * The client wall for the route is in StaffArea.test.tsx; the server side in
 * supabase/functions/integration-health/index.test.ts.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));

import IntegrationHealthPage from "@/features/integration-health/IntegrationHealthPage";
import { describeNote, describePattern, type HealthOverview } from "@/features/integration-health/model";

const overview: HealthOverview = {
  checkedAt: "2026-11-10T12:00:00Z",
  environment: "other",
  connectors: [
    { key: "clickup", label: "ClickUp", connected: true, state: "needs_attention", patterns: ["connector.stale"], notes: [], lastConfirmedAt: "2026-11-10T01:00:00Z", details: { boardRows: 3 } },
    { key: "fireflies", label: "Fireflies", connected: false, state: "not_connected", patterns: [], notes: ["fireflies.no_key"], lastConfirmedAt: null, details: {} },
    { key: "slack", label: "Slack", connected: true, state: "healthy", patterns: [], notes: ["slack.not_production", "slack.sends_off"], lastConfirmedAt: null, details: {} },
    { key: "verdanote_data", label: "Verdanote data (Meta ad sync)", connected: true, state: "needs_attention", patterns: ["sync.stuck:2"], notes: [], lastConfirmedAt: null, details: { activeAccounts: 1 } },
  ],
  queue: { state: "needs_attention", patterns: ["queue.recovery:1"], pending: 2 },
  ownerAlerts: [{ id: "j1", state: "recovery", createdAt: "2026-11-10T11:00:00Z", updatedAt: "2026-11-10T11:05:00Z", text: "Ad sync stuck for Glow Drip" }],
};

beforeEach(() => {
  invoke.mockReset();
});

const renderPage = () => render(<MemoryRouter><IntegrationHealthPage /></MemoryRouter>);

describe("IntegrationHealthPage", () => {
  it("loads with GET and shows connectors, queue and owner alerts", async () => {
    invoke.mockResolvedValue({ data: overview, error: null });
    renderPage();
    expect(await screen.findByTestId("integration-health-state-clickup")).toHaveTextContent("Needs attention");
    expect(invoke).toHaveBeenCalledWith("integration-health", { method: "GET" });
    expect(screen.getByTestId("integration-health-state-fireflies")).toHaveTextContent("Not connected");
    expect(screen.getByTestId("integration-health-state-slack")).toHaveTextContent("Healthy");
    expect(screen.getByText("ClickUp data is older than the freshness window")).toBeTruthy();
    expect(screen.getByText("3 cards on the content board")).toBeTruthy();
    expect(screen.getByText("No Fireflies key is set here, so transcripts cannot be read.")).toBeTruthy();
    expect(screen.getByText("Slack messages are only ever sent from production.")).toBeTruthy();
    expect(screen.getByText("2 ad syncs have been running for more than 30 minutes")).toBeTruthy();
    expect(screen.getByTestId("integration-health-queue")).toHaveTextContent("Needs attention · 2 pending jobs");
    expect(screen.getByText("1 job is waiting for recovery")).toBeTruthy();
    expect(screen.getByText("Alert needs recovery")).toBeTruthy();
    expect(screen.getByText("Ad sync stuck for Glow Drip")).toBeTruthy();
    expect(screen.getByText(/staging, where outside services are not connected/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Operations" })).toHaveAttribute("href", "/builder/operations");
  });

  it("shows the function's error and no overview when the call is refused", async () => {
    const context = new Response(JSON.stringify({ error: "Forbidden: staff only" }), { status: 403 });
    invoke.mockResolvedValue({ data: null, error: Object.assign(new Error("non-2xx"), { context }) });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden: staff only");
    expect(screen.queryByText("Connectors")).toBeNull();
  });

  it("treats an answer without connectors as a failure", async () => {
    invoke.mockResolvedValue({ data: { nope: true }, error: null });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Integration health could not load.");
  });

  it("says when no owner alert was queued, and checks again on request", async () => {
    invoke.mockResolvedValue({ data: { ...overview, ownerAlerts: [] }, error: null });
    renderPage();
    expect(await screen.findByText("No owner alerts have been queued.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /check again/i }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  });
});

describe("describePattern and describeNote", () => {
  it("describes every pattern the server can return", () => {
    expect(describePattern("connector.unconfirmed")).toBe("ClickUp has never completed a sync");
    expect(describePattern("slack.no_owner_destination")).toMatch(/no confirmed owner alert channel/);
    expect(describePattern("sync.stuck:1")).toBe("1 ad sync has been running for more than 30 minutes");
    expect(describePattern("sync.failed:3")).toBe("3 ad syncs failed in the last 24 hours");
    expect(describePattern("sync.accounts_behind:1")).toBe("1 active ad account has not synced in 48 hours");
    expect(describePattern("queue.overdue:2")).toBe("2 queued jobs are more than 15 minutes overdue");
    expect(describePattern("queue.lease_expired:1")).toMatch(/lease expired/);
    expect(describePattern("queue.recovery:4")).toBe("4 jobs are waiting for recovery");
  });

  it("shows an unknown code as it is", () => {
    expect(describePattern("something.new")).toBe("something.new");
    expect(describePattern("sync.stuck:x")).toBe("sync.stuck:x");
    expect(describeNote("other.note")).toBe("other.note");
  });

  it("describes every note", () => {
    for (const n of ["clickup.no_token", "fireflies.no_key", "fireflies.on_demand", "slack.no_token", "slack.not_production", "slack.sends_off", "sync.no_active_accounts"]) {
      expect(describeNote(n)).not.toBe(n);
    }
  });
});
