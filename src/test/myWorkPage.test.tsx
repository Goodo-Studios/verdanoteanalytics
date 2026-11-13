/**
 * My work page (OS-009): one request filtered to the person, row content (title, client, phase
 * dots, due date), late dates in red, grouping by due date, client and phase filters, the empty
 * state, the side panel (brief, file link, both comment threads, QA checklist, status history),
 * Escape closing it, the bottom sheet at phone width, and 1,000 rows rendering well under a second.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const USER = "11111111-1111-4111-8111-111111111111";

type Call = { table: string; columns: string; filters: string[] };
const h = vi.hoisted(() => ({
  tasks: [] as unknown[],
  tasksError: null as null | { message: string },
  detail: null as unknown,
  comments: [] as unknown[],
  history: [] as unknown[],
  versions: [] as unknown[],
  versionComments: [] as unknown[],
  calls: [] as Call[],
  rpcs: [] as Array<{ fn: string; args: unknown }>,
  builder: false,
  running: null as unknown,
  playbook: [] as unknown[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const result = (table: string, single: boolean) => {
    if (table === "os_tasks" && single) return { data: h.detail, error: null };
    if (table === "os_tasks") return { data: h.tasks, error: h.tasksError };
    if (table === "os_task_status_history") return { data: h.history, error: null };
    // OS-020: the cuts of the task.
    if (table === "os_task_versions") return { data: h.versions, error: null };
    // OS-012: the running timer (none unless a test sets one).
    if (table === "time_entries") return { data: single ? h.running : [], error: null };
    return { data: [], error: null };
  };
  const builder = (call: Call, single = false): Record<string, unknown> => {
    const b: Record<string, unknown> = {
      neq: (c: string, v: string) => (call.filters.push(`neq:${c}:${v}`), b),
      eq: (c: string, v: string) => (call.filters.push(`eq:${c}:${v}`), b),
      or: (f: string) => (call.filters.push(`or:${f}`), b),
      is: (c: string, v: unknown) => (call.filters.push(`is:${c}:${String(v)}`), b),
      limit: () => b,
      order: () => b,
      maybeSingle: () => builder(call, true),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result(call.table, single)).then(res, rej),
    };
    return b;
  };
  return {
    supabase: {
      from: (table: string) => ({
        select: (columns: string) => {
          const call = { table, columns, filters: [] as string[] };
          h.calls.push(call);
          return builder(call);
        },
      }),
      rpc: (fn: string, args: unknown) => {
        h.rpcs.push({ fn, args });
        if (fn === "list_task_version_comments") return Promise.resolve({ data: h.versionComments, error: null });
        // OS-026: the playbook section for the task's content type.
        if (fn === "brain_playbook_for_content_type") return Promise.resolve({ data: h.playbook, error: null });
        return Promise.resolve({ data: h.comments, error: null });
      },
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: USER }, isBuilder: h.builder, isEmployee: !h.builder, isClient: false }),
}));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/employee" }));

import MyWorkPage from "@/features/home/MyWorkPage";
import { addDaysIso, todayIso } from "@/lib/homeData";

const day = (n: number) => addDaysIso(todayIso(), n);
const mk = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Task ${id}`,
  client_slug: "glow",
  status: "editing",
  due_date: day(2),
  is_stuck: false,
  read_only: false,
  strategist_id: USER,
  producer_id: null,
  editor_id: null,
  client: { name: "Glow Drip" },
  status_info: { stage: "Editing" },
  ...over,
});

function renderPage(url = "/employee/my-work") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <MyWorkPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const originalWidth = window.innerWidth;
beforeEach(() => {
  h.tasks = [
    mk("late", { due_date: day(-3), client_slug: "bloom", client: { name: "Bloom" }, status_info: { stage: "Production" } }),
    mk("today", { due_date: day(0) }),
    mk("week", { due_date: day(3), status_info: { stage: "Client Review" } }),
    mk("later", { due_date: day(30), status_info: { stage: "Other" } }),
    mk("nodate", { due_date: null }),
  ];
  h.tasksError = null;
  h.detail = {
    id: "today",
    brief: "Film the unboxing in daylight.",
    description: null,
    asset_url: "https://drive.example.test/folder",
    clickup_url: "https://app.clickup.com/t/abc",
    hooks: ["Hook one"],
    qa_checklist: [{ item: "Captions spelled right", result: "Pass" }],
    stuck_reason: null,
  };
  h.comments = [
    { id: 1, thread: "internal", body: "Internal note here", author: { username: "Sam" }, created_at: "2026-11-10T10:00:00Z", from_clickup: true },
    { id: 2, thread: "client", body: "Client asks for a shorter cut", author: { name: "Pat" }, created_at: "2026-11-11T10:00:00Z", from_clickup: false },
  ];
  h.versions = [];
  h.versionComments = [];
  h.playbook = [];
  h.history = [
    { id: 10, from_status: null, to_status: "assigned", changed_at: "2026-11-01T10:00:00Z" },
    { id: 11, from_status: "assigned", to_status: "editing", changed_at: "2026-11-05T10:00:00Z" },
  ];
  h.calls = [];
  h.rpcs = [];
  h.builder = false;
  h.running = null;
});
afterEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: originalWidth });
});

describe("My work list", () => {
  it("fetches once, filtered to the person on the server, without the brief", async () => {
    renderPage();
    await screen.findAllByTestId("my-task-row");
    const listCalls = h.calls.filter((c) => c.table === "os_tasks");
    expect(listCalls).toHaveLength(1);
    expect(listCalls[0].filters).toContain(`or:strategist_id.eq.${USER},producer_id.eq.${USER},editor_id.eq.${USER}`);
    expect(listCalls[0].filters).toContain("neq:status:complete");
    // Ended clients' read-only history is not work to do.
    expect(listCalls[0].filters).toContain("eq:read_only:false");
    expect(listCalls[0].columns).not.toMatch(/brief|description/);
    // Details are not loaded until a row opens.
    expect(h.rpcs).toHaveLength(0);
    expect(h.calls.some((c) => c.table === "os_task_status_history")).toBe(false);
  });

  it("shows title, client, a phase marker and the due date on one row", async () => {
    renderPage();
    const group = await screen.findByTestId("my-work-group-week");
    const row = within(group).getByTestId("my-task-row");
    expect(within(row).getByTestId("my-task-title")).toHaveTextContent("Task week");
    expect(within(row).getByTestId("my-task-client")).toHaveTextContent("Glow Drip");
    expect(within(row).getByRole("img", { name: "Phase 4 of 5: Client Review" })).toBeInTheDocument();
    // Four filled dots and one empty one.
    const dots = within(row).getByTestId("phase-dots");
    expect(dots.querySelector("[data-filled-count]")?.textContent).toBe("●".repeat(4));
    expect(dots.textContent).toBe("●".repeat(5));
    expect(within(row).getByTestId("my-task-due").textContent).not.toBe("No date");
  });

  it("shows no dots for an Other status", async () => {
    renderPage();
    const group = await screen.findByTestId("my-work-group-later");
    expect(within(group).getByRole("img", { name: "No phase" })).toHaveAttribute("data-phase", "0");
  });

  it("colours only late dates red", async () => {
    renderPage();
    const late = within(await screen.findByTestId("my-work-group-overdue")).getByTestId("my-task-due");
    const onTime = within(screen.getByTestId("my-work-group-today")).getByTestId("my-task-due");
    expect(late.className).toContain("text-[var(--gos-late)]");
    expect(onTime.className).not.toContain("gos-late");
    expect(screen.getAllByTestId("my-task-row").filter((r) => r.dataset.late === "true")).toHaveLength(1);
  });

  it("groups by due date in order", async () => {
    renderPage();
    await screen.findAllByTestId("my-task-row");
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h2) => h2.textContent);
    expect(headings).toEqual(["Overdue (1)", "Today (1)", "This week (1)", "Later (1)", "No date (1)"]);
  });

  it("filters by client and by phase", async () => {
    renderPage();
    await screen.findAllByTestId("my-task-row");
    fireEvent.change(screen.getByTestId("my-work-filter-client"), { target: { value: "bloom" } });
    expect(screen.getAllByTestId("my-task-row").map((r) => r.textContent)).toEqual([expect.stringContaining("Task late")]);
    fireEvent.change(screen.getByTestId("my-work-filter-client"), { target: { value: "" } });
    fireEvent.change(screen.getByTestId("my-work-filter-phase"), { target: { value: "Editing" } });
    expect(screen.getAllByTestId("my-task-title").map((t) => t.textContent)).toEqual(["Task today", "Task nodate"]);
    fireEvent.change(screen.getByTestId("my-work-filter-phase"), { target: { value: "Ready to Launch" } });
    expect(screen.getByTestId("my-work-empty-filtered")).toBeInTheDocument();
  });

  it("shows the empty state when nothing is assigned", async () => {
    h.tasks = [];
    renderPage();
    expect(await screen.findByText("No tasks assigned to you")).toBeInTheDocument();
  });

  it("shows an error, not the empty state, when the list fails", async () => {
    h.tasksError = { message: "boom" };
    renderPage();
    expect(await screen.findByTestId("my-work-error")).toBeInTheDocument();
    expect(screen.queryByTestId("my-work-empty")).toBeNull();
  });

  it("gives a builder an Everyone switch that drops the person filter", async () => {
    h.builder = true;
    renderPage("/builder/my-work?everyone=1");
    await screen.findAllByTestId("my-task-row");
    const listCall = h.calls.find((c) => c.table === "os_tasks")!;
    expect(listCall.filters.some((f) => f.startsWith("or:"))).toBe(false);
    expect(screen.getByTestId("my-work-everyone")).toBeChecked();
  });

  it("hides the Everyone switch from an employee and ignores ?everyone=1", async () => {
    renderPage("/employee/my-work?everyone=1");
    await screen.findAllByTestId("my-task-row");
    expect(screen.queryByTestId("my-work-everyone")).toBeNull();
    expect(h.calls.find((c) => c.table === "os_tasks")!.filters.some((f) => f.startsWith("or:"))).toBe(true);
  });
});

describe("task side panel", () => {
  async function openToday() {
    renderPage();
    const group = await screen.findByTestId("my-work-group-today");
    fireEvent.click(within(group).getByTestId("my-task-row"));
    return screen.findByRole("dialog", { name: "Task today" });
  }

  it("opens on the same page and shows brief, file link, both threads, QA list and history", async () => {
    const panel = await openToday();
    expect(screen.getByTestId("my-work-page")).toBeInTheDocument();
    await within(panel).findByText("Film the unboxing in daylight.");
    expect(within(panel).getByText("Hook one")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: /Open the asset/ })).toHaveAttribute("href", "https://drive.example.test/folder");
    expect(within(within(panel).getByTestId("task-panel-thread-internal")).getByText("Internal note here")).toBeInTheDocument();
    expect(within(within(panel).getByTestId("task-panel-thread-internal")).getByText(/Sam/)).toBeInTheDocument();
    expect(within(within(panel).getByTestId("task-panel-thread-client")).getByText("Client asks for a shorter cut")).toBeInTheDocument();
    expect(within(panel).getByText("Captions spelled right")).toBeInTheDocument();
    expect(within(panel).getByText("Pass")).toBeInTheDocument();
    expect(within(panel).getByText("assigned → editing")).toBeInTheDocument();
    expect(h.rpcs).toEqual([{ fn: "list_task_comments", args: { p_task_id: "today" } }]);
  });

  it("links a task of a mapped content type to its Brain playbook section (OS-026)", async () => {
    h.detail = { ...(h.detail as object), content_type: "Founder Story" };
    h.playbook = [{ section: "Playbooks", slug: "video-playbook", title: "Video playbook", anchor: "founder-story", heading: "Founder Story" }];
    const panel = await openToday();
    const link = await within(panel).findByTestId("task-panel-playbook-link");
    expect(link).toHaveAttribute("href", "/employee/knowledge/brain?section=playbooks&page=video-playbook#founder-story");
    expect(link.textContent).toBe("Video playbook: Founder Story");
    expect(h.rpcs).toContainEqual({ fn: "brain_playbook_for_content_type", args: { p_content_type: "Founder Story" } });
  });

  it("shows a quiet note for a content type with no playbook section, and nothing without a content type (OS-026)", async () => {
    h.detail = { ...(h.detail as object), content_type: "Something new" };
    h.playbook = [];
    const panel = await openToday();
    const section = await within(panel).findByTestId("task-panel-playbook");
    expect(section.textContent).toContain("No playbook section yet.");
    expect(within(panel).queryByTestId("task-panel-playbook-link")).toBeNull();
    // Quiet: muted text, never an alarm colour.
    expect(within(section).getByText("No playbook section yet.").className).toContain("text-muted-foreground");
  });

  it("shows no Playbook section and asks nothing when the task has no content type (OS-026)", async () => {
    const panel = await openToday();
    await within(panel).findByText("Film the unboxing in daylight.");
    expect(within(panel).queryByTestId("task-panel-playbook")).toBeNull();
    expect(h.rpcs.map((r) => r.fn)).not.toContain("brain_playbook_for_content_type");
  });

  it("shows the Versions section with each cut and its internal and client comments (OS-020)", async () => {
    h.versions = [
      { id: "ver-1", version_no: 1, label: null, video_url: "https://cdn.example.test/v1.mp4", created_at: "2026-11-01T10:00:00Z" },
      { id: "ver-2", version_no: 2, label: "Shorter", video_url: "https://cdn.example.test/v2.mp4", created_at: "2026-11-02T10:00:00Z" },
    ];
    h.versionComments = [
      { id: 71, thread: "internal", body: "Trim the intro", timecode_ms: 4000, created_at: "2026-11-02T11:00:00Z", author_user_id: null, author: { name: "Sam" } },
      { id: 72, thread: "client", body: "Music is great", timecode_ms: 9000, created_at: "2026-11-02T12:00:00Z", author_user_id: null, author: {} },
    ];
    const panel = await openToday();
    const versions = await within(panel).findByTestId("task-panel-versions");
    const pills = await within(versions).findAllByTestId("cut-version");
    expect(pills.map((p) => p.textContent)).toEqual([expect.stringContaining("Version 2: Shorter"), expect.stringContaining("Version 1")]);
    await within(versions).findByText("Trim the intro");
    expect(within(versions).getByTestId("cut-internal-label")).toHaveTextContent("Internal");
    expect(within(versions).getByText("Music is great")).toBeInTheDocument();
    expect(within(versions).getByTestId("cut-add-version")).toBeInTheDocument();
    expect(h.rpcs).toContainEqual({ fn: "list_task_version_comments", args: { p_version_id: "ver-2" } });
  });

  it("closes with Escape", async () => {
    const panel = await openToday();
    fireEvent.keyDown(panel, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("is a side panel on a wide screen and a bottom sheet on a phone", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 });
    const wide = await openToday();
    expect(wide).toHaveAttribute("data-variant", "side");
    act(() => {
      Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 375 });
      window.dispatchEvent(new Event("resize"));
    });
    const sheet = screen.getByTestId("task-panel");
    expect(sheet).toHaveAttribute("data-variant", "sheet");
    expect(sheet.className).toContain("task-panel-sheet");
    expect(sheet.className).toContain("bottom-0");
  });
});

describe("speed", () => {
  it("renders 1,000 open tasks well under one second", async () => {
    const clients = ["glow", "bloom", "acme", "zest"];
    const stages = ["Preparing Content", "Production", "Editing", "Client Review", "Ready to Launch", "Other"];
    h.tasks = Array.from({ length: 1000 }, (_, i) =>
      mk(`t${i}`, {
        client_slug: clients[i % 4],
        client: { name: clients[i % 4] },
        status_info: { stage: stages[i % 6] },
        due_date: i % 10 === 0 ? null : day((i % 40) - 10),
      }),
    );
    // Time the page, not the test's own lookups: waitFor re-runs its callback on every DOM change, and
    // a Testing Library query over 1,000 rows is slow on its own. A plain selector count is cheap, so
    // the clock stops when the page has drawn the rows. The full query runs once afterwards.
    const start = performance.now();
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelectorAll('[data-testid="my-task-row"]').length).toBe(1000));
    const ms = performance.now() - start;
    expect(screen.getAllByTestId("my-task-row")).toHaveLength(1000);
    expect(ms).toBeLessThan(1000);
  });
});

describe("timer on rows (OS-012)", () => {
  it("each row has a play button that starts a timer for that task", async () => {
    renderPage();
    const rows = await screen.findAllByTestId("my-task-row");
    const li = rows[1].closest("li")!;
    fireEvent.click(within(li).getByRole("button", { name: "Start a timer on Task today" }));
    await waitFor(() => expect(h.rpcs.find((r) => r.fn === "time_start_timer")?.args).toMatchObject({ p_task_id: "today" }));
    // The play button does not open the side panel.
    expect(screen.queryByTestId("task-panel")).toBeNull();
  });

  it("the row whose task is running shows a stop button that stops it", async () => {
    h.running = { id: "e1", task_id: "week", start_at: new Date().toISOString(), end_at: null };
    renderPage();
    const stop = await screen.findByRole("button", { name: "Stop the timer on Task week" });
    expect(stop.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
    fireEvent.click(stop);
    await waitFor(() => expect(h.rpcs.map((r) => r.fn)).toContain("time_stop_timer"));
  });

  it("the side panel has a play button for its task", async () => {
    renderPage();
    const rows = await screen.findAllByTestId("my-task-row");
    fireEvent.click(rows[1]);
    const panel = await screen.findByTestId("task-panel");
    fireEvent.click(within(panel).getByRole("button", { name: "Start a timer on Task today" }));
    await waitFor(() => expect(h.rpcs.find((r) => r.fn === "time_start_timer")?.args).toMatchObject({ p_task_id: "today" }));
  });
});
