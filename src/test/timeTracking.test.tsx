/**
 * Timer and weekly log (OS-012), through the real hooks with a mocked Supabase client.
 *
 * Pill: hidden with no timer; shows the task title and elapsed h:mm:ss for a running entry, and
 * still does after a re-mount with a fresh cache (a reload); Stop calls time_stop_timer; Switch
 * calls time_start_timer for another task or for Internal with a category; client logins and the
 * client preview never see it and never ask for time. Weekly log: groups by day with day and
 * week totals; add, edit and delete send the right writes; an overlap error shows in plain words.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const USER = "11111111-1111-4111-8111-111111111111";

type Call = { table: string; op: string; values?: unknown; filters: string[] };
const h = vi.hoisted(() => ({
  running: null as unknown,
  entries: [] as unknown[],
  tasks: [] as unknown[],
  clients: [] as unknown[],
  calls: [] as Call[],
  rpcs: [] as Array<{ fn: string; args: unknown }>,
  writeError: null as null | { message: string },
  role: "builder" as "builder" | "employee" | "client",
  preview: false,
}));

vi.mock("@/integrations/supabase/client", () => {
  const result = (call: Call, single: boolean) => {
    if (call.op !== "select") return { data: null, error: h.writeError };
    if (call.table === "time_entries") {
      if (call.filters.includes("is:end_at:null")) return { data: single ? h.running : h.running ? [h.running] : [], error: null };
      return { data: h.entries, error: null };
    }
    if (call.table === "os_tasks") return { data: h.tasks, error: null };
    if (call.table === "clients") return { data: h.clients, error: null };
    return { data: [], error: null };
  };
  const chain = (call: Call, single = false): Record<string, unknown> => {
    const b: Record<string, unknown> = {};
    for (const m of ["eq", "neq", "is", "gte", "lt", "or", "order", "limit"]) {
      b[m] = (c: unknown, v?: unknown) => (call.filters.push(`${m}:${String(c)}:${String(v)}`), b);
    }
    b.maybeSingle = () => chain(call, true);
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result(call, single)).then(res, rej);
    return b;
  };
  const start = (table: string, op: string, values?: unknown) => {
    const call: Call = { table, op, values, filters: [] };
    h.calls.push(call);
    return chain(call);
  };
  return {
    supabase: {
      from: (table: string) => ({
        select: () => start(table, "select"),
        insert: (v: unknown) => start(table, "insert", v),
        update: (v: unknown) => start(table, "update", v),
        delete: () => start(table, "delete"),
      }),
      rpc: (fn: string, args: unknown) => {
        h.rpcs.push({ fn, args });
        if (fn === "time_my_person") return Promise.resolve({ data: "person-1", error: null });
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: USER }, isBuilder: h.role === "builder", isEmployee: h.role === "employee", isClient: h.role === "client" }),
}));
vi.mock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => ({ isClientPreview: h.preview }) }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));
vi.mock("sonner", () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { toast };
});

import { TimerPill } from "@/components/TimerPill";
import TimeLogPage from "@/features/home/TimeLogPage";
import { toTimestamp } from "@/lib/timeLog";

const task = (id: string, title: string) => ({
  id,
  title,
  client_slug: "glow",
  status: "editing",
  due_date: null,
  is_stuck: false,
  read_only: false,
  client: { name: "Glow Drip" },
  status_info: { stage: "Editing" },
});

function renderWith(ui: React.ReactNode, url = "/builder/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.running = null;
  h.entries = [];
  h.tasks = [task("t1", "Cut v1"), task("t2", "Hooks for March")];
  h.clients = [{ slug: "glow", name: "Glow Drip" }];
  h.calls = [];
  h.rpcs = [];
  h.writeError = null;
  h.role = "builder";
  h.preview = false;
});

describe("timer pill", () => {
  it("is hidden when no timer runs", async () => {
    renderWith(<TimerPill />);
    await waitFor(() => expect(h.calls.some((c) => c.table === "time_entries")).toBe(true));
    expect(screen.queryByTestId("timer-pill")).toBeNull();
  });

  it("shows the task title and elapsed time, and still does after a reload", async () => {
    h.running = {
      id: "e1",
      person_id: "p1",
      task_id: "t1",
      client_slug: "glow",
      is_internal: false,
      category: null,
      description: "",
      start_at: new Date(Date.now() - 3725_000).toISOString(),
      end_at: null,
      task: { title: "Cut v1" },
      client: { name: "Glow Drip" },
    };
    const first = renderWith(<TimerPill />);
    expect((await screen.findByTestId("timer-pill-label")).textContent).toBe("Cut v1");
    expect(screen.getByTestId("timer-pill-elapsed").textContent).toMatch(/^1:02:0[5-9]$/);
    // Only my own running entry is asked for.
    const q = h.calls.find((c) => c.table === "time_entries")!;
    expect(q.filters).toContain(`eq:person.user_id:${USER}`);
    expect(q.filters).toContain("is:end_at:null");

    // A reload: a new cache and a new mount read the same entry from the database.
    first.unmount();
    renderWith(<TimerPill />);
    expect((await screen.findByTestId("timer-pill-label")).textContent).toBe("Cut v1");
    expect(screen.getByTestId("timer-pill-elapsed").textContent).toMatch(/^1:02:\d\d$/);
  });

  it("labels time with no task by client or Internal and category", async () => {
    h.running = { id: "e2", task_id: null, client_slug: null, is_internal: true, category: "Admin", start_at: new Date().toISOString(), end_at: null };
    renderWith(<TimerPill />);
    expect((await screen.findByTestId("timer-pill-label")).textContent).toBe("Internal · Admin");
  });

  it("Stop calls time_stop_timer", async () => {
    h.running = { id: "e1", task_id: "t1", start_at: new Date().toISOString(), end_at: null, task: { title: "Cut v1" } };
    renderWith(<TimerPill />);
    fireEvent.click(await screen.findByRole("button", { name: "Stop the timer" }));
    await waitFor(() => expect(h.rpcs.map((r) => r.fn)).toContain("time_stop_timer"));
  });

  it("Switch starts another of my tasks, or Internal time with a category", async () => {
    h.running = { id: "e1", task_id: "t1", start_at: new Date().toISOString(), end_at: null, task: { title: "Cut v1" } };
    renderWith(<TimerPill />);
    fireEvent.click(await screen.findByRole("button", { name: "Switch the timer" }));
    const picker = await screen.findByTestId("timer-switch");
    // The running task is not offered again.
    const options = await within(picker).findAllByTestId("timer-switch-task");
    expect(options.map((o) => o.textContent)).toEqual(["Hooks for March"]);
    fireEvent.click(options[0]);
    await waitFor(() => expect(h.rpcs.find((r) => r.fn === "time_start_timer")?.args).toMatchObject({ p_task_id: "t2", p_internal: false }));

    h.rpcs = [];
    fireEvent.click(screen.getByRole("button", { name: "Switch the timer" }));
    const picker2 = await screen.findByTestId("timer-switch");
    fireEvent.change(within(picker2).getByLabelText("Client or Internal"), { target: { value: "__internal__" } });
    fireEvent.change(within(picker2).getByLabelText("Category"), { target: { value: "Admin" } });
    fireEvent.click(within(picker2).getByRole("button", { name: "Start" }));
    await waitFor(() =>
      expect(h.rpcs.find((r) => r.fn === "time_start_timer")?.args).toEqual({
        p_task_id: null,
        p_client_slug: null,
        p_internal: true,
        p_category: "Admin",
        p_description: "",
      }),
    );
  });

  it("a client login never sees the pill and never asks for time", async () => {
    h.role = "client";
    h.running = { id: "e1", task_id: "t1", start_at: new Date().toISOString(), end_at: null, task: { title: "Cut v1" } };
    renderWith(<TimerPill />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("timer-pill")).toBeNull();
    expect(h.calls.filter((c) => c.table === "time_entries")).toEqual([]);
  });

  it("a builder previewing the client view does not see the pill", async () => {
    h.preview = true;
    h.running = { id: "e1", task_id: "t1", start_at: new Date().toISOString(), end_at: null, task: { title: "Cut v1" } };
    renderWith(<TimerPill />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("timer-pill")).toBeNull();
  });

  it("an employee sees the pill too", async () => {
    h.role = "employee";
    h.running = { id: "e1", task_id: "t1", start_at: new Date().toISOString(), end_at: null, task: { title: "Cut v1" } };
    renderWith(<TimerPill />);
    expect(await screen.findByTestId("timer-pill")).toBeTruthy();
  });
});

const at = (d: number, hh: number, mm = 0) => new Date(2026, 10, d, hh, mm).toISOString();
const row = (id: string, start: string, end: string | null, over: Record<string, unknown> = {}) => ({
  id,
  person_id: "person-1",
  task_id: null,
  client_slug: null,
  is_internal: true,
  category: "Admin",
  description: "",
  start_at: start,
  end_at: end,
  ...over,
});

describe("weekly log", () => {
  const WEEK = "/builder/time?week=2026-11-09";

  beforeEach(() => {
    h.entries = [
      row("e1", at(9, 9), at(9, 10, 30), { task_id: "t1", client_slug: "glow", is_internal: false, category: null, task: { title: "Cut v1" } }),
      row("e2", at(9, 11), at(9, 11, 15)),
      row("e3", at(11, 14), at(11, 16), { is_internal: false, client_slug: "glow", category: "Strategy", client: { name: "Glow Drip" } }),
    ];
  });

  it("shows Monday to Sunday with entries by day and day and week totals", async () => {
    renderWith(<TimeLogPage />, WEEK);
    await screen.findAllByTestId("time-entry");
    const days = screen.getAllByTestId("time-day");
    expect(days.map((d) => d.getAttribute("data-date"))).toEqual([
      "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15",
    ]);
    expect(within(days[0]).getAllByTestId("time-entry-label").map((e) => e.textContent)).toEqual(["Cut v1", "Internal · Admin"]);
    expect(within(days[0]).getByTestId("time-day-total").textContent).toBe("1h 45m");
    expect(within(days[2]).getByTestId("time-entry-label").textContent).toBe("Glow Drip · Strategy");
    expect(within(days[2]).getByTestId("time-day-total").textContent).toBe("2h 00m");
    expect(within(days[1]).getByTestId("time-day-total").textContent).toBe("0m");
    expect(screen.getByTestId("time-week-total").textContent).toContain("3h 45m");
    // The query asks for my entries in this week only.
    const q = h.calls.find((c) => c.table === "time_entries")!;
    expect(q.filters).toContain(`eq:person.user_id:${USER}`);
    expect(q.filters).toContain(`gte:start_at:${new Date(2026, 10, 9).toISOString()}`);
    expect(q.filters).toContain(`lt:start_at:${new Date(2026, 10, 16).toISOString()}`);
  });

  it("previous and next week move the week in the address", async () => {
    renderWith(<TimeLogPage />, WEEK);
    await screen.findAllByTestId("time-entry");
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => expect(screen.getAllByTestId("time-day")[0].getAttribute("data-date")).toBe("2026-11-16"));
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    await waitFor(() => expect(screen.getAllByTestId("time-day")[0].getAttribute("data-date")).toBe("2026-11-02"));
  });

  it("adds a manual Internal entry with a category for my person row", async () => {
    renderWith(<TimeLogPage />, WEEK);
    await screen.findAllByTestId("time-entry");
    fireEvent.click(screen.getByTestId("time-add"));
    const form = screen.getByTestId("time-entry-form");
    fireEvent.change(within(form).getByLabelText("Date"), { target: { value: "2026-11-10" } });
    fireEvent.change(within(form).getByLabelText("Start"), { target: { value: "13:00" } });
    fireEvent.change(within(form).getByLabelText("End"), { target: { value: "14:30" } });
    fireEvent.change(within(form).getByLabelText("Client or Internal"), { target: { value: "__internal__" } });
    fireEvent.change(within(form).getByLabelText("Category"), { target: { value: "Admin" } });
    fireEvent.change(within(form).getByLabelText("Description"), { target: { value: "Invoices" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add entry" }));
    await waitFor(() => expect(h.calls.find((c) => c.op === "insert")).toBeTruthy());
    expect(h.rpcs.map((r) => r.fn)).toContain("time_my_person");
    expect(h.calls.find((c) => c.op === "insert")!.values).toEqual({
      task_id: null,
      client_slug: null,
      is_internal: true,
      category: "Admin",
      description: "Invoices",
      start_at: toTimestamp("2026-11-10", "13:00"),
      end_at: toTimestamp("2026-11-10", "14:30"),
      person_id: "person-1",
    });
    await waitFor(() => expect(screen.queryByTestId("time-entry-form")).toBeNull());
  });

  it("refuses time with no task and no category before sending it", async () => {
    renderWith(<TimeLogPage />, WEEK);
    await screen.findAllByTestId("time-entry");
    fireEvent.click(screen.getByTestId("time-add"));
    const form = screen.getByTestId("time-entry-form");
    await within(form).findByRole("option", { name: "Glow Drip" });
    fireEvent.change(within(form).getByLabelText("Client or Internal"), { target: { value: "glow" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add entry" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("Choose a category for time with no task.");
    expect(h.calls.filter((c) => c.op !== "select")).toEqual([]);
  });

  it("edits an entry with an update on its id", async () => {
    renderWith(<TimeLogPage />, WEEK);
    await screen.findAllByTestId("time-entry");
    fireEvent.click(screen.getByRole("button", { name: "Edit Cut v1" }));
    const form = screen.getByTestId("time-entry-form");
    expect((within(form).getByLabelText("Start") as HTMLInputElement).value).toBe("09:00");
    expect((within(form).getByLabelText("Task") as HTMLSelectElement).value).toBe("t1");
    fireEvent.change(within(form).getByLabelText("End"), { target: { value: "11:00" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(h.calls.find((c) => c.op === "update")).toBeTruthy());
    const upd = h.calls.find((c) => c.op === "update")!;
    expect(upd.filters).toEqual(["eq:id:e1"]);
    expect(upd.values).toMatchObject({ task_id: "t1", client_slug: null, is_internal: false, end_at: toTimestamp("2026-11-09", "11:00") });
    expect(h.rpcs.map((r) => r.fn)).not.toContain("time_my_person");
  });

  it("deletes an entry only after confirming", async () => {
    renderWith(<TimeLogPage />, WEEK);
    await screen.findAllByTestId("time-entry");
    fireEvent.click(screen.getByRole("button", { name: "Delete Internal · Admin" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(h.calls.find((c) => c.op === "delete")).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "Delete Internal · Admin" }));
    const again = await screen.findByRole("alertdialog");
    fireEvent.click(within(again).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(h.calls.find((c) => c.op === "delete")?.filters).toEqual(["eq:id:e2"]));
  });

  it("starts a timer with no task for Internal with a category", async () => {
    renderWith(<TimeLogPage />, WEEK);
    await screen.findAllByTestId("time-entry");
    const form = screen.getByTestId("time-start-form");
    fireEvent.click(within(form).getByRole("button", { name: "Start timer" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("Choose a client or Internal, and a category.");
    expect(h.rpcs).toEqual([]);
    fireEvent.change(within(form).getByLabelText("Client or Internal"), { target: { value: "__internal__" } });
    fireEvent.change(within(form).getByLabelText("Category"), { target: { value: "Admin" } });
    fireEvent.change(within(form).getByLabelText("Description"), { target: { value: " Payroll " } });
    fireEvent.click(within(form).getByRole("button", { name: "Start timer" }));
    await waitFor(() =>
      expect(h.rpcs.find((r) => r.fn === "time_start_timer")?.args).toEqual({
        p_task_id: null,
        p_client_slug: null,
        p_internal: true,
        p_category: "Admin",
        p_description: "Payroll",
      }),
    );
  });

  it("shows an overlap error from the database in plain words", async () => {
    h.writeError = { message: 'conflicting key value violates exclusion constraint "time_entries_no_overlap"' };
    renderWith(<TimeLogPage />, WEEK);
    await screen.findAllByTestId("time-entry");
    fireEvent.click(screen.getByTestId("time-add"));
    const form = screen.getByTestId("time-entry-form");
    fireEvent.change(within(form).getByLabelText("Task"), { target: { value: "t2" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add entry" }));
    expect((await within(form).findByRole("alert")).textContent).toBe(
      "This time overlaps another of your entries. Change the start or end so they do not overlap.",
    );
    expect(screen.getByTestId("time-entry-form")).toBeTruthy();
  });
});
