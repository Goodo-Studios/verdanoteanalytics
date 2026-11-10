/**
 * Operating costs (consolidation step 4d, port of the Goodo OS owner page). Builder only.
 *
 * - The page shows the active fixed total, the budget state and the model spend note.
 * - A new cost is saved at version 0 with the parsed amount; an edit sends the version on screen.
 * - The budget form refuses a warning at or above the limit and saves otherwise.
 * - "Check budgets now" reports new alerts; alerts show whether an owner alert was queued.
 * - A refused write shows a plain message.
 * - model rules.
 * The builder-only route is checked in StaffArea.test.tsx; the database rules in
 * supabase/tests/operating_costs_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const data: Record<string, unknown[]> = {};
const selects: Record<string, string> = {};

function chain(table: string) {
  const q = {
    order: () => q,
    limit: () => q,
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: data[table] ?? [], error: null }).then(resolve),
  };
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: unknown) => rpc(name, args),
    from: (table: string) => ({ select: (s: string) => ((selects[table] = s), chain(table)) }),
  },
}));

import OperatingCostsPage from "@/features/operating-costs/OperatingCostsPage";
import { budgetProblem, budgetState, entryProblem, fixedTotal, parseUsd, type CostEntry } from "@/features/operating-costs/model";

const entry = (key: string, label: string, usd: string, active = true, version = 1): CostEntry => ({
  entry_key: key, label, category: "database", monthly_usd: usd, basis: "invoiced", source_reference: "October invoice", active, version, updated_at: "2026-11-01T00:00:00Z",
});

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: 1, error: null });
  data.operating_cost_entries = [entry("supabase-pro", "Supabase Pro", "25.00"), entry("old-tool", "Old tool", "500.00", false)];
  data.operating_budgets = [{ budget_key: "total", monthly_limit_usd: "60.00", warning_usd: "20.00", version: 2, updated_at: "2026-11-01T00:00:00Z" }];
  data.operating_budget_alerts = [
    { id: "a1", budget_key: "total", period_month: "2026-11-01", level: "warning", spend_usd: "25.00", threshold_usd: "20.00", monthly_limit_usd: "60.00", budget_version: 2, job_id: null, created_at: "2026-11-10T00:00:00Z", durable_jobs: null },
    { id: "a2", budget_key: "total", period_month: "2026-10-01", level: "limit", spend_usd: "70.00", threshold_usd: "60.00", monthly_limit_usd: "60.00", budget_version: 1, job_id: "j1", created_at: "2026-10-20T00:00:00Z", durable_jobs: { state: "delivered" } },
  ];
  data.operating_cost_events = [{ id: 3, action: "budgets_evaluated", target_key: "2026-11", version: 0, detail: { fixed_usd: 25, created: 1 }, created_at: "2026-11-10T00:00:00Z" }];
});

describe("OperatingCostsPage", () => {
  it("shows the active fixed total, budget state, model note and alerts", async () => {
    render(<OperatingCostsPage />);
    expect(await screen.findByTestId("oc-fixed-total")).toHaveTextContent("Fixed costs: $25.00 a month");
    expect(screen.getByTestId("oc-budget-state")).toHaveTextContent("Past the warning amount · warning $20.00 · limit $60.00");
    expect(screen.getByText(/Model spend is not measured/)).toBeTruthy();
    expect(screen.getByText(/no owner alert queued \(no confirmed owner alert channel\)/)).toBeTruthy();
    expect(screen.getByText(/owner alert delivered/)).toBeTruthy();
    expect(screen.getByText(/Checked 2026-11: fixed costs \$25\.00, 1 new alert$/)).toBeTruthy();
    expect(selects.operating_budget_alerts).toBe("*, durable_jobs!operating_budget_alerts_job_id_fkey(state)");
  });

  it("adds a cost at version 0 with the parsed amount", async () => {
    render(<OperatingCostsPage />);
    const form = await screen.findByRole("group", { name: "New cost" });
    const add = within(form).getByRole("button", { name: "Add cost" });
    expect(add).toBeDisabled();
    fireEvent.change(within(form).getByLabelText("Key"), { target: { value: "vercel-pro" } });
    fireEvent.change(within(form).getByLabelText("Label"), { target: { value: " Vercel Pro " } });
    fireEvent.change(within(form).getByLabelText("Category"), { target: { value: "frontend_hosting" } });
    fireEvent.change(within(form).getByLabelText("Monthly amount (USD)"), { target: { value: "20.5" } });
    fireEvent.change(within(form).getByLabelText("Basis"), { target: { value: "quoted" } });
    fireEvent.change(within(form).getByLabelText("Source"), { target: { value: "Pricing page" } });
    expect(add).not.toBeDisabled();
    fireEvent.click(add);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("record_operating_cost_entry", {
        p_entry_key: "vercel-pro", p_label: "Vercel Pro", p_category: "frontend_hosting", p_monthly_usd: 20.5, p_basis: "quoted",
        p_source_reference: "Pricing page", p_active: true, p_expected_version: 0,
      }),
    );
  });

  it("edits a cost against the version on screen and shows a stale refusal", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "x" } });
    render(<OperatingCostsPage />);
    const form = await screen.findByRole("group", { name: "Edit Supabase Pro" });
    expect(within(form).getByLabelText("Key")).toBeDisabled();
    fireEvent.change(within(form).getByLabelText("Monthly amount (USD)"), { target: { value: "30" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save version 2" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("record_operating_cost_entry", expect.objectContaining({ p_entry_key: "supabase-pro", p_monthly_usd: 30, p_expected_version: 1 })));
    expect(await within(form).findByRole("alert")).toHaveTextContent(/changed since you opened it/);
  });

  it("keeps the warning below the limit and saves the budget at its version", async () => {
    render(<OperatingCostsPage />);
    const form = await screen.findByRole("group", { name: "Budget" });
    const save = within(form).getByRole("button", { name: "Save budget version 3" });
    fireEvent.change(within(form).getByLabelText("Warning amount (USD)"), { target: { value: "60" } });
    expect(save).toBeDisabled();
    expect(within(form).getByText(/must be below the limit/)).toBeTruthy();
    fireEvent.change(within(form).getByLabelText("Warning amount (USD)"), { target: { value: "45" } });
    fireEvent.click(save);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("record_operating_budget", { p_budget_key: "total", p_monthly_limit_usd: 60, p_warning_usd: 45, p_expected_version: 2 }),
    );
  });

  it("checks the budgets on request and reports the result", async () => {
    rpc.mockResolvedValue({ data: 0, error: null });
    render(<OperatingCostsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Check budgets now" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("evaluate_operating_budgets", undefined));
    expect(await screen.findByRole("status")).toHaveTextContent("No new threshold was crossed.");
  });

  it("shows a refusal when a non-builder somehow checks", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "x" } });
    render(<OperatingCostsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Check budgets now" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Only a builder can change operating costs.");
  });
});

describe("operating costs model", () => {
  it("adds only active entries", () => {
    expect(fixedTotal([entry("a", "Aaa", "10.10"), entry("b", "Bbb", "0.20"), entry("c", "Ccc", "99", false)])).toBe(10.3);
  });

  it("states the budget", () => {
    const b = { budget_key: "total" as const, monthly_limit_usd: "100", warning_usd: "80", version: 1, updated_at: "" };
    expect(budgetState(10, null)).toBe("none");
    expect(budgetState(79.99, b)).toBe("within");
    expect(budgetState(80, b)).toBe("warning");
    expect(budgetState(100, b)).toBe("over_limit");
  });

  it("parses dollar amounts with at most two decimals", () => {
    expect(parseUsd("20.5", { min: 0, max: 100000, allowZero: true })).toBe(20.5);
    expect(parseUsd("0", { min: 0, max: 100000, allowZero: false })).toBeNull();
    expect(parseUsd("1.005", { min: 0, max: 100000, allowZero: true })).toBeNull();
    expect(parseUsd("-1", { min: 0, max: 100000, allowZero: true })).toBeNull();
    expect(parseUsd("100001", { min: 0, max: 100000, allowZero: true })).toBeNull();
  });

  it("checks the entry and budget forms like the database", () => {
    const ok = { entryKey: "ab", label: "Abc", category: "other" as const, monthlyUsd: "1", basis: "proposed" as const, sourceReference: "ref", active: true };
    expect(entryProblem(ok)).toBeNull();
    expect(entryProblem({ ...ok, entryKey: "Bad Key" })).toMatch(/lowercase/);
    expect(entryProblem({ ...ok, sourceReference: "x" })).toMatch(/where the figure comes from/);
    expect(budgetProblem("100", "99.99")).toBeNull();
    expect(budgetProblem("100", "100")).toMatch(/below the limit/);
    expect(budgetProblem("", "1")).toMatch(/above zero/);
  });
});
