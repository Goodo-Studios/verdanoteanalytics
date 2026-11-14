/**
 * The task modal shows everything ClickUp holds for a task and edits it in place: the brief (the
 * ClickUp description), due date, start date, priority, strategist / producer / editor, and every
 * ClickUp custom field (drop-down, link, text, number, date, checkbox edited; people shown as text).
 * Each field has its own Save button, says "Saved" or shows the error, and a read-only task shows
 * the values with no inputs. The existing sections stay. ClickUp is never called: the app only
 * writes to os_tasks and calls os_set_task_field; the database queues the write-back (off).
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({
  detail: null as unknown,
  staff: [] as unknown[],
  rpcs: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  writes: [] as Array<{ table: string; values: Record<string, unknown>; filter?: string }>,
  updateError: null as null | { message: string },
  rpcError: null as null | { message: string },
}));

vi.mock("@/integrations/supabase/client", () => {
  const chain = (result: () => unknown, write?: { filter?: string }): Record<string, unknown> => {
    const b: Record<string, unknown> = {
      eq: (c: string, v: string) => {
        if (write) write.filter = `${c}=${v}`;
        return b;
      },
      not: () => b,
      order: () => b,
      maybeSingle: () => chain(() => ({ data: null, error: null })),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
    };
    return b;
  };
  return {
    supabase: {
      from: (table: string) => ({
        select: () => chain(() => ({ data: table === "app_users" ? h.staff : [], error: null })),
        update: (values: Record<string, unknown>) => {
          const w = { table, values } as { table: string; values: Record<string, unknown>; filter?: string };
          h.writes.push(w);
          return chain(() => ({ data: null, error: h.updateError }), w);
        },
      }),
      rpc: (fn: string, args: Record<string, unknown>) => {
        h.rpcs.push({ fn, args });
        if (fn === "os_set_task_field") return Promise.resolve({ data: null, error: h.rpcError });
        if (fn === "os_task_status_options") return Promise.resolve({ data: [], error: null });
        return Promise.resolve({ data: [], error: null });
      },
    },
  };
});
vi.mock("@/hooks/useMyWork", () => ({
  useIsPhone: () => false,
  useTaskDetail: () => ({
    data: { detail: h.detail, comments: [], history: [{ id: 1, from_status: null, to_status: "editing", changed_at: "2026-12-01T10:00:00Z" }] },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/hooks/useTimer", () => ({ useTaskTimer: () => ({ runningTaskId: null, toggle: vi.fn() }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/employee" }));
vi.mock("@/features/cut-review/CutReview", () => ({ CutReview: () => <div>cut review</div> }));

import { TaskSidePanel } from "@/features/home/TaskSidePanel";
import type { MyTaskRow } from "@/lib/myWork";

const TYPE_ID = "f58bc404-0076-4b16-8950-1fce77e04b2a";
const LINK_ID = "43b89e72-8575-49e6-bf6a-fc90f373291c";

const FIELDS = [
  { id: TYPE_ID, name: "Type of Content", type: "drop_down", display: "Hook", options: [{ id: "o1", name: "Hook" }, { id: "o2", name: "UGC" }] },
  { id: LINK_ID, name: "Link to Asset", type: "url", display: "https://files.example.test/a" },
  { id: "hook1", name: "Goodo Ad Name Hook 1", type: "short_text", display: "First hook" },
  { id: "due", name: "Brief due", type: "date", display: "2026-12-05" },
  { id: "rush", name: "Rush", type: "checkbox", display: "false" },
  { id: "budget", name: "Budget", type: "number", display: "5" },
  { id: "rev", name: "Reviewed By", type: "users", display: "sam@example.test" },
];

const DETAIL = {
  id: "t1",
  brief: null,
  description: "Plain brief",
  description_markdown: "**ClickUp** brief",
  asset_url: null,
  clickup_url: "https://app.clickup.com/t/abc",
  hooks: ["First hook"],
  qa_checklist: [{ item: "Overall Polish", result: "PASS" }],
  stuck_reason: null,
  content_type: "Hook",
  clickup_task_id: "abc",
  due_date: "2026-12-10",
  start_date: "2026-12-03",
  priority: "normal",
  strategist_id: "u-sam",
  producer_id: null,
  editor_id: "u-gone",
  raw_status: "Editing",
  clickup_list_name: "Bearaby Project View",
  assignees: [{ id: "11", username: "Pat Editor", email: "pat@example.test" }],
  clickup_tags: ["gifting", "q4"],
  clickup_created_at: "2026-11-01T12:00:00Z",
  clickup_creator: { username: "Pat Strategist", email: "pat.s@example.test" },
  time_estimate_ms: 5_400_000,
  clickup_fields: FIELDS,
};

const STAFF = [
  { auth_user_id: "u-sam", name: "Sam Strategist", email: "sam@example.test", active: true },
  { auth_user_id: "u-ava", name: "Ava Producer", email: "ava@example.test", active: true },
];

const baseTask = {
  id: "t1",
  title: "December Asset 1",
  client_slug: "bearaby",
  status: "editing",
  due_date: "2026-12-10",
  is_stuck: false,
  read_only: false,
  strategist_id: "u-sam",
  producer_id: null,
  editor_id: "u-gone",
  client: { name: "Bearaby" },
  status_info: { stage: "Editing" },
} as unknown as MyTaskRow;

function renderPanel(task: MyTaskRow = baseTask) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TaskSidePanel task={task} today="2026-12-01" onClose={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const row = (id: string) => screen.getByTestId(id);
const saveIn = (id: string) => within(row(id)).getByRole("button", { name: /^Save$/ });

beforeEach(() => {
  h.detail = { ...DETAIL };
  h.staff = STAFF;
  h.rpcs = [];
  h.writes = [];
  h.updateError = null;
  h.rpcError = null;
});

describe("what the modal shows", () => {
  it("shows the ClickUp description, the details and every custom field", async () => {
    renderPanel();
    expect(screen.getByLabelText("Brief")).toHaveValue("**ClickUp** brief");
    expect(screen.getByLabelText("Due date")).toHaveValue("2026-12-10");
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-12-03");
    expect(screen.getByLabelText("Priority")).toHaveValue("normal");
    await waitFor(() => expect(screen.getByLabelText("Strategist")).toHaveValue("u-sam"));
    expect(screen.getByLabelText("Producer")).toHaveValue("");
    expect(screen.getByLabelText("Editor")).toHaveValue("u-gone");
    expect(within(row("task-field-assignees")).getByText("Pat Editor")).toBeInTheDocument();
    expect(within(row("task-field-tags")).getByText("gifting, q4")).toBeInTheDocument();
    expect(within(row("task-field-list")).getByText("Bearaby Project View")).toBeInTheDocument();
    expect(within(row("task-field-raw-status")).getByText("Editing")).toBeInTheDocument();
    expect(within(row("task-field-creator")).getByText("Pat Strategist")).toBeInTheDocument();
    expect(within(row("task-field-estimate")).getByText("1h 30m")).toBeInTheDocument();

    expect(screen.getByLabelText("Type of Content")).toHaveValue("Hook");
    expect(screen.getByLabelText("Link to Asset")).toHaveValue("https://files.example.test/a");
    expect(screen.getByLabelText("Goodo Ad Name Hook 1")).toHaveValue("First hook");
    expect(screen.getByLabelText("Brief due")).toHaveValue("2026-12-05");
    expect(screen.getByLabelText("Rush")).not.toBeChecked();
    expect(screen.getByLabelText("Budget")).toHaveValue(5);
    // A people field is shown as text, not as an input.
    expect(within(row("task-cf-rev")).getByText("sam@example.test")).toBeInTheDocument();
    expect(screen.queryByLabelText("Reviewed By")).toBeNull();
  });

  it("keeps the sections that were there before", () => {
    renderPanel();
    for (const id of ["task-panel-versions", "task-panel-comments", "task-panel-qa", "task-panel-history", "task-panel-files"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByText("Overall Polish")).toBeInTheDocument();
    expect(screen.getByText("editing")).toBeInTheDocument();
  });

  it("says so when no ClickUp fields are stored yet, and still lists the hooks", () => {
    h.detail = { ...DETAIL, clickup_fields: [] };
    renderPanel();
    expect(screen.getByText(/No ClickUp fields stored for this task yet/)).toBeInTheDocument();
    expect(within(row("task-panel-brief")).getByText("First hook")).toBeInTheDocument();
  });

  it("shows no Save button until a value changes", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: /^Save$/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Budget"), { target: { value: "6" } });
    expect(saveIn("task-cf-budget")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Budget"), { target: { value: "5" } });
    expect(screen.queryByRole("button", { name: /^Save$/ })).toBeNull();
  });
});

describe("editing the brief and the details", () => {
  it("saves the brief to both forms of the ClickUp description and says Saved", async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Brief"), { target: { value: "A new brief" } });
    fireEvent.click(saveIn("task-panel-brief-editor"));
    expect(await within(row("task-panel-brief-editor")).findByText("Saved")).toBeInTheDocument();
    expect(h.writes).toEqual([{ table: "os_tasks", values: { description_markdown: "A new brief", description: "A new brief" }, filter: "id=t1" }]);
    expect(screen.queryByRole("button", { name: /^Save$/ })).toBeNull();
  });

  it("saves the brief of a task made in the app to its own brief column", async () => {
    h.detail = { ...DETAIL, clickup_task_id: null, brief: "App brief", description_markdown: null, description: null, clickup_fields: [] };
    renderPanel();
    expect(screen.getByLabelText("Brief")).toHaveValue("App brief");
    fireEvent.change(screen.getByLabelText("Brief"), { target: { value: "Changed" } });
    fireEvent.click(saveIn("task-panel-brief-editor"));
    await within(row("task-panel-brief-editor")).findByText("Saved");
    expect(h.writes[0].values).toEqual({ brief: "Changed" });
  });

  it("clearing the brief writes nulls", async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Brief"), { target: { value: "" } });
    fireEvent.click(saveIn("task-panel-brief-editor"));
    await within(row("task-panel-brief-editor")).findByText("Saved");
    expect(h.writes[0].values).toEqual({ description_markdown: null, description: null });
  });

  it("saves the due date, start date and priority; clearing a date writes null", async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-12-20" } });
    fireEvent.click(saveIn("task-field-due"));
    await within(row("task-field-due")).findByText("Saved");
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "" } });
    fireEvent.click(saveIn("task-field-start"));
    await within(row("task-field-start")).findByText("Saved");
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "urgent" } });
    fireEvent.click(saveIn("task-field-priority"));
    await within(row("task-field-priority")).findByText("Saved");
    expect(h.writes.map((w) => w.values)).toEqual([{ due_date: "2026-12-20" }, { start_date: null }, { priority: "urgent" }]);
    expect(h.writes.every((w) => w.table === "os_tasks" && w.filter === "id=t1")).toBe(true);
  });

  it("offers the active staff for the three roles and saves the login id", async () => {
    renderPanel();
    await waitFor(() => expect(within(screen.getByLabelText("Producer")).getByText("Ava Producer")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Producer"), { target: { value: "u-ava" } });
    fireEvent.click(saveIn("task-field-producer"));
    await within(row("task-field-producer")).findByText("Saved");
    fireEvent.change(screen.getByLabelText("Strategist"), { target: { value: "" } });
    fireEvent.click(saveIn("task-field-strategist"));
    await within(row("task-field-strategist")).findByText("Saved");
    expect(h.writes.map((w) => w.values)).toEqual([{ producer_id: "u-ava" }, { strategist_id: null }]);
  });

  it("shows the error and no Saved message when the save is refused", async () => {
    h.updateError = { message: "new row violates row-level security policy" };
    renderPanel();
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-12-20" } });
    fireEvent.click(saveIn("task-field-due"));
    const alert = await within(row("task-field-due")).findByRole("alert");
    expect(alert).toHaveTextContent("Could not save due date: new row violates row-level security policy");
    expect(within(row("task-field-due")).queryByText("Saved")).toBeNull();
    expect(saveIn("task-field-due")).toBeEnabled();
  });
});

describe("editing ClickUp fields", () => {
  it("saves a drop-down choice by its name through os_set_task_field", async () => {
    renderPanel();
    expect(within(screen.getByLabelText("Type of Content")).getAllByRole("option").map((o) => o.textContent)).toEqual(["None", "Hook", "UGC"]);
    fireEvent.change(screen.getByLabelText("Type of Content"), { target: { value: "UGC" } });
    fireEvent.click(saveIn(`task-cf-${TYPE_ID}`));
    await within(row(`task-cf-${TYPE_ID}`)).findByText("Saved");
    expect(h.rpcs.filter((r) => r.fn === "os_set_task_field")).toEqual([
      { fn: "os_set_task_field", args: { p_task_id: "t1", p_field_id: TYPE_ID, p_value: "UGC" } },
    ]);
    expect(h.writes).toEqual([]);
  });

  it("saves a link, a hook text, a date, a number and a checkbox", async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Link to Asset"), { target: { value: "https://files.example.test/b" } });
    fireEvent.click(saveIn(`task-cf-${LINK_ID}`));
    await within(row(`task-cf-${LINK_ID}`)).findByText("Saved");
    fireEvent.change(screen.getByLabelText("Goodo Ad Name Hook 1"), { target: { value: "Second hook" } });
    fireEvent.click(saveIn("task-cf-hook1"));
    await within(row("task-cf-hook1")).findByText("Saved");
    fireEvent.change(screen.getByLabelText("Brief due"), { target: { value: "2026-12-12" } });
    fireEvent.click(saveIn("task-cf-due"));
    await within(row("task-cf-due")).findByText("Saved");
    fireEvent.change(screen.getByLabelText("Budget"), { target: { value: "7.5" } });
    fireEvent.click(saveIn("task-cf-budget"));
    await within(row("task-cf-budget")).findByText("Saved");
    fireEvent.click(screen.getByLabelText("Rush"));
    fireEvent.click(saveIn("task-cf-rush"));
    await within(row("task-cf-rush")).findByText("Saved");
    expect(h.rpcs.filter((r) => r.fn === "os_set_task_field").map((r) => [r.args.p_field_id, r.args.p_value])).toEqual([
      [LINK_ID, "https://files.example.test/b"],
      ["hook1", "Second hook"],
      ["due", "2026-12-12"],
      ["budget", "7.5"],
      ["rush", "true"],
    ]);
  });

  it("clearing a field sends an empty value", async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Goodo Ad Name Hook 1"), { target: { value: "" } });
    fireEvent.click(saveIn("task-cf-hook1"));
    await within(row("task-cf-hook1")).findByText("Saved");
    expect(h.rpcs.find((r) => r.fn === "os_set_task_field")!.args).toEqual({ p_task_id: "t1", p_field_id: "hook1", p_value: "" });
  });

  it("shows the database's refusal on that field only", async () => {
    h.rpcError = { message: "Podcast is not a choice of this field" };
    renderPanel();
    fireEvent.change(screen.getByLabelText("Type of Content"), { target: { value: "UGC" } });
    fireEvent.click(saveIn(`task-cf-${TYPE_ID}`));
    const alert = await within(row(`task-cf-${TYPE_ID}`)).findByRole("alert");
    expect(alert).toHaveTextContent("Could not save type of content: Podcast is not a choice of this field");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});

describe("a read-only task (an ended client)", () => {
  it("shows every value as text with no inputs and no Save buttons", () => {
    renderPanel({ ...baseTask, read_only: true } as MyTaskRow);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Save$/ })).toBeNull();
    expect(within(row("task-panel-brief")).getByText("**ClickUp** brief")).toBeInTheDocument();
    expect(within(row("task-field-priority")).getByText("Normal")).toBeInTheDocument();
    expect(within(row("task-field-due")).getByText("2026-12-10")).toBeInTheDocument();
    expect(within(row(`task-cf-${TYPE_ID}`)).getByText("Hook")).toBeInTheDocument();
    expect(within(row("task-cf-rush")).getByText("No")).toBeInTheDocument();
    expect(within(row(`task-cf-${LINK_ID}`)).getByRole("link")).toHaveAttribute("href", "https://files.example.test/a");
    expect(h.writes).toEqual([]);
    expect(h.rpcs.filter((r) => r.fn === "os_set_task_field")).toEqual([]);
  });

  it("shows the app brief message when a read-only task has none", () => {
    h.detail = { ...DETAIL, description: null, description_markdown: null };
    renderPanel({ ...baseTask, read_only: true } as MyTaskRow);
    expect(screen.getByText("No brief yet.")).toBeInTheDocument();
  });
});
