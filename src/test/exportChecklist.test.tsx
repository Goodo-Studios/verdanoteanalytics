/**
 * OS-023 export checklist in the task side panel. Switch off (as now): the export status shows
 * unchanged and there is no checklist and no checklist request. Switch on: the export status
 * shows as "exporting", the checklist loads, staff start it, tick an item, add one and remove one.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({
  setting: null as unknown,
  items: [] as Array<{ id: string; label: string; position: number; done: boolean; done_at: string | null }>,
  reads: [] as string[],
  writes: [] as Array<{ table: string; op: string; values?: unknown; filter?: string }>,
  rpcs: [] as Array<{ fn: string; args: unknown }>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const read = (table: string, single: boolean) => {
    if (table === "os_settings") return { data: single ? h.setting : [], error: null };
    if (table === "os_task_checklist_items") return { data: h.items, error: null };
    return { data: single ? null : [], error: null };
  };
  const chain = (table: string, done: () => unknown, single = false, write?: { filter?: string }): Record<string, unknown> => {
    const b: Record<string, unknown> = {
      eq: (c: string, v: string) => {
        if (write) write.filter = `${c}=${v}`;
        return b;
      },
      order: () => b,
      maybeSingle: () => chain(table, () => read(table, true), true),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(single ? read(table, true) : done()).then(res, rej),
    };
    return b;
  };
  return {
    supabase: {
      from: (table: string) => ({
        select: () => (h.reads.push(table), chain(table, () => read(table, false))),
        update: (values: unknown) => {
          const w = { table, op: "update", values } as { table: string; op: string; values?: unknown; filter?: string };
          h.writes.push(w);
          return chain(table, () => ({ data: null, error: null }), false, w);
        },
        insert: (values: unknown) => (h.writes.push({ table, op: "insert", values }), Promise.resolve({ data: null, error: null })),
        delete: () => {
          const w = { table, op: "delete" } as { table: string; op: string; filter?: string };
          h.writes.push(w);
          return chain(table, () => ({ data: null, error: null }), false, w);
        },
      }),
      rpc: (fn: string, args: unknown) => {
        h.rpcs.push({ fn, args });
        if (fn === "os_task_checklist_start") {
          h.items = [
            { id: "i1", label: "Export every version and size", position: 10, done: false, done_at: null },
            { id: "i2", label: "Check and upload the exports", position: 20, done: false, done_at: null },
          ];
        }
        return Promise.resolve({ data: 2, error: null });
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
import { displayStatus, isExportStatus } from "@/lib/exportChecklist";

const task = {
  id: "t1",
  title: "Glow hook test",
  client_slug: "glow",
  status: "export versions",
  due_date: null,
  is_stuck: false,
  read_only: false,
  strategist_id: null,
  producer_id: null,
  editor_id: null,
  client: { name: "Glow Drip" },
  status_info: { stage: "Editing" },
} as unknown as MyTaskRow;

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TaskSidePanel task={task} today="2026-11-13" onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.setting = null;
  h.items = [];
  h.reads = [];
  h.writes = [];
  h.rpcs = [];
});

describe("export status helpers", () => {
  it("knows the four export statuses and leaves the rest alone", () => {
    for (const s of ["export versions", "versions exported", "ready to send to client", "ready to transfer"]) expect(isExportStatus(s)).toBe(true);
    expect(isExportStatus("editing")).toBe(false);
    expect(displayStatus("export versions", false)).toBe("export versions");
    expect(displayStatus("export versions", true)).toBe("exporting");
    expect(displayStatus("editing", true)).toBe("editing");
  });
});

describe("task side panel export checklist", () => {
  it("switch off: the export status shows as now and there is no checklist", async () => {
    h.setting = { value: false };
    renderPanel();
    await waitFor(() => expect(h.reads).toContain("os_settings"));
    expect(screen.getByText(/· export versions ·/)).toBeInTheDocument();
    expect(screen.queryByTestId("task-panel-export-checklist")).not.toBeInTheDocument();
    expect(h.reads).not.toContain("os_task_checklist_items");
  });

  it("no setting row counts as off", async () => {
    renderPanel();
    await waitFor(() => expect(h.reads).toContain("os_settings"));
    expect(screen.getByText(/· export versions ·/)).toBeInTheDocument();
    expect(screen.queryByTestId("task-panel-export-checklist")).not.toBeInTheDocument();
  });

  it("switch on: the checklist stands in for the export status and staff can edit it", async () => {
    h.setting = { value: true };
    renderPanel();
    expect(await screen.findByTestId("task-panel-export-checklist")).toBeInTheDocument();
    expect(screen.getByText(/· exporting ·/)).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Start the export checklist" }));
    await waitFor(() => expect(h.rpcs).toContainEqual({ fn: "os_task_checklist_start", args: { p_task_id: "t1" } }));
    const box = await screen.findByRole("checkbox", { name: "Export every version and size" });

    fireEvent.click(box);
    await waitFor(() =>
      expect(h.writes).toContainEqual({ table: "os_task_checklist_items", op: "update", values: { done: true }, filter: "id=i1" }),
    );

    fireEvent.change(screen.getByLabelText("New checklist item"), { target: { value: "Square cut" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(h.writes).toContainEqual({ table: "os_task_checklist_items", op: "insert", values: { task_id: "t1", label: "Square cut", position: 30 } }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove Check and upload the exports" }));
    await waitFor(() => expect(h.writes).toContainEqual({ table: "os_task_checklist_items", op: "delete", filter: "id=i2" }));
  });
});
