/**
 * Operations (consolidation step 4d, port of the Goodo OS operator recovery page).
 *
 * - The page opens on jobs that need recovery and selects job columns only, never the payload.
 * - A job in recovery offers Replay and Resolve by hand (outcome plus a note of at least 10 characters).
 * - A queued job that was never claimed offers Cancel with a reason; a claimed one does not.
 * - A refused call shows a plain message and the list reloads after a change.
 * - History shows staff names, outcomes and reasons; receipts keep only short scalar fields.
 * - model rules (attempted, next step, bounded cause and receipt).
 * The database rules are in supabase/tests/operations_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const calls: Array<{ table: string; select: string; filters: Array<[string, string, unknown]> }> = [];
let rows: unknown[] = [];

function chain(table: string, select: string) {
  const call = { table, select, filters: [] as Array<[string, string, unknown]> };
  calls.push(call);
  const q = {
    eq: (c: string, v: unknown) => (call.filters.push(["eq", c, v]), q),
    in: (c: string, v: unknown) => (call.filters.push(["in", c, v]), q),
    order: () => q,
    limit: () => q,
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: table === "clients" ? [{ slug: "glow", name: "Glow Drip" }] : rows, error: null }).then(resolve),
  };
  return q;
}

vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/employee" }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      if (name === "handoff_staff_options") {
        return Promise.resolve({ data: [{ user_id: "11111111-1111-4111-8111-111111111111", display_name: "Rae", email: "r@example.test" }], error: null });
      }
      return rpc(name, args);
    },
    from: (table: string) => ({ select: (s: string) => chain(table, s) }),
  },
}));

import OperationsPage from "@/features/operations/OperationsPage";
import { WithClient } from "./clientSelection";
import { boundedCause, boundedReceipt, nextStepOf, toJob, wasAttempted, type JobRow } from "@/features/operations/model";

const base = {
  client_slug: "glow", engagement_id: null, max_attempts: 3, available_at: "2026-11-10T10:00:00Z", lease_until: null, fence: 1,
  send_started_fence: null, last_error: null, receipt: null, created_at: "2026-11-10T10:00:00Z", updated_at: "2026-11-10T10:05:00Z",
};
const audit = (id: number, action: string, actor = "service", detail: Record<string, unknown> = {}) => ({ id, action, fence: 1, actor, detail, created_at: "2026-11-10T10:00:00Z" });
const RECOVERY: JobRow = {
  ...base, id: "aaaaaaaa-0000-4000-8000-000000000001", kind: "slack.reminder", state: "recovery", attempts: 1, send_started_fence: 1,
  last_error: "lease expired after an outside effect started", job_audit: [audit(1, "enqueued"), audit(2, "claimed", "w1"), audit(3, "send_started", "w1"), audit(4, "recovery")],
};
const FRESH: JobRow = { ...base, id: "bbbbbbbb-0000-4000-8000-000000000002", kind: "slack.owner_alert", state: "queued", attempts: 0, fence: 0, job_audit: [audit(1, "enqueued")] };
const RETRIED: JobRow = { ...base, id: "cccccccc-0000-4000-8000-000000000003", kind: "sync.test", state: "queued", attempts: 1, job_audit: [audit(1, "enqueued"), audit(2, "claimed", "w1"), audit(3, "retry", "w1", { error: "boom" })] };
const RESOLVED: JobRow = {
  ...base, id: "dddddddd-0000-4000-8000-000000000004", kind: "slack.reminder", state: "resolved_manually", attempts: 1,
  receipt: { ok: true, ts: "1731234567.000100", channel: "C0SECRET", message: { text: "secret body" } },
  job_audit: [audit(1, "enqueued"), audit(5, "resolved_manually", "11111111-1111-4111-8111-111111111111", { outcome: "effect_confirmed", note: "Saw the message in Slack" })],
};

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: {}, error: null });
  calls.length = 0;
  rows = [RECOVERY];
});

const CLIENTS = [{ slug: "glow", name: "Glow Drip" }] as never[];
const renderPage = (slug = "") =>
  render(
    <WithClient slug={slug} clients={CLIENTS}>
      <MemoryRouter><OperationsPage /></MemoryRouter>
    </WithClient>,
  );
const jobRegion = (name: RegExp) => screen.findByRole("listitem", { name });

describe("OperationsPage", () => {
  it("opens on jobs that need recovery and never selects the payload", async () => {
    renderPage();
    await jobRegion(/Job Slack reminder aaaaaaaa/);
    const jobCall = calls.find((c) => c.table === "durable_jobs");
    expect(jobCall?.select).not.toMatch(/payload/);
    expect(jobCall?.select).toMatch(/job_audit!job_audit_job_id_fkey/);
    expect(jobCall?.filters).toContainEqual(["in", "state", ["recovery"]]);
    expect(screen.getByText(/Cause: lease expired after an outside effect started/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Integration health" })).toHaveAttribute("href", "/employee/integration-health");
    // Plain wording, no queue jargon.
    expect(screen.getByText(/Try 1 of 3/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/attempt \d of|lease until|worker pass/);
  });

  it("replays a job in recovery and reloads", async () => {
    renderPage();
    const card = await jobRegion(/Job Slack reminder aaaaaaaa/);
    fireEvent.click(within(card).getByRole("button", { name: "Replay" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("replay_job", { p_job_id: RECOVERY.id }));
    await waitFor(() => expect(calls.filter((c) => c.table === "durable_jobs").length).toBe(2));
  });

  it("resolves by hand only with an outcome and a 10 character note", async () => {
    renderPage();
    const card = await jobRegion(/Job Slack reminder aaaaaaaa/);
    const resolve = within(card).getByRole("button", { name: "Resolve" });
    expect(resolve).toBeDisabled();
    fireEvent.change(within(card).getByLabelText("Outcome"), { target: { value: "abandoned" } });
    fireEvent.change(within(card).getByLabelText("Resolution note"), { target: { value: "short" } });
    expect(resolve).toBeDisabled();
    fireEvent.change(within(card).getByLabelText("Resolution note"), { target: { value: "  Checked Slack, nothing was posted  " } });
    expect(resolve).not.toBeDisabled();
    fireEvent.click(resolve);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("resolve_job_manually", { p_job_id: RECOVERY.id, p_outcome: "abandoned", p_note: "Checked Slack, nothing was posted" }),
    );
  });

  it("offers cancel only for a queued job that was never claimed, and shows a refusal", async () => {
    rows = [FRESH, RETRIED];
    rpc.mockResolvedValue({ data: null, error: { code: "55000", message: "x" } });
    renderPage();
    fireEvent.change(screen.getByLabelText("Jobs to show"), { target: { value: "queued" } });
    const fresh = await jobRegion(/Job Owner alert bbbbbbbb/);
    const retried = await jobRegion(/Job sync.test cccccccc/);
    expect(within(retried).queryByRole("button", { name: "Cancel job" })).toBeNull();
    expect(within(retried).getByText(/claimed before, so it cannot be canceled/)).toBeTruthy();
    const cancel = within(fresh).getByRole("button", { name: "Cancel job" });
    expect(cancel).toBeDisabled();
    fireEvent.change(within(fresh).getByLabelText("Cancel reason"), { target: { value: "Duplicate alert for the same sync" } });
    fireEvent.click(cancel);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("cancel_queued_job", { p_job_id: FRESH.id, p_reason: "Duplicate alert for the same sync" }));
    expect(await within(fresh).findByRole("alert")).toHaveTextContent(/changed since you opened this/);
    const last = calls.filter((c) => c.table === "durable_jobs").at(-1);
    expect(last?.filters).toContainEqual(["in", "state", ["queued"]]);
  });

  it("filters by client and shows a manual resolution with the staff name and a bounded receipt", async () => {
    rows = [RESOLVED];
    renderPage("glow");
    expect(screen.getByTestId("operations-scope")).toHaveTextContent("Showing jobs for Glow Drip.");
    fireEvent.change(screen.getByLabelText("Jobs to show"), { target: { value: "finished" } });
    const card = await jobRegion(/Job Slack reminder dddddddd/);
    await waitFor(() => expect(calls.filter((c) => c.table === "durable_jobs").at(-1)?.filters).toContainEqual(["eq", "client_slug", "glow"]));
    expect(within(card).getByText(/Rae, .*Saw the message in Slack/)).toBeTruthy();
    expect(within(card).getByText("Receipt: ok true · ts 1731234567.000100")).toBeTruthy();
    expect(within(card).queryByText(/C0SECRET|secret body/)).toBeNull();
  });
});

describe("OperationsPage with no client selected", () => {
  it("shows every client and the company-wide jobs without a client filter", async () => {
    renderPage("");
    await jobRegion(/Job Slack reminder aaaaaaaa/);
    expect(screen.getByTestId("operations-scope")).toHaveTextContent("Showing every client and the company-wide jobs.");
    const jobCall = calls.find((c) => c.table === "durable_jobs");
    expect(jobCall?.filters.some(([, column]) => column === "client_slug")).toBe(false);
  });
});

describe("operations model", () => {
  it("counts a job as attempted after any claim, send, retry, recovery or replay", () => {
    expect(wasAttempted({ attempts: 0, send_started_fence: null }, [audit(1, "enqueued")])).toBe(false);
    expect(wasAttempted({ attempts: 0, send_started_fence: null }, [audit(1, "enqueued"), audit(2, "manual_replay", "u")])).toBe(true);
    expect(wasAttempted({ attempts: 1, send_started_fence: null }, [])).toBe(true);
    expect(wasAttempted({ attempts: 0, send_started_fence: 2 }, [])).toBe(true);
  });

  it("gives each state its next step", () => {
    expect(nextStepOf("recovery", true)).toBe("replay");
    expect(nextStepOf("queued", false)).toBe("cancel");
    expect(nextStepOf("queued", true)).toBe("retry_scheduled");
    expect(nextStepOf("leased", true)).toBe("wait_for_lease");
    expect(nextStepOf("delivered", true)).toBe("none");
  });

  it("orders history newest first and reads the manual resolution", () => {
    const job = toJob(RESOLVED);
    expect(job.history.map((a) => a.id)).toEqual([5, 1]);
    expect(job.manualResolution).toMatchObject({ outcome: "effect_confirmed", note: "Saw the message in Slack" });
    expect(toJob(RECOVERY).canResolve).toBe(true);
    expect(toJob(FRESH).nextStep).toBe("cancel");
  });

  it("bounds causes and receipts", () => {
    expect(boundedCause("line one\nline   two")).toBe("line one line two");
    expect(boundedCause("x".repeat(200))?.length).toBe(160);
    expect(boundedCause(42)).toBeNull();
    expect(boundedReceipt({ status: "sent", channel: "C0X", ts: "has spaces here" })).toEqual({ status: "sent" });
    expect(boundedReceipt(["x"])).toBeNull();
    expect(boundedReceipt({ message: "x" })).toBeNull();
  });
});
