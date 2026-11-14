/**
 * The hide mechanism in src/lib/hiddenPages.ts, exercised with a list: when a page is added to
 * HIDDEN_PAGES it is left out of the section tabs, and Admin > Early pages lists it with what
 * feeds it and a link to open it. The real list is empty (see earlyPages.test.tsx).
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));
vi.mock("@/lib/hiddenPages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hiddenPages")>();
  const hidden = ["agentEvaluations", "learning", "recommendations", "strategy"] as const;
  return { ...actual, HIDDEN_PAGES: hidden, isHiddenPage: (page: string) => (hidden as readonly string[]).includes(page) };
});

import EarlyPagesPage from "@/features/admin/EarlyPagesPage";
import { sectionById, tabsFor } from "@/lib/sections";

afterEach(() => cleanup());

describe("EarlyPagesPage with pages hidden", () => {
  it("lists every hidden page with what feeds it and a link to open it", () => {
    render(<MemoryRouter><EarlyPagesPage /></MemoryRouter>);
    const rows = screen.getAllByTestId("early-page-row");
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => within(r).getByRole("link").textContent)).toEqual(["Agent evaluations", "Learning", "Recommendations", "Strategy"]);
    expect(within(rows[1]).getByRole("link").getAttribute("href")).toBe("/builder/knowledge/learning");
    expect(rows[0].textContent).toMatch(/Fed by/);
  });
});

describe("tabsFor with pages hidden", () => {
  it("leaves a hidden page out of its section's tabs", () => {
    const labels = (id: string) => tabsFor(sectionById(id)!, true).map((t) => t.label);
    expect(labels("knowledge")).not.toContain("Learning");
    expect(labels("admin")).not.toContain("Agent evaluations");
    expect(labels("admin")).toContain("Early pages");
  });
});
