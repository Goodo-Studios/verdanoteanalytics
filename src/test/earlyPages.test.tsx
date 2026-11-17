/**
 * Early pages (Admin, builders only): lists the pages left out of the menu, with a one-line note on
 * why and a link to open each. The list is src/lib/hiddenPages.ts. After the 2026-11-16 product
 * review it holds Operations, Early pages, Operating costs, Agent evaluations, the Support inbox and
 * the client Scope sub-tabs other than Engagements. Learning is shown. The listing mechanism with a
 * list of its own is tested in earlyPagesList.test.tsx.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));

import EarlyPagesPage from "@/features/admin/EarlyPagesPage";
import { EARLY_PAGE_NOTES, HIDDEN_PAGES, isHiddenPage } from "@/lib/hiddenPages";

afterEach(() => cleanup());

const HIDDEN = [
  "operations", "earlyPages", "operatingCosts", "agentEvaluations", "supportInbox",
  "deliverables", "qaGates", "handoffs", "scopeChanges", "strategy", "recommendations",
] as const;

describe("hidden pages config", () => {
  it("hides Operations, Early pages, Operating costs, Agent evaluations, Support inbox and the Scope sub-tabs", () => {
    expect([...HIDDEN_PAGES]).toEqual([...HIDDEN]);
    for (const key of HIDDEN) expect(isHiddenPage(key), key).toBe(true);
  });

  it("keeps Learning, Engagements and the other menu pages shown", () => {
    for (const key of ["learning", "engagements", "team", "integrationHealth", "notifications"] as const) {
      expect(isHiddenPage(key), key).toBe(false);
    }
  });

  it("keeps a one-line note and an address for each hidden page that has one, without an em dash", () => {
    expect(Object.keys(EARLY_PAGE_NOTES).sort()).toEqual([
      "agentEvaluations", "deliverables", "handoffs", "learning", "operatingCosts", "operations", "qaGates",
      "recommendations", "scopeChanges", "strategy", "supportInbox",
    ]);
    for (const [key, note] of Object.entries(EARLY_PAGE_NOTES)) {
      expect(note, key).toBeTruthy();
      expect(note!.feeds).not.toMatch(/\u2014|\n/);
      expect(note!.to.startsWith("/")).toBe(true);
    }
  });
});

describe("EarlyPagesPage", () => {
  it("lists each hidden page that has a note, in the order of the hidden list, and opens it", () => {
    render(<MemoryRouter><EarlyPagesPage /></MemoryRouter>);
    const rows = screen.getAllByTestId("early-page-row");
    expect(rows.map((r) => within(r).getByRole("link").textContent)).toEqual([
      "Operations", "Operating costs", "Agent evaluations", "Support inbox", "Deliverables", "QA gates", "Handoffs",
      "Scope changes", "Strategy", "Recommendations",
    ]);
    expect(within(rows[0]).getByRole("link").getAttribute("href")).toBe("/builder/admin/operations");
    expect(screen.queryByTestId("empty-state")).toBeNull();
  });
});
