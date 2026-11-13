/**
 * The status picker in the task side panel offers the statuses of the task's own ClickUp list
 * (os_task_status_options), in that order and with ClickUp's names, including statuses the app's
 * own workflow does not have (here "Filming"). Choosing one updates the task with the status key;
 * a refusal puts the old value back and says so. Read-only tasks and tasks with no options get no
 * picker.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({
  options: [] as unknown,
  rpcs: [] as Array<{ fn: string; args: unknown }>,
  writes: [] as Array<{ table: string; values: unknown; filter?: string }>,
  updateError: null as null | { message: string },
}));

vi.mock("@/integrations/supabase/client", () => {
  const chain = (result: () => unknown, write?: { filter?: string }): Record<string, unknown> => {
    const b: Record<string, unknown> = {
      eq: (c: string, v: string) => {
        if (write) write.filter = `${c}=${v}`;
        return b;
      },
      order: () => b,
      maybeSingle: () => chain(() => ({ data: null, error: null })),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
    };
    return b;
  };
  return {
    supabase: {
      from: (table: string) => ({
        select: () => chain(() => ({ data: [], error: null })),
        update: (values: unknown) => {
          const w = { table, values } as { table: string; values: unknown; filter?: string };
          h.writes.push(w);
          return chain(() => ({ data: null, error: h.updateError }), w);
        },
      }),
      rpc: (fn: string, args: unknown) => {
        h.rpcs.push({ fn, args });
        if (fn === "os_task_status_options") return Promise.resolve({ data: h.options, error: null });
        return Promise.resolve({ data: [], error: null });
      },
    },
  };
});
vi.mock("@/hooks/useMyWork", () => ({
  useIsPhone: () => false,
  useTaskDetail: () => ({ data: { detail: null, comments: [], history: [] }, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useTimer", () => ({ useTaskTimer: () => ({ runningTaskId: null, toggle: vi.fn() }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/employee" }));
vi.mock("@/features/cut-review/CutReview", () => ({ CutReview: () => null }));

import { TaskSidePanel } from "@/features/home/TaskSidePanel";
import type { MyTaskRow } from "@/lib/myWork";
import { toStatusOptions } from "@/hooks/useTaskStatuses";

const LIST_STATUSES = [
  { status: "ready to shoot", name: "READY TO SHOOT", color: "#aaa", type: "open", stage: "Production", order_index: 10 },
  { status: "filming", name: "Filming", color: "#f00", type: "custom", stage: "Production", order_index: 20 },
  { status: "editing", name: "Editing", color: "#0f0", type: "custom", stage: "Editing", order_index: 30 },
  { status: "complete", name: "Complete", color: "#00f", type: "closed", stage: "Ready to Launch", order_index: 40 },
];

const baseTask = {
  id: "t1",
  title: "Write-back test task",
  client_slug: null,
  status: "editing",
  due_date: null,
  is_stuck: false,
  read_only: false,
  strategist_id: null,
  producer_id: null,
  editor_id: null,
  client: null,
  status_info: { stage: "Editing" },
} as unknown as MyTaskRow;

function renderPanel(task: MyTaskRow = baseTask) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TaskSidePanel task={task} today="2026-11-13" onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.options = LIST_STATUSES;
  h.rpcs = [];
  h.writes = [];
  h.updateError = null;
});

describe("task side panel status picker", () => {
  it("offers the task's own list statuses in ClickUp order, with ClickUp's names", async () => {
    renderPanel();
    const picker = await screen.findByTestId("task-panel-status");
    const select = within(picker).getByLabelText("Status") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => [o.value, o.textContent])).toEqual([
      ["ready to shoot", "READY TO SHOOT"],
      ["filming", "Filming"],
      ["editing", "Editing"],
      ["complete", "Complete"],
    ]);
    expect(select.value).toBe("editing");
    expect(h.rpcs).toContainEqual({ fn: "os_task_status_options", args: { p_task_id: "t1" } });
  });

  it("sets a status the app's own workflow does not have (filming)", async () => {
    renderPanel();
    const select = (await screen.findByLabelText("Status")) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "filming" } });
    await waitFor(() => expect(h.writes).toContainEqual({ table: "os_tasks", values: { status: "filming" }, filter: "id=t1" }));
    expect(select.value).toBe("filming");
  });

  it("a refused change puts the old status back and says why", async () => {
    h.updateError = { message: 'the status "filming" is not a status of this task\'s ClickUp list' };
    renderPanel();
    const select = (await screen.findByLabelText("Status")) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "filming" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not change the status");
    expect(select.value).toBe("editing");
  });

  it("a status no longer on the list still shows, but cannot be picked again", async () => {
    renderPanel({ ...baseTask, status: "old status" } as MyTaskRow);
    const select = (await screen.findByLabelText("Status")) as HTMLSelectElement;
    expect(select.value).toBe("old status");
    expect((select.options[0] as HTMLOptionElement).disabled).toBe(true);
    expect(select.options).toHaveLength(5);
  });

  it("read-only tasks get no picker and no request", async () => {
    renderPanel({ ...baseTask, read_only: true } as MyTaskRow);
    await screen.findByTestId("task-panel");
    expect(screen.queryByTestId("task-panel-status")).not.toBeInTheDocument();
    expect(h.rpcs.filter((r) => r.fn === "os_task_status_options")).toEqual([]);
  });

  it("no options (for example a client, who gets none) means no picker", async () => {
    h.options = [];
    renderPanel();
    await waitFor(() => expect(h.rpcs.some((r) => r.fn === "os_task_status_options")).toBe(true));
    expect(screen.queryByTestId("task-panel-status")).not.toBeInTheDocument();
  });

  it("drops malformed rows", () => {
    expect(toStatusOptions(2)).toEqual([]);
    expect(toStatusOptions([{ id: "c1", body: "a comment" }, { status: "editing" }, { status: "editing" }])).toEqual([
      { status: "editing", name: "editing", color: null, type: null, stage: null },
    ]);
  });
});
