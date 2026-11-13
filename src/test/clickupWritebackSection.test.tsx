/**
 * ClickUp write-back on Integration health (Goodo OS story OS-017).
 *
 * - The section reads clickup_writeback_overview and shows the counts per state.
 * - With write-back off it shows the "Write-back is off" banner; on, it names the allowed lists.
 * - Recent failures show the error, attempts and the next try (or that it gave up).
 * - Recent clashes show both values and which side was kept.
 * - A refused or malformed answer shows a plain message, never numbers.
 * - On the page only builders see the section; employees do not trigger the call.
 */
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const rpc = vi.fn();
let auth = { isBuilder: true };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) }, rpc: (...args: unknown[]) => rpc(...args) },
}));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));

import { ClickUpWritebackSection } from "@/features/integration-health/ClickUpWritebackSection";
import { isOverview, type WritebackOverview } from "@/features/integration-health/writebackModel";
import IntegrationHealthPage from "@/features/integration-health/IntegrationHealthPage";

const off: WritebackOverview = {
  enabled: false,
  allowedListIds: [],
  blockedReason: "off",
  lastRunAt: "2026-11-30T12:00:00Z",
  counts: { queued: 0, retrying: 1, sent: 0, failed: 1, held: 7, clash: 1, skipped: 2 },
  failures: [
    { id: 1, clickupTaskId: "86b1", kind: "status", field: "status", state: "queued", attempts: 2, lastError: "ClickUp API error [500] for PUT /task/86b1", nextAttemptAt: "2026-11-30T12:05:00Z", updatedAt: "2026-11-30T12:00:00Z" },
    { id: 2, clickupTaskId: "86b2", kind: "assignees", field: "editor", state: "failed", attempts: 1, lastError: "no ClickUp member has the email x@goodo.test", nextAttemptAt: null, updatedAt: "2026-11-30T11:00:00Z" },
  ],
  clashes: [
    { id: 9, clickupTaskId: "86b3", kind: "due_date", field: "due_date", appValue: "2026-12-05", clickupValue: "2026-12-03", winner: "clickup", createdAt: "2026-11-30T11:30:00Z" },
    { id: 10, clickupTaskId: "86b4", kind: "status", field: "status", appValue: "complete", clickupValue: null, winner: "app", createdAt: "2026-11-30T11:20:00Z" },
  ],
};

beforeEach(() => {
  invoke.mockReset();
  rpc.mockReset();
  auth = { isBuilder: true };
});

describe("ClickUpWritebackSection", () => {
  it("shows the off banner, counts, failures and clashes", async () => {
    rpc.mockResolvedValue({ data: off, error: null });
    render(<ClickUpWritebackSection />);
    expect(await screen.findByTestId("clickup-writeback-banner")).toHaveTextContent(
      "Write-back is off. Changes made in the app are recorded and held; nothing is written to ClickUp.",
    );
    expect(rpc).toHaveBeenCalledWith("clickup_writeback_overview");
    expect(screen.getByTestId("clickup-writeback-count-held")).toHaveTextContent("Held: 7");
    expect(screen.getByTestId("clickup-writeback-count-retrying")).toHaveTextContent("Retrying: 1");
    expect(screen.getByTestId("clickup-writeback-count-failed")).toHaveTextContent("Failed: 1");
    expect(screen.getByTestId("clickup-writeback-count-clash")).toHaveTextContent("Clashes, ClickUp kept: 1");

    const failures = within(screen.getByRole("list", { name: "Recent failures" })).getAllByRole("listitem");
    expect(failures[0]).toHaveTextContent("Status on task 86b1 · 2 attempts · next try");
    expect(failures[0]).toHaveTextContent("ClickUp API error [500] for PUT /task/86b1");
    expect(failures[1]).toHaveTextContent("Editor on task 86b2 · 1 attempt · gave up");

    const clashes = within(screen.getByRole("list", { name: "Recent clashes" })).getAllByRole("listitem");
    expect(clashes[0]).toHaveTextContent("Due date on task 86b3 · app: 2026-12-05 · ClickUp: 2026-12-03 · ClickUp kept");
    expect(clashes[1]).toHaveTextContent("Status on task 86b4 · app: complete · ClickUp: empty · app kept");
  });

  it("names the allowed list when write-back is on", async () => {
    rpc.mockResolvedValue({ data: { ...off, enabled: true, allowedListIds: ["901400000001"], blockedReason: null, failures: [], clashes: [] }, error: null });
    render(<ClickUpWritebackSection />);
    expect(await screen.findByTestId("clickup-writeback-banner")).toHaveTextContent(
      "Write-back is on for ClickUp list 901400000001. Changes on any other list are held.",
    );
    expect(screen.getByText("No failed writes.")).toBeTruthy();
    expect(screen.getByText("No changes made in both places.")).toBeTruthy();
  });

  it("says when the worker has not run yet", async () => {
    rpc.mockResolvedValue({ data: { ...off, lastRunAt: null }, error: null });
    render(<ClickUpWritebackSection />);
    expect(await screen.findByText("The write-back worker has not run yet.")).toBeTruthy();
  });

  it("a refused call shows a plain message and no numbers", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "builders only" } });
    render(<ClickUpWritebackSection />);
    expect(await screen.findByText("Only builders can see ClickUp write-back.")).toBeTruthy();
    expect(screen.queryByTestId("clickup-writeback-banner")).toBeNull();
  });

  it("a malformed answer is not shown", async () => {
    rpc.mockResolvedValue({ data: "x1", error: null });
    render(<ClickUpWritebackSection />);
    expect(await screen.findByText("ClickUp write-back status could not load.")).toBeTruthy();
    expect(isOverview({ enabled: true })).toBe(false);
    expect(isOverview(off)).toBe(true);
  });
});

describe("IntegrationHealthPage and write-back", () => {
  const overview = {
    checkedAt: "2026-11-30T12:00:00Z",
    environment: "production",
    connectors: [],
    queue: { state: "healthy", patterns: [], pending: 0 },
    ownerAlerts: [],
  };

  it("shows the section to a builder", async () => {
    invoke.mockResolvedValue({ data: overview, error: null });
    rpc.mockResolvedValue({ data: off, error: null });
    render(<MemoryRouter><IntegrationHealthPage /></MemoryRouter>);
    expect(await screen.findByTestId("clickup-writeback-banner")).toHaveTextContent("Write-back is off.");
  });

  it("does not show it to an employee, and does not ask for it", async () => {
    auth = { isBuilder: false };
    invoke.mockResolvedValue({ data: overview, error: null });
    rpc.mockResolvedValue({ data: off, error: null });
    render(<MemoryRouter><IntegrationHealthPage /></MemoryRouter>);
    expect(await screen.findByText("Work queue")).toBeTruthy();
    expect(screen.queryByTestId("clickup-writeback")).toBeNull();
    expect(rpc).not.toHaveBeenCalledWith("clickup_writeback_overview");
  });
});
