/**
 * Today in the War Room layout (OS-010): leads with one next action and has no table, the progress
 * bar reads "N of M done today" and eases its width, marking an item done slides it away and offers
 * Undo (which puts the old status back), and the builder view lists late items across all clients,
 * decisions waiting and client approvals outstanding. Employees do not get the builder view.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const USER = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({
  mine: [] as unknown[],
  everyone: [] as unknown[],
  doneToday: 0,
  decisions: [] as unknown[],
  builder: false,
  mutations: [] as Array<{ id: string; status: string }>,
  toasts: [] as Array<{ msg: string; opts?: { action?: { label: string; onClick: () => void } } }>,
  runningTaskId: null as string | null,
  toggled: [] as string[],
  brain: [] as unknown[],
  brainError: false,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: USER }, isBuilder: h.builder, isEmployee: !h.builder, isClient: false }),
}));
vi.mock("@/hooks/useMyWork", () => ({
  useMyTasks: (_u: string | undefined, everyone = false) =>
    everyone
      ? { data: h.everyone, isLoading: false, isError: false, refetch: vi.fn() }
      : { data: h.mine, isLoading: false, isError: false, refetch: vi.fn() },
  useTaskDetail: () => ({ data: undefined, isLoading: false, isError: false }),
  useIsPhone: () => false,
}));
vi.mock("@/hooks/useToday", () => ({
  useDoneTodayCount: () => ({ data: h.doneToday, isLoading: false, isError: false }),
  useSetTaskStatus: () => ({ mutate: (v: { id: string; status: string }) => h.mutations.push(v) }),
}));
// OS-016: the person's Brain pages to review. The query itself is covered by supabase/tests/os_brain_review_test.sql.
vi.mock("@/hooks/useBrainReview", () => ({
  useBrainPagesToReview: () => ({ data: h.brainError ? undefined : h.brain, isLoading: false, isError: h.brainError }),
}));
// OS-012: the play buttons. The hook itself is covered in timer.test.tsx.
vi.mock("@/hooks/useTimer", () => ({
  useTaskTimer: () => ({ runningTaskId: h.runningTaskId, toggle: (id: string) => h.toggled.push(id), busy: false }),
}));
vi.mock("@/hooks/useClientDecisions", () => ({
  useStaffDecisions: () => ({ data: h.decisions, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("sonner", () => {
  const toast = (msg: string, opts?: { action?: { label: string; onClick: () => void } }) => h.toasts.push({ msg, opts });
  toast.error = (msg: string) => h.toasts.push({ msg });
  return { toast };
});
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));

import { SLIDE_MS, TodayPanel } from "@/features/home/TodayPanel";
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

const renderPanel = () =>
  render(
    <MemoryRouter>
      <TodayPanel />
    </MemoryRouter>,
  );

beforeEach(() => {
  h.mine = [
    mk("later", { due_date: day(5) }),
    mk("late", { due_date: day(-2) }),
    mk("today", { due_date: day(0) }),
    mk("nodate", { due_date: null }),
  ];
  h.everyone = [];
  h.doneToday = 1;
  h.decisions = [];
  h.builder = false;
  h.mutations = [];
  h.toasts = [];
  h.runningTaskId = null;
  h.toggled = [];
  h.brain = [];
  h.brainError = false;
});
afterEach(() => vi.useRealTimers());

describe("Today timer buttons (OS-012)", () => {
  it("the next action and each list item have a play button for their own task", () => {
    renderPanel();
    fireEvent.click(within(screen.getByTestId("today-next")).getByRole("button", { name: "Start a timer on Task late" }));
    const items = screen.getAllByTestId("today-list-item");
    fireEvent.click(within(items[0]).getByRole("button", { name: "Start a timer on Task today" }));
    expect(h.toggled).toEqual(["late", "today"]);
  });

  it("shows a stop state on the item whose task is running", () => {
    h.runningTaskId = "today";
    renderPanel();
    const items = screen.getAllByTestId("today-list-item");
    const stop = within(items[0]).getByRole("button", { name: "Stop the timer on Task today" });
    expect(stop.getAttribute("aria-pressed")).toBe("true");
    expect(within(screen.getByTestId("today-next")).getByTestId("timer-toggle").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("Today (OS-010)", () => {
  it("leads with one next action (the late one) and shows no table", () => {
    const { container } = renderPanel();
    expect(screen.getAllByTestId("today-next")).toHaveLength(1);
    expect(screen.getByTestId("today-next-title").textContent).toBe("Task late");
    expect(container.querySelector("table")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    // The short list follows in order: due today, later, then no date.
    expect(screen.getAllByTestId("today-list-title").map((e) => e.textContent)).toEqual(["Task today", "Task later", "Task nodate"]);
    // The next action comes before the list on the page.
    expect(screen.getByTestId("today-next").compareDocumentPosition(screen.getByTestId("today-list")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("reads N of M done today, and the fill eases to its width", () => {
    renderPanel();
    // 1 done today + 2 open for today (late, today) = 3.
    expect(screen.getByTestId("today-progress-label").textContent).toBe("1 of 3 done today");
    const bar = screen.getByRole("progressbar", { name: "Done today" });
    expect(bar.getAttribute("aria-valuenow")).toBe("1");
    expect(bar.getAttribute("aria-valuemax")).toBe("3");
    const fill = screen.getByTestId("today-progress-fill");
    expect(fill.style.width).toBe("33%");
    // The ease is the shared bar class (OS-025): width over --gos-dur-bar with --gos-ease.
    expect(fill.className).toContain("gos-bar-fill");
  });

  it("marking an item done slides it away, moves the bar, and Undo brings it back", () => {
    vi.useFakeTimers();
    renderPanel();
    const next = screen.getByTestId("today-next");
    fireEvent.click(within(next).getByTestId("today-done"));

    // It starts sliding (not gone yet), and the status is set to complete.
    expect(screen.getByTestId("today-next").className).toContain("opacity-0");
    expect(screen.getByTestId("today-next").className).toContain("translate-x-8");
    expect(h.mutations).toEqual([{ id: "late", status: "complete" }]);
    expect(h.toasts.at(-1)?.msg).toBe("Done: Task late");
    expect(h.toasts.at(-1)?.opts?.action?.label).toBe("Undo");

    act(() => void vi.advanceTimersByTime(SLIDE_MS + 10));
    expect(screen.getByTestId("today-next-title").textContent).toBe("Task today");
    expect(screen.getByTestId("today-progress-label").textContent).toBe("2 of 3 done today");
    expect(screen.getByTestId("today-progress-fill").style.width).toBe("67%");

    act(() => h.toasts.at(-1)!.opts!.action!.onClick());
    expect(h.mutations.at(-1)).toEqual({ id: "late", status: "editing" });
    expect(screen.getByTestId("today-next-title").textContent).toBe("Task late");
    expect(screen.getByTestId("today-progress-label").textContent).toBe("1 of 3 done today");
  });

  it("an item in the short list can be marked done too", () => {
    vi.useFakeTimers();
    renderPanel();
    const first = screen.getAllByTestId("today-list-item")[0];
    fireEvent.click(within(first).getByTestId("today-done"));
    expect(first.className).toContain("opacity-0");
    act(() => void vi.advanceTimersByTime(SLIDE_MS + 10));
    expect(screen.getAllByTestId("today-list-title").map((e) => e.textContent)).toEqual(["Task later", "Task nodate"]);
  });

  it("shows a plain empty state when nothing is left", () => {
    h.mine = [];
    h.doneToday = 0;
    renderPanel();
    expect(screen.getByTestId("today-empty")).toBeTruthy();
    expect(screen.getByTestId("today-progress-label").textContent).toBe("0 of 0 done today");
  });

  it("an employee does not see the builder view", () => {
    renderPanel();
    expect(screen.queryByTestId("today-builder")).toBeNull();
  });

  it("the builder view lists late items across all clients, decisions waiting and approvals outstanding", () => {
    h.builder = true;
    h.everyone = [
      mk("a", { title: "Bloom hook test", client_slug: "bloom", client: { name: "Bloom" }, due_date: day(-5), strategist_id: null }),
      mk("b", { title: "Glow reel", due_date: day(-1) }),
      mk("c", { title: "Not late", due_date: day(1) }),
      mk("d", { title: "Done late", status: "complete", due_date: day(-9) }),
      mk("e", { title: "Ended client", read_only: true, due_date: day(-9) }),
      mk("f", { title: "Awaiting Bloom", client_slug: "bloom", client: { name: "Bloom" }, status_info: { stage: "Client Review" } }),
    ];
    h.decisions = [
      { id: "d1", task_name: "Glow reel", client_slug: "glow", decision: "approved", note: null, decided_at: new Date().toISOString(), superseded_at: null, clickup_task_id: "x", decided_by: null },
    ];
    renderPanel();
    const late = screen.getByTestId("today-late");
    expect(within(late).getAllByTestId("today-late-row").map((r) => r.textContent)).toEqual([
      expect.stringContaining("Bloom hook test"),
      expect.stringContaining("Glow reel"),
    ]);
    expect(within(late).getAllByTestId("today-late-row")[0].textContent).toContain("Bloom");
    const approvals = screen.getByTestId("today-approvals");
    expect(within(approvals).getAllByTestId("today-approvals-row").map((r) => r.textContent)).toEqual([expect.stringContaining("Awaiting Bloom")]);
    expect(within(screen.getByTestId("today-decisions")).getAllByTestId("today-decisions-row")).toHaveLength(1);
  });
});

describe("Brain pages to review (OS-016)", () => {
  const page = (n: number, over: Record<string, unknown> = {}) => ({
    id: `p${n}`, section: "Playbooks", slug: `page-${n}`, title: `Page ${n}`, last_reviewed: "2026-05-01", ...over,
  });

  it("is hidden when the person owns no pages to review", () => {
    renderPanel();
    expect(screen.queryByTestId("today-brain")).toBeNull();
  });

  it("is hidden when the list fails to load, so Today stays calm", () => {
    h.brainError = true;
    renderPanel();
    expect(screen.queryByTestId("today-brain")).toBeNull();
  });

  it("shows the pages below the short list, each linking to its Brain page", () => {
    h.brain = [page(1), page(2, { section: "Handbook", last_reviewed: null })];
    renderPanel();
    const box = screen.getByTestId("today-brain");
    expect(within(box).getByText("Brain pages to review")).toBeTruthy();
    const links = within(box).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/builder/knowledge/brain?section=playbooks&page=page-1",
      "/builder/knowledge/brain?section=handbook&page=page-2",
    ]);
    expect(links[0].textContent).toContain("Page 1");
    expect(links[0].textContent).toContain("Reviewed May 1");
    expect(links[1].textContent).toContain("Never reviewed");
    expect(screen.queryByTestId("today-brain-more")).toBeNull();
    // Below the next action and the short list.
    const list = screen.getByTestId("today-list");
    expect(list.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows at most five pages and says how many more", () => {
    h.brain = Array.from({ length: 8 }, (_, i) => page(i + 1));
    renderPanel();
    expect(screen.getAllByTestId("today-brain-item")).toHaveLength(5);
    expect(screen.getByTestId("today-brain-more").textContent).toBe("and 3 more");
  });
});
