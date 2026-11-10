/**
 * Integration health (consolidation step 4a, port of the Goodo OS page).
 *
 * - The page calls the integration-health function with GET and renders each
 *   connector's state, its problems and notes, the work queue and owner alerts.
 * - A refused or failed call shows the function's error and no overview.
 * - "Check again" calls the function again.
 * - The work queue links to the Operations page (step 4d).
 * - Alerts (step 4d): suppressed problems and active exceptions are shown; staff record an
 *   exception for an open problem with a kind that fits it; only a builder sees
 *   "Check and alert now", which posts the evaluate action and shows what was queued.
 * - describePattern / describeNote turn every server code into a sentence.
 * The client wall for the route is in StaffArea.test.tsx; the server side in
 * supabase/functions/integration-health/index.test.ts.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const rpc = vi.fn();
let auth = { isBuilder: false };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) }, rpc: (...args: unknown[]) => rpc(...args) },
}));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));

import IntegrationHealthPage from "@/features/integration-health/IntegrationHealthPage";
import { describeNote, describePattern, exceptionTargets, type HealthOverview, kindsFor } from "@/features/integration-health/model";

const overview: HealthOverview = {
  checkedAt: "2026-11-10T12:00:00Z",
  environment: "other",
  connectors: [
    { key: "clickup", label: "ClickUp", connected: true, state: "needs_attention", patterns: ["connector.stale"], suppressed: [], notes: [], lastConfirmedAt: "2026-11-10T01:00:00Z", details: { boardRows: 3 } },
    { key: "fireflies", label: "Fireflies", connected: false, state: "not_connected", patterns: [], suppressed: [], notes: ["fireflies.no_key"], lastConfirmedAt: null, details: {} },
    { key: "slack", label: "Slack", connected: true, state: "healthy", patterns: [], suppressed: [], notes: ["slack.not_production", "slack.sends_off"], lastConfirmedAt: null, details: {} },
    { key: "verdanote_data", label: "Verdanote data (Meta ad sync)", connected: true, state: "needs_attention", patterns: ["sync.stuck:2"], suppressed: [], notes: [], lastConfirmedAt: null, details: { activeAccounts: 1 } },
  ],
  queue: { state: "needs_attention", patterns: ["queue.recovery:1"], pending: 2 },
  ownerAlerts: [{ id: "j1", state: "recovery", createdAt: "2026-11-10T11:00:00Z", updatedAt: "2026-11-10T11:05:00Z", text: "Ad sync stuck for Glow Drip" }],
};

beforeEach(() => {
  invoke.mockReset();
  rpc.mockReset();
  rpc.mockResolvedValue({ data: "x1", error: null });
  auth = { isBuilder: false };
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

describe("alerts on the Integration health page (step 4d)", () => {
  const withException: HealthOverview = {
    ...overview,
    connectors: overview.connectors.map((c) => (c.key === "verdanote_data" ? { ...c, patterns: [], suppressed: ["sync.stuck:2"], state: "healthy" as const } : c)),
    exceptions: [{ id: "x0", connector: "verdanote_data", pattern: "sync.stuck", kind: "false_positive", reason: "Leftover log row", expiresAt: "2026-11-10T16:00:00Z" }],
  };

  it("shows suppressed problems and active exceptions", async () => {
    invoke.mockResolvedValue({ data: withException, error: null });
    renderPage();
    expect(await screen.findByText(/Suppressed by an exception: 2 ad syncs have been running/)).toBeTruthy();
    expect(screen.getByText(/Verdanote data: sync.stuck · False positive · until .* · Leftover log row/)).toBeTruthy();
  });

  it("records an exception for an open problem with a kind that fits it", async () => {
    invoke.mockResolvedValue({ data: overview, error: null });
    renderPage();
    const form = await screen.findByRole("group", { name: "Record an exception" });
    const save = within(form).getByRole("button", { name: "Record exception" });
    expect(save).toBeDisabled();
    fireEvent.change(within(form).getByLabelText("Problem"), { target: { value: "clickup|connector.stale" } });
    expect(within(form).getAllByRole("option", { name: /Idle while testing|Engagement paused|False positive/ })).toHaveLength(3);
    fireEvent.change(within(form).getByLabelText("Kind"), { target: { value: "paused_engagement" } });
    fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: " Client paused this week " } });
    fireEvent.change(within(form).getByLabelText("Hours (1 to 24)"), { target: { value: "12" } });
    fireEvent.click(save);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("record_alert_exception", { p_connector: "clickup", p_pattern: "connector.stale", p_kind: "paused_engagement", p_reason: "Client paused this week", p_hours: 12 }),
    );
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  });

  it("refuses more than 24 hours before calling the database", async () => {
    invoke.mockResolvedValue({ data: overview, error: null });
    renderPage();
    const form = await screen.findByRole("group", { name: "Record an exception" });
    fireEvent.change(within(form).getByLabelText("Problem"), { target: { value: "queue|queue.recovery" } });
    fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: "Known" } });
    fireEvent.change(within(form).getByLabelText("Hours (1 to 24)"), { target: { value: "25" } });
    expect(within(form).getByRole("button", { name: "Record exception" })).toBeDisabled();
  });

  it("shows Check and alert now to a builder only and reports what was queued", async () => {
    invoke.mockResolvedValue({ data: overview, error: null });
    const { unmount } = renderPage();
    await screen.findByText("Connectors");
    expect(screen.queryByRole("button", { name: "Check and alert now" })).toBeNull();
    unmount();
    auth = { isBuilder: true };
    invoke.mockImplementation((_fn: string, opts: { method: string; body?: unknown }) =>
      Promise.resolve(opts.method === "POST"
        ? { data: { evaluated: true, environment: "other", alerts: [{ connector: "clickup", pattern: "connector.stale", key: "k1", text: "t", enqueued: false, jobId: null, reason: "not_production" }] }, error: null }
        : { data: overview, error: null }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Check and alert now" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("integration-health", { method: "POST", body: { action: "evaluate" } }));
    const result = await screen.findByRole("list", { name: "Check result" });
    expect(within(result).getByText(/ClickUp: ClickUp data is older than the freshness window · not queued: owner alerts are only queued from production/)).toBeTruthy();
  });
});

describe("alert model", () => {
  it("allows the Goodo OS kinds per problem", () => {
    expect(kindsFor("connector.stale")).toEqual(["idle_testing", "paused_engagement", "false_positive"]);
    expect(kindsFor("connector.unconfirmed")).toEqual(["reconnect_warmup", "false_positive"]);
    expect(kindsFor("sync.stuck:3")).toEqual(["false_positive"]);
  });

  it("lists open problems as exception targets without counts", () => {
    expect(exceptionTargets(overview)).toEqual([
      { connector: "clickup", pattern: "connector.stale" },
      { connector: "verdanote_data", pattern: "sync.stuck" },
      { connector: "queue", pattern: "queue.recovery" },
    ]);
  });
});
