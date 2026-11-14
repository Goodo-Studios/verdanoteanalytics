/**
 * Growth Dashboard page: loads its numbers from growth_dashboard_data, imports the old
 * localStorage export once, saves edits back, and never edits a stored row that fails
 * its checks. The Supabase client is mocked; all numbers are made up.
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const db = vi.hoisted(() => ({
  rows: [] as Array<{ key: string; data: unknown }>,
  selectError: null as null | { message: string },
  upsert: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: db.from },
}));

import GrowthDashboardPage from "@/features/growth-dashboard/GrowthDashboardPage";
import { emptyPlan, type GrowthPlan } from "@/features/growth-dashboard/model";

const NOW = new Date(2026, 10, 9, 12, 0, 0);

function plan(): GrowthPlan {
  const p = emptyPlan(2026);
  return {
    ...p,
    goal: 10000,
    h1Actuals: [100, 100, 100, 100, 100, 100],
    months: p.months.map((_, i) => ({ rev: 1000, calls: 10 + i, signings: 1 + i, active: 2 * (i + 1), newMrr: 50, base: 40, projects: 10 })),
    assumptions: "Made-up assumptions for the test.",
    targetsFrom: "2026-07-10",
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GrowthDashboardPage now={NOW} />
    </QueryClientProvider>,
  );
}

function openTab(name: string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });
}

beforeEach(() => {
  db.rows = [];
  db.selectError = null;
  db.upsert.mockReset().mockResolvedValue({ error: null });
  db.from.mockReset().mockImplementation((table: string) => {
    expect(table).toBe("growth_dashboard_data");
    return {
      select: vi.fn(async () => (db.selectError ? { data: null, error: db.selectError } : { data: db.rows, error: null })),
      upsert: db.upsert,
    };
  });
});

describe("Growth Dashboard page", () => {
  it("with nothing stored, asks for the plan and imports the old export into the state row", async () => {
    renderPage();
    expect(await screen.findByText("Enter the plan")).toBeTruthy();

    openTab("Import");
    expect(screen.getByTestId("growth-export-command").textContent).toBe("copy(localStorage.getItem('goodo3m_v1'))");

    const exported = {
      rev: { "6": 4321 },
      calls: { "2026-11-03": 2 },
      deals: [{ id: "d1", date: "2026-11-02", client: "Test Co", price: 1500 }],
      weeks: { "2026-11-06": { total: null, paid: null, spend: null, acts: { liPosts: 3 } } },
      targets: { liPosts: 5 },
    };
    fireEvent.change(screen.getByLabelText("Exported JSON"), { target: { value: JSON.stringify(exported) } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.getByTestId("growth-import-summary").textContent).toMatch(/1 months of revenue, 1 days of calls, 1 deals and 1 weeks/);

    fireEvent.click(screen.getByRole("button", { name: "Save to Verdanote" }));
    await screen.findByText(/Imported\. The numbers are now stored in Verdanote\./);
    expect(db.upsert).toHaveBeenCalledTimes(1);
    const [row, opts] = db.upsert.mock.calls[0];
    expect(opts).toEqual({ onConflict: "key" });
    expect(row.key).toBe("state");
    expect(row.data.rev).toEqual({ "6": 4321 });
    expect(row.data.deals).toEqual(exported.deals);
    expect(row.data.targets.liConnect).toBe(200);
  });

  it("shows errors for an export that does not match and saves nothing", async () => {
    renderPage();
    await screen.findByText("Enter the plan");
    openTab("Import");
    fireEvent.change(screen.getByLabelText("Exported JSON"), { target: { value: JSON.stringify({ rev: { "6": "a lot" } }) } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.getByTestId("growth-import-errors").textContent).toMatch(/rev for Jul is not a number/);
    expect(screen.queryByRole("button", { name: /Save to Verdanote|Replace saved numbers/ })).toBeNull();
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("validates and saves the plan into the plan row", async () => {
    renderPage();
    await screen.findByText("Enter the plan");
    // An empty plan has no goal, so it is refused and nothing is saved.
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Goal must be a number of dollars above zero/);
    fireEvent.change(screen.getByLabelText("Full-year goal"), { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Goal must be a number/);
    expect(db.upsert).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Full-year goal"), { target: { value: "20000" } });
    fireEvent.change(screen.getByLabelText("Plan year"), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText("Dec Total"), { target: { value: "3000" } });
    db.upsert.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    await screen.findByTestId("growth-plan-tiles");
    const planCalls = db.upsert.mock.calls.filter(([r]) => r.key === "plan");
    expect(planCalls).toHaveLength(1);
    expect(planCalls[0][0].data.goal).toBe(20000);
    expect(planCalls[0][0].data.months[5].rev).toBe(3000);
    expect(screen.getByTestId("growth-plan-tiles").textContent).toMatch(/\$20k/);
  });

  it("renders the stored plan and progress, and saves an edited day of calls", async () => {
    db.rows = [
      { key: "plan", data: plan() },
      {
        key: "state",
        data: {
          rev: { "6": 900 },
          calls: { "2026-11-03": 2, "2026-11-09": 3 },
          deals: [{ id: "d1", date: "2026-11-02", client: "Test Co", price: 1500 }],
          weeks: {},
          targets: {},
        },
      },
    ];
    renderPage();
    const tiles = await screen.findByTestId("growth-plan-tiles");
    // Projected finish: 600 (H1) + 6000 (plan) = 6600, shown as "$7k" by the old formatter.
    expect(within(tiles).getByText("$7k")).toBeTruthy();
    expect(screen.getByText("Made-up assumptions for the test.")).toBeTruthy();
    expect(screen.getByTestId("growth-plan-table").textContent).toMatch(/Total21/);

    openTab("Progress");
    const progress = await screen.findByTestId("growth-progress-tiles");
    expect(within(progress).getByText("Nov calls")).toBeTruthy();
    expect(within(progress).getByText("5 / 14")).toBeTruthy();
    expect(screen.getByTestId("growth-deal-tally").textContent).toMatch(/1 \/ 5/);
    expect(screen.getByTestId("growth-cal-label").textContent).toBe("November 2026");

    fireEvent.change(screen.getByLabelText("Calls on 2026-11-10"), { target: { value: "4" } });
    expect(screen.getByTestId("growth-cal-tally").textContent).toMatch(/^9of 14 target/);
    await waitFor(() => expect(db.upsert).toHaveBeenCalled(), { timeout: 3000 });
    const [row] = db.upsert.mock.calls[db.upsert.mock.calls.length - 1];
    expect(row.key).toBe("state");
    expect(row.data.calls).toEqual({ "2026-11-03": 2, "2026-11-09": 3, "2026-11-10": 4 });
    await screen.findByText(/^Saved \d/);
  });

  it("adds and deletes a deal", async () => {
    db.rows = [{ key: "plan", data: plan() }];
    renderPage();
    await screen.findByTestId("growth-plan-tiles");
    openTab("Progress");
    await screen.findByTestId("growth-deal-table");
    fireEvent.change(screen.getByLabelText("Client name"), { target: { value: "Another Co" } });
    fireEvent.change(screen.getByLabelText("Monthly price"), { target: { value: "2500" } });
    fireEvent.click(screen.getByRole("button", { name: "Add deal" }));
    expect(screen.getByTestId("growth-deal-table").textContent).toMatch(/Another Co\$2,500\/mo/);
    fireEvent.click(screen.getByRole("button", { name: "Delete deal Another Co" }));
    expect(screen.getByTestId("growth-deal-table").textContent).toMatch(/No deals logged yet/);
  });

  it("colours output cells against the weekly target on the Outputs tab", async () => {
    db.rows = [
      { key: "plan", data: plan() },
      { key: "state", data: { weeks: { "2026-11-06": { total: null, paid: null, spend: null, acts: { liPosts: 5, twPosts: 2 } } } } },
    ];
    renderPage();
    await screen.findByTestId("growth-plan-tiles");
    openTab("Outputs");
    const li = await screen.findByLabelText("LinkedIn posts, week ending 2026-11-06");
    expect(li.closest("td")?.className).toMatch(/emerald/);
    expect(screen.getByLabelText("Twitter / X posts, week ending 2026-11-06").closest("td")?.className).toMatch(/red/);
    expect(screen.getByTestId("growth-week-total-2026-11-06").textContent).toBe("7");
  });

  it("refuses to edit a stored row that fails its checks", async () => {
    db.rows = [{ key: "state", data: { rev: { "6": "lots" } } }];
    renderPage();
    expect((await screen.findByRole("alert")).textContent).toMatch(/editing is off/);
    expect(screen.getByRole("tab", { name: "Progress" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("tab", { name: "Outputs" }).hasAttribute("disabled")).toBe(true);
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("shows the database error when the rows cannot be read", async () => {
    db.selectError = { message: "permission denied for table growth_dashboard_data" };
    renderPage();
    expect((await screen.findByRole("alert")).textContent).toMatch(/permission denied/);
  });
});
