/**
 * Early pages (Admin, builders only): lists the pages hidden until something feeds them, with a
 * one-line note on what feeds each and a link to open it. The list is src/lib/hiddenPages.ts.
 * Agent evaluations, Learning, Recommendations and Strategy are now in the menu, so the list is
 * empty and the page says so. The listing itself is tested in earlyPagesList.test.tsx with a list.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));

import EarlyPagesPage from "@/features/admin/EarlyPagesPage";
import { EARLY_PAGE_NOTES, HIDDEN_PAGES, isHiddenPage } from "@/lib/hiddenPages";

afterEach(() => cleanup());

describe("hidden pages config", () => {
  it("hides nothing: Agent evaluations, Learning, Recommendations and Strategy are shown", () => {
    expect([...HIDDEN_PAGES]).toEqual([]);
    for (const key of ["agentEvaluations", "learning", "recommendations", "strategy"] as const) {
      expect(isHiddenPage(key), key).toBe(false);
    }
  });

  it("keeps a one-line note and an address for each of the four pages, without an em dash, so one can be hidden again", () => {
    expect(Object.keys(EARLY_PAGE_NOTES).sort()).toEqual(["agentEvaluations", "learning", "recommendations", "strategy"]);
    for (const [key, note] of Object.entries(EARLY_PAGE_NOTES)) {
      expect(note, key).toBeTruthy();
      expect(note!.feeds).not.toMatch(/—|\n/);
      expect(note!.to.startsWith("/")).toBe(true);
    }
  });
});

describe("EarlyPagesPage", () => {
  it("says no page is early while nothing is hidden", () => {
    render(<MemoryRouter><EarlyPagesPage /></MemoryRouter>);
    expect(screen.queryAllByTestId("early-page-row")).toHaveLength(0);
    expect(screen.getByTestId("empty-state").textContent).toContain("No early pages");
  });
});
