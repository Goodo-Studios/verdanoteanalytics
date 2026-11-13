// OS-025: progress bars and small motion.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProgressBar } from "@/components/ProgressBar";
import { Button } from "@/components/ui/button";
import { ClientMonthDeliveryBar } from "@/features/clients/ClientMonthDelivery";
import { MOTION, useChangedIds } from "@/lib/motion";
import { deliveredText, monthPosition, progressPercent } from "@/lib/progress";
import type { ClientCard } from "@/lib/clientPages";

const decideState: { isSuccess: boolean; variables?: { decision: string } } = { isSuccess: false };
const mutate = vi.fn();
vi.mock("@/hooks/useClientCards", () => ({
  useClientDecide: () => ({ ...decideState, isPending: false, isError: false, mutate }),
  useClientCards: () => ({ data: [] }),
  useClientComments: () => ({ data: [], isLoading: false, isError: false }),
  usePostClientComment: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));
vi.mock("@/features/cut-review/CutReview", () => ({ CutReview: () => null }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, isClient: false, isBuilder: true, isEmployee: false }) }));

const css = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");

function setReducedMotion(on: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (q: string) => ({ matches: on && q.includes("reduce"), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
}

afterEach(() => {
  // jsdom has no matchMedia by default; put it back the way it was.
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  decideState.isSuccess = false;
  decideState.variables = undefined;
});

describe("ProgressBar", () => {
  it("shows N of M assets delivered and puts the today marker along the month", () => {
    render(<ClientMonthDeliveryBar delivered={3} total={8} today={new Date(2026, 10, 15)} />);
    expect(screen.getByTestId("client-hub-delivery-label").textContent).toBe("3 of 8 assets delivered");
    expect(screen.getByTestId("client-hub-delivery-fill").style.width).toBe("38%");
    const marker = screen.getByTestId("client-hub-delivery-today");
    expect(marker.style.left).toBe("50%"); // day 15 of 30
    expect(marker.getAttribute("aria-label")).toBe("Today, Nov 15");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("3");
  });

  it("words one asset in the singular and has no em dash", () => {
    expect(deliveredText(1, 1)).toBe("1 of 1 asset delivered");
    expect(deliveredText(0, 4)).not.toContain("—");
  });

  it("places today at the start and end of a month", () => {
    expect(monthPosition(new Date(2026, 1, 28))).toBe(100);
    expect(monthPosition(new Date(2026, 0, 1))).toBeCloseTo(3.2, 1);
    expect(progressPercent(5, 0)).toBe(0);
    expect(progressPercent(9, 4)).toBe(100);
  });

  it("eases the fill over 0.6s with motion on", () => {
    setReducedMotion(false);
    render(<ProgressBar done={1} total={2} label="1 of 2 done today" ariaLabel="Done today" testId="p" />);
    const fill = screen.getByTestId("p-fill");
    expect(fill.className).toContain(MOTION.bar);
    expect(fill.dataset.motion).toBe("on");
    expect(css("styles/goodo-os-tokens.css")).toMatch(/--gos-dur-bar:\s*600ms/);
    expect(css("styles/goodo-os-motion.css")).toMatch(/\.gos-bar-fill\s*\{\s*transition:\s*width var\(--gos-dur-bar\)/);
  });

  it("drops the animation class when reduced motion is on", () => {
    setReducedMotion(true);
    render(<ProgressBar done={1} total={2} label="1 of 2 done today" ariaLabel="Done today" testId="p" />);
    const fill = screen.getByTestId("p-fill");
    expect(fill.className).not.toContain(MOTION.bar);
    expect(fill.dataset.motion).toBe("off");
    expect(fill.style.transition).toBe("");
  });
});

describe("motion CSS", () => {
  const motion = css("styles/goodo-os-motion.css");

  it("presses buttons to 97% and the shared Button uses it", () => {
    expect(css("styles/goodo-os-tokens.css")).toMatch(/--gos-press-scale:\s*0\.97/);
    expect(motion).toMatch(/\.gos-press:active:not\(:disabled\)\s*\{\s*transform:\s*scale\(var\(--gos-press-scale\)\)/);
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" }).className).toContain(MOTION.press);
  });

  it("slides the side panel in over the War Room 320ms", () => {
    expect(css("styles/goodo-os-tokens.css")).toMatch(/--gos-dur-slow:\s*320ms/);
    expect(motion).toMatch(/\.task-panel-side\[data-state="open"\]\s*\{\s*animation:\s*gos-panel-in-right var\(--gos-dur-slow\)/);
  });

  it("turns every motion class off under prefers-reduced-motion", () => {
    const block = motion.slice(motion.indexOf("@media (prefers-reduced-motion: reduce)"));
    for (const cls of [".gos-bar-fill", ".gos-press", ".gos-settle", ".gos-check", ".gos-pulse-slow", ".task-panel-side", ".task-panel-sheet"]) {
      expect(block).toContain(cls);
    }
    expect(block).toMatch(/animation:\s*none !important/);
    expect(block).toMatch(/transition:\s*none !important/);
  });
});

describe("running timer dot", () => {
  it("uses the slow pulse", async () => {
    vi.resetModules();
    vi.doMock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => ({ isClientPreview: false, isEmployeePreview: false }) }));
    vi.doMock("@/hooks/useMyWork", () => ({ useMyTasks: () => ({ data: [], isLoading: false }) }));
    vi.doMock("@/hooks/useTimer", () => ({
      useRunningTimer: () => ({ data: { id: "e1", task_id: "t1", start_at: new Date().toISOString(), task: { title: "Cut v1" } } }),
      useStartTimer: () => ({ mutate: vi.fn(), isPending: false }),
      useStopTimer: () => ({ mutate: vi.fn(), isPending: false }),
    }));
    const mod = await import("@/components/TimerPill");
    const { TimerPill } = mod;
    render(<TimerPill />);
    const dot = await screen.findByTestId("timer-pill-dot");
    expect(dot.className).toContain(MOTION.pulse);
    expect(css("styles/goodo-os-motion.css")).toMatch(/\.gos-pulse-slow\s*\{\s*animation:\s*gos-pulse-slow 2\.4s/);
    vi.doUnmock("@/hooks/useClientPreviewMode");
    vi.doUnmock("@/hooks/useMyWork");
    vi.doUnmock("@/hooks/useTimer");
  });
});

describe("status change settles the card", () => {
  it("marks only cards whose status changed, and nothing on the first list", () => {
    const a = [{ id: "1", stage: "Editing" }, { id: "2", stage: "Production" }];
    const { result, rerender } = renderHook(({ items }) => useChangedIds(items, (t) => t.id, (t) => t.stage), { initialProps: { items: a } });
    expect(result.current.size).toBe(0);
    rerender({ items: [{ id: "1", stage: "Client Review" }, { id: "2", stage: "Production" }, { id: "3", stage: "Editing" }] });
    expect([...result.current]).toEqual(["1"]);
  });
});

describe("client approval", () => {
  const card = { id: "t1", title: "Hook test v2", due_date: null, asset_url: null } as unknown as ClientCard;

  it("shows a brief check once the approval is in, and none for a change request", async () => {
    const { ReviewCard } = await import("@/features/client-pages/ClientReviewPage");
    const { rerender } = render(<ReviewCard card={card} today="2026-11-13" />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(mutate).toHaveBeenCalledWith({ taskId: "t1", decision: "approved", note: undefined });
    expect(screen.queryByTestId("client-approved-check")).toBeNull();

    act(() => {
      decideState.isSuccess = true;
      decideState.variables = { decision: "approved" };
    });
    rerender(<ReviewCard card={{ ...card }} today="2026-11-13" />);
    const check = screen.getByTestId("client-approved-check");
    expect(check.className).toContain(MOTION.check);
    expect(screen.getByTestId("client-decision-sent").textContent).toContain("Thanks, we have your answer.");

    decideState.variables = { decision: "changes_requested" };
    rerender(<ReviewCard card={{ ...card, id: "t1" }} today="2026-11-14" />);
    expect(screen.queryByTestId("client-approved-check")).toBeNull();
  });
});
