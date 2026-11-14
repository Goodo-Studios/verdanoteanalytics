/**
 * Work page: every client's ClickUp cards, soonest due first. Checks the Due this week / Overdue / All
 * toggle, the client, stage and task name filters, that filters open from an address, the link out to
 * ClickUp, Show more, and the loading, error and empty states.
 */
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

type Table = { data?: unknown; error?: { message: string } | null; pending?: boolean };
const h = vi.hoisted(() => ({ table: {} as Table, decisions: [] as unknown[], calls: [] as string[], task: null as null | { id: string; title: string } }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => {
        h.calls.push(table);
        return {
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: h.task, error: null }) }),
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
            const p = table === "client_task_decisions"
              ? Promise.resolve({ data: h.decisions, error: null })
              : h.table.pending ? new Promise(() => {}) : Promise.resolve({ data: h.table.data ?? [], error: h.table.error ?? null });
            return p.then(res, rej);
          },
        };
      },
    }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, isBuilder: true, isEmployee: false, isClient: false }) }));
vi.mock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => ({ isClientPreview: false, isEmployeePreview: false }) }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));

vi.mock("@/features/home/TaskSidePanel", () => ({
  TaskSidePanel: ({ task }: { task: { title: string } | null }) => (task ? <div data-testid="task-modal">{task.title}</div> : null),
}));

import WorkPage from "@/features/home/WorkPage";
import { WithClient } from "@/test/clientSelection";
import { addDaysIso, todayIso } from "@/lib/homeData";

const day = (n: number) => addDaysIso(todayIso(), n);
const CLIENTS = [
  { slug: "glow", name: "Glow Drip", active: true },
  { slug: "bloom", name: "Bloom", active: true },
];
const mk = (id: string, over: Record<string, unknown>) => ({
  id,
  clickup_task_id: `cu-${id}`,
  client_slug: "glow",
  task_name: id,
  stage: "Production",
  due_date: day(1),
  synced_at: new Date().toISOString(),
  ...over,
});

function renderWork(url = "/builder/work") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <WithClient slug="" clients={CLIENTS}>
          <WorkPage />
        </WithClient>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const names = () => screen.queryAllByTestId("work-row").map((r) => within(r).getByText(/^(Hook|Static|Unbox|Shoot|Edit|Card)/).textContent);

const DATA = [
  mk("Hook video", { stage: "Editing", due_date: day(2) }),
  mk("Unboxing", { client_slug: "bloom", stage: "Production", due_date: day(-3) }),
  mk("Static ads", { client_slug: "bloom", stage: "Client Review", due_date: day(20) }),
  mk("Shoot day", { due_date: null }),
];

beforeEach(() => {
  h.table = { data: DATA };
  h.calls = [];
});

describe("Work page", () => {
  it("opens on Due this week, with the client, task, stage and due date on each row", async () => {
    renderWork();
    const rows = await screen.findAllByTestId("work-row");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByTestId("work-row-client").textContent).toBe("Glow Drip");
    expect(rows[0].textContent).toContain("Hook video");
    expect(within(rows[0]).getByTestId("work-row-stage").textContent).toBe("Editing");
    expect(within(rows[0]).getByTestId("work-row-due").textContent).not.toBe("No date");
    expect(screen.getByTestId("work-view-week").getAttribute("aria-pressed")).toBe("true");
  });

  it("toggles to Overdue and All, soonest due first with undated cards last, and marks late rows", async () => {
    renderWork();
    await screen.findAllByTestId("work-row");
    fireEvent.click(screen.getByTestId("work-view-overdue"));
    await waitFor(() => expect(screen.getAllByTestId("work-row")).toHaveLength(1));
    expect(screen.getByTestId("work-row").getAttribute("data-late")).toBe("true");
    expect(screen.getByTestId("work-row").textContent).toContain("Unboxing");
    fireEvent.click(screen.getByTestId("work-view-all"));
    await waitFor(() => expect(screen.getAllByTestId("work-row")).toHaveLength(4));
    expect(screen.getAllByTestId("work-row").map((r) => r.textContent?.match(/Unboxing|Hook video|Static ads|Shoot day/)?.[0])).toEqual(["Unboxing", "Hook video", "Static ads", "Shoot day"]);
    expect(screen.getAllByTestId("work-row").filter((r) => r.getAttribute("data-late") === "true")).toHaveLength(1);
    expect(screen.getByTestId("work-count").textContent).toContain("4 cards");
  });

  it("filters by client, stage and task name", async () => {
    renderWork("/builder/work?view=all");
    await screen.findAllByTestId("work-row");
    fireEvent.change(screen.getByLabelText("Client"), { target: { value: "bloom" } });
    await waitFor(() => expect(screen.getAllByTestId("work-row")).toHaveLength(2));
    fireEvent.change(screen.getByLabelText("Stage"), { target: { value: "Client Review" } });
    await waitFor(() => expect(screen.getAllByTestId("work-row")).toHaveLength(1));
    expect(screen.getByTestId("work-row").textContent).toContain("Static ads");
    fireEvent.change(screen.getByLabelText("Client"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Stage"), { target: { value: "" } });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search task names" }), { target: { value: "shoot" } });
    await waitFor(() => expect(screen.getAllByTestId("work-row")).toHaveLength(1));
    expect(screen.getByTestId("work-row").textContent).toContain("Shoot day");
  });

  it("opens with the filters in the address (the link Home sends)", async () => {
    renderWork("/builder/work?view=all&stage=Client+Review");
    const rows = await screen.findAllByTestId("work-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Static ads");
    expect((screen.getByLabelText("Stage") as HTMLSelectElement).value).toBe("Client Review");
  });

  it("keeps a small link out to ClickUp in a new tab on each card", async () => {
    renderWork("/builder/work?view=all");
    const links = await screen.findAllByTestId("work-row-clickup");
    expect(links[0].getAttribute("href")).toBe("https://app.clickup.com/t/cu-Unboxing");
    expect(links[0].getAttribute("target")).toBe("_blank");
    expect(links[0].getAttribute("rel")).toContain("noopener");
  });

  it("opens the task modal when a card title is clicked", async () => {
    h.task = { id: "t1", title: "Unboxing" };
    renderWork("/builder/work?view=all");
    const titles = await screen.findAllByTestId("work-row-link");
    expect(screen.queryByTestId("task-modal")).toBeNull();
    fireEvent.click(titles[0]);
    expect((await screen.findByTestId("task-modal")).textContent).toBe("Unboxing");
  });

  it("falls back to the ClickUp page for a card with no task row", async () => {
    h.task = null;
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderWork("/builder/work?view=all");
    fireEvent.click((await screen.findAllByTestId("work-row-link"))[0]);
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://app.clickup.com/t/cu-Unboxing", "_blank", "noopener,noreferrer"));
    expect(screen.queryByTestId("task-modal")).toBeNull();
    open.mockRestore();
  });

  it("says plainly that there is no person filter", async () => {
    renderWork();
    await screen.findAllByTestId("work-row");
    expect(screen.getByText(/does not record who a card is assigned to/)).toBeTruthy();
  });

  it("caps the list and adds more on Show more", async () => {
    h.table = { data: Array.from({ length: 60 }, (_, i) => mk(`Card ${String(i).padStart(2, "0")}`, { due_date: day(1) })) };
    renderWork();
    expect(await screen.findAllByTestId("work-row")).toHaveLength(25);
    fireEvent.click(screen.getByTestId("work-show-more"));
    await waitFor(() => expect(screen.getAllByTestId("work-row")).toHaveLength(50));
    fireEvent.click(screen.getByTestId("work-show-more"));
    await waitFor(() => expect(screen.getAllByTestId("work-row")).toHaveLength(60));
    expect(screen.queryByTestId("work-show-more")).toBeNull();
    expect(names().length).toBe(60);
  });

  it("is loading, then empty, with different messages", async () => {
    h.table = { pending: true };
    const a = renderWork();
    expect(screen.getByTestId("work-loading")).toBeTruthy();
    expect(screen.queryByTestId("work-empty")).toBeNull();
    a.unmount();
    h.table = { data: [] };
    renderWork();
    expect((await screen.findByTestId("work-empty")).textContent).toContain("No ClickUp cards have come in yet");
  });

  it("says when the filters match nothing", async () => {
    renderWork("/builder/work?view=overdue&for=glow");
    expect((await screen.findByTestId("work-empty")).textContent).toContain("Nothing is overdue with these filters");
  });

  it("shows an error that is not the empty message", async () => {
    h.table = { error: { message: "down" } };
    renderWork();
    expect(await screen.findByTestId("work-error")).toBeTruthy();
    expect(screen.queryByTestId("work-empty")).toBeNull();
    expect(screen.queryByTestId("work-loading")).toBeNull();
  });

  it("shows what the client decided beside the card, and highlights a new answer", async () => {
    h.decisions = [
      { id: "d1", clickup_task_id: "cu-Static ads", client_slug: "bloom", task_name: "Static ads", decision: "approved", note: null, decided_by_label: "Alex", decided_at: new Date().toISOString(), superseded_at: null },
      { id: "d0", clickup_task_id: "cu-Hook video", client_slug: "glow", task_name: "Hook video", decision: "changes_requested", note: "Shorter", decided_by_label: "Sam", decided_at: "2020-01-01T00:00:00Z", superseded_at: null },
      { id: "dx", clickup_task_id: "cu-Shoot day", client_slug: "glow", task_name: "Shoot day", decision: "approved", note: null, decided_by_label: "Old", decided_at: "2020-01-01T00:00:00Z", superseded_at: "2020-01-02T00:00:00Z" },
    ];
    renderWork("/builder/work?view=all");
    await screen.findAllByTestId("work-row");
    const badges = await screen.findAllByTestId("work-row-decision");
    expect(badges.map((b) => b.textContent).sort()).toEqual(["Changes requested", "Client approved"]);
    expect(badges.find((b) => b.textContent === "Client approved")).toHaveAttribute("data-new", "true");
    expect(badges.find((b) => b.textContent === "Changes requested")).not.toHaveAttribute("data-new");
    h.decisions = [];
  });

  it("reads only the cards and the client decisions", async () => {
    renderWork();
    await screen.findAllByTestId("work-row");
    expect([...new Set(h.calls)].sort()).toEqual(["client_task_decisions", "pipeline_tasks"]);
  });
});
