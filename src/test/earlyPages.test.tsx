/**
 * Early pages (Admin, builders only): lists the pages hidden until something feeds them, with a
 * one-line note on what feeds each and a link to open it. The list is src/lib/hiddenPages.ts.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));

import EarlyPagesPage from "@/features/admin/EarlyPagesPage";
import { EARLY_PAGE_NOTES, HIDDEN_PAGES, isHiddenPage } from "@/lib/hiddenPages";

afterEach(() => cleanup());

describe("hidden pages config", () => {
  it("hides exactly Agent evaluations, Learning, Recommendations and Strategy", () => {
    expect([...HIDDEN_PAGES].sort()).toEqual(["agentEvaluations", "learning", "recommendations", "strategy"]);
    expect(isHiddenPage("learning")).toBe(true);
    expect(isHiddenPage("team")).toBe(false);
  });

  it("has a one-line note and an address for every hidden page, without an em dash", () => {
    for (const key of HIDDEN_PAGES) {
      const note = EARLY_PAGE_NOTES[key];
      expect(note, key).toBeTruthy();
      expect(note!.feeds).not.toMatch(/\u2014|\n/);
      expect(note!.to.startsWith("/")).toBe(true);
    }
  });
});

describe("EarlyPagesPage", () => {
  it("lists every hidden page with what feeds it and a link to open it", () => {
    render(<MemoryRouter><EarlyPagesPage /></MemoryRouter>);
    const rows = screen.getAllByTestId("early-page-row");
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => within(r).getByRole("link").textContent)).toEqual(["Agent evaluations", "Learning", "Recommendations", "Strategy"]);
    expect(within(rows[1]).getByRole("link").getAttribute("href")).toBe("/builder/knowledge/learning");
    expect(rows[0].textContent).toMatch(/Fed by/);
  });
});
