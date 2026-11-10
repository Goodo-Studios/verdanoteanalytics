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
const h = vi.hoisted(() => ({ table: {} as Table, calls: [] as string[] }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => {
        h.calls.push(table);
        return {
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
            const p = h.table.pending ? new Promise(() => {}) : Promise.resolve({ data: h.table.data ?? [], error: h.table.error ?? null });
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
    fireEvent.change(screen.getByTestId("work-filter-client"), { target: { value: "bloom" } });
    await waitFor(() => expect(screen.getAllByTestId("work-row")).toHaveLength(2));
    fireEvent.change(screen.getByTestId("work-filter-stage"), { target: { value: "Client Review" } });
    await waitFor(() => expect(screen.getAllByTestId("work-row")).toHaveLength(1));
    expect(screen.getByTestId("work-row").textContent).toContain("Static ads");
    fireEvent.change(screen.getByTestId("work-filter-client"), { target: { value: "" } });
    fireEvent.change(screen.getByTestId("work-filter-stage"), { target: { value: "" } });
    fireEvent.change(screen.getByTestId("work-search"), { target: { value: "shoot" } });
    await waitFor(() => expect(screen.getAllByTestId("work-row")).toHaveLength(1));
    expect(screen.getByTestId("work-row").textContent).toContain("Shoot day");
  });

  it("opens with the filters in the address (the link Home sends)", async () => {
    renderWork("/builder/work?view=all&stage=Client+Review");
    const rows = await screen.findAllByTestId("work-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Static ads");
    expect((screen.getByTestId("work-filter-stage") as HTMLSelectElement).value).toBe("Client Review");
  });

  it("links each card out to ClickUp in a new tab", async () => {
    renderWork("/builder/work?view=all");
    const links = await screen.findAllByTestId("work-row-link");
    expect(links[0].getAttribute("href")).toBe("https://app.clickup.com/t/cu-Unboxing");
    expect(links[0].getAttribute("target")).toBe("_blank");
    expect(links[0].getAttribute("rel")).toContain("noopener");
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

  it("reads only pipeline_tasks", async () => {
    renderWork();
    await screen.findAllByTestId("work-row");
    expect([...new Set(h.calls)]).toEqual(["pipeline_tasks"]);
  });
});
