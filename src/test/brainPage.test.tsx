/**
 * Brain (Goodo OS OS-014): pages published from HQ knowledge.
 *
 * - Four section tabs with counts; the list shows title, owner and last reviewed, and a muted
 *   "may be out of date" note for pages not reviewed in 180 days.
 * - Opening a page shows its markdown, owner and last-reviewed date; links to other Brain pages
 *   stay in the app; raw HTML in a page is not rendered.
 * - A client sees nothing and no query is made. Clients are also kept out of the staff area by
 *   the router (src/test/StaffArea.test.tsx) and by the table's row rules
 *   (supabase/tests/os_brain_pages_test.sql).
 * - model rules: section from the address, staleness and Brain links.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const LIST = [
  { id: "1", section: "Handbook", slug: "decision-rights", title: "Decision rights", owner: "matthew@example.test", last_reviewed: "2026-11-01" },
  { id: "2", section: "Handbook", slug: "old-policy", title: "Old policy", owner: "Unassigned", last_reviewed: "2025-01-10" },
  { id: "3", section: "Playbooks", slug: "editor-workflow", title: "Editor workflow", owner: "chloe@example.test", last_reviewed: null },
];
const PAGES: Record<string, Record<string, unknown>> = {
  "Handbook/decision-rights": {
    ...LIST[0], published_at: "2026-11-02T00:00:00Z",
    body_md: "# Decision rights\n\nSee [the workflow](#brain/playbooks/editor-workflow) and [docs](https://example.test/a).\n\n<script>alert(1)</script><b>bold html</b>",
  },
  "Playbooks/editor-workflow": { ...LIST[2], published_at: "2026-11-02T00:00:00Z", body_md: "Step one." },
};

const queries: string[] = [];
const fail: { current: boolean } = { current: false };
let auth = { isBuilder: false, isEmployee: true };

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => {
        queries.push(`${table}:${columns}`);
        return {
          order: () => Promise.resolve(fail.current ? { data: null, error: { message: "down" } } : { data: LIST, error: null }),
          eq: (_c1: string, section: string) => ({
            eq: (_c2: string, slug: string) => ({
              maybeSingle: () => Promise.resolve({ data: PAGES[`${section}/${slug}`] ?? null, error: null }),
            }),
          }),
        };
      },
    }),
  },
}));

import BrainPage from "@/features/brain/BrainPage";
import { isStale, parseBrainHref, sectionFromParam } from "@/features/brain/model";

function renderAt(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/builder/knowledge/brain${search}`]}>
      <BrainPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  queries.length = 0;
  fail.current = false;
  auth = { isBuilder: false, isEmployee: true };
});

describe("BrainPage", () => {
  it("shows the four sections with counts and the Handbook list with owner and review date", async () => {
    renderAt();
    const nav = screen.getByRole("navigation", { name: "Brain sections" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent?.replace(/\s*\d+$/, ""))).toEqual(["Handbook", "Playbooks", "Clients", "Insights"]);
    const list = await screen.findByTestId("brain-list");
    expect(within(nav).getByRole("button", { name: /Handbook/ }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("button", { name: /Handbook/ }).textContent).toContain("2");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("Decision rights");
    expect(items[0].textContent).toContain("matthew@example.test");
    expect(items[0].textContent).toContain("Last reviewed Nov 1, 2026");
    expect(items[0].textContent).not.toContain("may be out of date");
    expect(items[1].textContent).toContain("Unassigned");
    expect(items[1].textContent).toContain("may be out of date");
    expect(queries[0]).toBe("brain_pages:id, section, slug, title, owner, last_reviewed");
  });

  it("switches sections and shows an empty section plainly", async () => {
    renderAt();
    await screen.findByTestId("brain-list");
    fireEvent.click(screen.getByRole("button", { name: /Playbooks/ }));
    expect(await screen.findByText("Editor workflow")).toBeTruthy();
    expect(screen.getByText(/Not reviewed yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Insights/ }));
    expect(await screen.findByText("Nothing has been published to Insights yet.")).toBeTruthy();
  });

  it("opens a page with owner, last reviewed and safe markdown, and follows a Brain link", async () => {
    renderAt();
    fireEvent.click(await screen.findByText("Decision rights"));
    const page = await screen.findByTestId("brain-page");
    expect(within(page).getByTestId("brain-owner").textContent).toBe("Owner: matthew@example.test");
    expect(within(page).getByTestId("brain-reviewed").textContent).toBe("Last reviewed Nov 1, 2026");
    const body = within(page).getByTestId("brain-page-body");
    expect(body.querySelector("script")).toBeNull();
    expect(body.querySelector("b")).toBeNull();
    expect(within(body).getByRole("link", { name: "docs" }).getAttribute("target")).toBe("_blank");
    fireEvent.click(within(body).getByRole("link", { name: "the workflow" }));
    await waitFor(() => expect(screen.getByTestId("brain-page").getAttribute("aria-label")).toBe("Editor workflow"));
    expect(within(screen.getByRole("navigation", { name: "Brain sections" })).getByRole("button", { name: /Playbooks/ }).getAttribute("aria-current")).toBe("page");
  });

  it("opens a page from the address and says so when it is gone", async () => {
    renderAt("?section=playbooks&page=editor-workflow");
    expect(await screen.findByText("Step one.")).toBeTruthy();
    expect(screen.getByTestId("brain-owner").textContent).toBe("Owner: chloe@example.test");
  });

  it("says when a page is no longer published", async () => {
    renderAt("?section=handbook&page=removed");
    expect(await screen.findByText(/not in the Brain/)).toBeTruthy();
  });

  it("filters by title or owner", async () => {
    renderAt();
    await screen.findByTestId("brain-list");
    fireEvent.change(screen.getByLabelText("Search the Brain"), { target: { value: "unassigned" } });
    expect(within(screen.getByTestId("brain-list")).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Old policy")).toBeTruthy();
  });

  it("shows an error with a retry when the list fails", async () => {
    fail.current = true;
    renderAt();
    expect(await screen.findByText("The Brain could not load.")).toBeTruthy();
  });

  it("works for a builder", async () => {
    auth = { isBuilder: true, isEmployee: false };
    renderAt();
    expect(await screen.findByTestId("brain-list")).toBeTruthy();
  });

  it("shows a client nothing and makes no query", async () => {
    auth = { isBuilder: false, isEmployee: false };
    renderAt();
    expect(screen.getByText("The Brain is for the Goodo team.")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Brain sections" })).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(queries).toEqual([]);
  });
});

describe("Brain model", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  it("reads the section from the address", () => {
    expect(sectionFromParam("playbooks")).toBe("Playbooks");
    expect(sectionFromParam("INSIGHTS")).toBe("Insights");
    expect(sectionFromParam("slack")).toBe("Handbook");
    expect(sectionFromParam(null)).toBe("Handbook");
  });
  it("marks pages not reviewed in 180 days, or never, as stale", () => {
    expect(isStale("2026-05-16", now)).toBe(false); // 180 days
    expect(isStale("2026-05-15", now)).toBe(true);
    expect(isStale(null, now)).toBe(true);
  });
  it("reads Brain links and ignores everything else", () => {
    expect(parseBrainHref("#brain/clients/glow")).toEqual({ section: "Clients", slug: "glow" });
    expect(parseBrainHref("#brain/slack/x")).toBeNull();
    expect(parseBrainHref("https://example.test")).toBeNull();
    expect(parseBrainHref(undefined)).toBeNull();
  });
});
