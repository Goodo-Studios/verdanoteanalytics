/**
 * Brain (Goodo OS OS-014, OS-016): pages published from HQ knowledge.
 *
 * - Four section tabs with counts; the list shows title, owner and last reviewed, and a calm
 *   "Needs review" tag for pages not reviewed in more than 90 days (or never).
 * - Opening a page shows its markdown, owner and last-reviewed date; links to other Brain pages
 *   stay in the app; raw HTML in a page is not rendered.
 * - Edit a page: Edit opens the document editor with the page markdown, Cancel sends nothing,
 *   Save calls edit_brain_page with the timestamp the page was opened at, the edited text shows
 *   at once, a stale page says so, and an edited page says it was edited in the app. The old
 *   suggest-a-fix and review controls are gone.
 * - A client sees nothing and no query is made. Clients are also kept out of the staff area by
 *   the router (src/test/StaffArea.test.tsx) and by the table's row rules
 *   (supabase/tests/os_brain_pages_test.sql, supabase/tests/os_brain_review_test.sql).
 * - model rules: section from the address, the 90 day review rule, Brain links.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const daysAgo = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

const LIST = [
  { id: "1", section: "Handbook", slug: "decision-rights", title: "Decision rights", owner: "matthew@example.test", last_reviewed: daysAgo(10) },
  { id: "2", section: "Handbook", slug: "old-policy", title: "Old policy", owner: "Unassigned", last_reviewed: daysAgo(91) },
  { id: "3", section: "Playbooks", slug: "editor-workflow", title: "Editor workflow", owner: "chloe@example.test", last_reviewed: null },
];
const basePages = (): Record<string, Record<string, unknown>> => ({
  "Handbook/decision-rights": {
    ...LIST[0], published_at: "2026-11-02T00:00:00Z", owner_user_id: ME, content_hash: "hash-1", source_path: "company/decision-rights.md",
    updated_at: "2026-11-02T00:00:00.123456+00:00", edited_in_app: false, edited_at: null,
    body_md: "# Decision rights\n\nSee [the workflow](#brain/playbooks/editor-workflow) and [docs](https://example.test/a).\n\n<script>alert(1)</script><b>bold html</b>",
  },
  "Playbooks/editor-workflow": {
    ...LIST[2], published_at: "2026-11-02T00:00:00Z", owner_user_id: OTHER, content_hash: "hash-3", source_path: "processes/editor-workflow.md", body_md: "Step one.",
    updated_at: "2026-11-02T00:00:00.654321+00:00", edited_in_app: false, edited_at: null,
  },
});
let PAGES = basePages();

const h = vi.hoisted(() => ({
  queries: [] as string[],
  rpcs: [] as Array<{ name: string; args: Record<string, unknown> }>,
  fail: false,
  rpcError: null as null | { code: string; message: string },
  invokes: [] as Array<{ name: string; body: unknown }>,
  answer: null as unknown,
}));
let auth = { isBuilder: false, isEmployee: true, user: { id: ME } as { id: string } | null };

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => {
  const query = (table: string, columns: string) => {
    const filters: Record<string, string> = {};
    const result = () => {
      return h.fail ? { data: null, error: { message: "down" } } : { data: LIST, error: null };
    };
    const q = {
      eq: (c: string, v: string) => { filters[c] = v; return q; },
      order: () => q,
      maybeSingle: () => Promise.resolve({ data: PAGES[`${filters.section}/${filters.slug}`] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad),
    };
    h.queries.push(`${table}:${columns}`);
    return q;
  };
  return {
    supabase: {
      from: (table: string) => ({ select: (columns: string) => query(table, columns) }),
      rpc: (name: string, args: Record<string, unknown>) => {
        h.rpcs.push({ name, args });
        if (name === "edit_brain_page" && !h.rpcError) {
          const page = Object.values(PAGES).find((pg) => pg.id === args.p_page_id);
          if (page) Object.assign(page, { body_md: args.p_body_md, edited_in_app: true, edited_at: "2026-11-12T10:00:00Z", updated_at: "2026-11-12T10:00:00.5+00:00" });
        }
        return Promise.resolve({ data: "new-id", error: h.rpcError });
      },
      // OS-026: ask the Brain.
      functions: {
        invoke: (name: string, opts: { body: unknown }) => {
          h.invokes.push({ name, body: opts.body });
          return Promise.resolve({ data: h.answer, error: null });
        },
      },
    },
  };
});

import BrainPage from "@/features/brain/BrainPage";
import { brainAnchor, brainPagePath, needsReview, NEEDS_REVIEW_DAYS, parseBrainHref, sectionFromParam, withoutRepeatedTitle } from "@/features/brain/model";

function renderAt(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/builder/knowledge/brain${search}`]}>
      <BrainPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  h.queries.length = 0;
  h.rpcs.length = 0;
  PAGES = basePages();
  h.fail = false;
  h.rpcError = null;
  h.invokes = [];
  h.answer = null;
  auth = { isBuilder: false, isEmployee: true, user: { id: ME } };
});

describe("BrainPage", () => {
  it("shows the four sections with counts and the Handbook list with owner, review date and the review tag", async () => {
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
    expect(items[0].textContent).toContain("Last reviewed");
    expect(within(items[0]).queryByTestId("brain-needs-review")).toBeNull();
    expect(items[1].textContent).toContain("Unassigned");
    const tag = within(items[1]).getByTestId("brain-needs-review");
    expect(tag.textContent).toBe("Needs review");
    expect(tag.getAttribute("title")).toBe("Not reviewed in the last 90 days");
    // Calm, not an alarm: muted colours, never the destructive or late colour.
    expect(tag.className).toContain("text-muted-foreground");
    expect(tag.className).not.toMatch(/destructive|red|gos-late/);
    expect(h.queries[0]).toBe("brain_pages:id, section, slug, title, owner, last_reviewed");
  });

  it("switches sections and shows an empty section plainly", async () => {
    renderAt();
    await screen.findByTestId("brain-list");
    fireEvent.click(screen.getByRole("button", { name: /Playbooks/ }));
    expect(await screen.findByText("Editor workflow")).toBeTruthy();
    expect(screen.getByText(/Not reviewed yet/)).toBeTruthy();
    expect(screen.getByTestId("brain-needs-review")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Insights/ }));
    expect(await screen.findByText("Nothing has been published to Insights yet.")).toBeTruthy();
  });

  it("opens a page with owner, last reviewed and safe markdown, and follows a Brain link", async () => {
    renderAt();
    fireEvent.click(await screen.findByText("Decision rights"));
    const page = await screen.findByTestId("brain-page");
    expect(within(page).getByTestId("brain-owner").textContent).toBe("Owner: matthew@example.test");
    expect(within(page).getByTestId("brain-reviewed").textContent).toMatch(/^Last reviewed /);
    expect(within(page).queryByTestId("brain-needs-review")).toBeNull();
    const body = within(page).getByTestId("brain-page-body");
    expect(body.querySelector("script")).toBeNull();
    expect(body.querySelector("b")).toBeNull();
    expect(within(body).getByRole("link", { name: "docs" }).getAttribute("target")).toBe("_blank");
    fireEvent.click(within(body).getByRole("link", { name: "the workflow" }));
    await waitFor(() => expect(screen.getByTestId("brain-page").getAttribute("aria-label")).toBe("Editor workflow"));
    expect(within(screen.getByRole("navigation", { name: "Brain sections" })).getByRole("button", { name: /Playbooks/ }).getAttribute("aria-current")).toBe("page");
  });

  it("opens a page from the address and shows the review tag on an old page", async () => {
    renderAt("?section=playbooks&page=editor-workflow");
    expect(await screen.findByText("Step one.")).toBeTruthy();
    expect(screen.getByTestId("brain-owner").textContent).toBe("Owner: chloe@example.test");
    expect(within(screen.getByTestId("brain-page-meta")).getByTestId("brain-needs-review")).toBeTruthy();
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
    h.fail = true;
    renderAt();
    expect(await screen.findByText("The Brain could not load.")).toBeTruthy();
  });

  it("works for a builder", async () => {
    auth = { isBuilder: true, isEmployee: false, user: { id: ME } };
    renderAt();
    expect(await screen.findByTestId("brain-list")).toBeTruthy();
  });

  it("shows a client nothing and makes no query", async () => {
    auth = { isBuilder: false, isEmployee: false, user: { id: ME } };
    renderAt();
    expect(screen.getByText("The Brain is for the Goodo team.")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Brain sections" })).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.queries).toEqual([]);
  });
});

describe("Edit a page", () => {
  const openEditor = async (search = "?section=playbooks&page=editor-workflow") => {
    renderAt(search);
    fireEvent.click(await screen.findByRole("button", { name: "Edit this page" }));
    return screen.getByTestId("document-editor");
  };

  it("opens the editor with the page markdown and cancels without sending", async () => {
    const editor = await openEditor();
    expect(within(editor).getByLabelText("Page text")).toHaveProperty("value", "Step one.");
    expect(within(editor).getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    fireEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("document-editor")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit this page" })).toBeTruthy();
    expect(h.rpcs).toEqual([]);
  });

  it("saves the edit against the timestamp the page was opened at and shows the new text at once", async () => {
    const editor = await openEditor();
    fireEvent.change(within(editor).getByLabelText("Page text"), { target: { value: "Step one, then step two." } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Step one, then step two.")).toBeTruthy();
    expect(h.rpcs).toEqual([{
      name: "edit_brain_page",
      args: { p_page_id: "3", p_body_md: "Step one, then step two.", p_expected_updated_at: "2026-11-02T00:00:00.654321+00:00" },
    }]);
    expect(screen.queryByTestId("document-editor")).toBeNull();
    expect(screen.getByTestId("brain-edited").textContent).toMatch(/^Edited in the app on .*Publishing from HQ keeps this text\.$/);
  });

  it("a second save uses the timestamp from the first save", async () => {
    let editor = await openEditor();
    fireEvent.change(within(editor).getByLabelText("Page text"), { target: { value: "One." } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    await screen.findByTestId("brain-edited");
    fireEvent.click(screen.getByRole("button", { name: "Edit this page" }));
    editor = screen.getByTestId("document-editor");
    fireEvent.change(within(editor).getByLabelText("Page text"), { target: { value: "Two." } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.rpcs).toHaveLength(2));
    expect(h.rpcs[1].args).toMatchObject({ p_body_md: "Two.", p_expected_updated_at: "2026-11-12T10:00:00.5+00:00" });
  });

  it("says plainly when the page changed since it was opened, and keeps the text", async () => {
    h.rpcError = { code: "40001", message: "stale" };
    const editor = await openEditor();
    fireEvent.change(within(editor).getByLabelText("Page text"), { target: { value: "New" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    expect((await within(editor).findByRole("alert")).textContent).toMatch(/changed this document since you opened it/);
    expect(within(editor).getByLabelText("Page text")).toHaveProperty("value", "New");
  });

  it("no longer offers to suggest a fix, and a page not edited in the app carries no edited note", async () => {
    renderAt("?section=handbook&page=decision-rights");
    await screen.findByTestId("brain-page");
    expect(screen.queryByRole("button", { name: "Suggest a fix" })).toBeNull();
    expect(screen.queryByTestId("brain-fixes")).toBeNull();
    expect(screen.queryByTestId("brain-edited")).toBeNull();
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
  it("needs review after more than 90 days, or when never reviewed", () => {
    expect(NEEDS_REVIEW_DAYS).toBe(90);
    expect(needsReview("2026-08-15", now)).toBe(false); // 89 days
    expect(needsReview("2026-08-14", now)).toBe(false); // 90 days
    expect(needsReview("2026-08-13", now)).toBe(true); // 91 days
    expect(needsReview(null, now)).toBe(true);
  });
  it("reads Brain links and ignores everything else", () => {
    expect(parseBrainHref("#brain/clients/glow")).toEqual({ section: "Clients", slug: "glow" });
    expect(parseBrainHref("#brain/slack/x")).toBeNull();
    expect(parseBrainHref("https://example.test")).toBeNull();
    expect(parseBrainHref(undefined)).toBeNull();
  });
});

describe("Ask the Brain (OS-026)", () => {
  const ask = async (question: string) => {
    renderAt();
    await screen.findByTestId("brain-list");
    fireEvent.change(screen.getByLabelText("Ask the Brain a question"), { target: { value: question } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    return screen.findByTestId("brain-answer");
  };

  it("asks brain-ask and shows the answer with its cited pages as links that open in the Brain", async () => {
    h.answer = {
      answer: "Film the founder in daylight.",
      mode: "answer",
      citations: [{ section: "Playbooks", slug: "editor-workflow", title: "Editor workflow" }],
      passages: [{ section: "Playbooks", slug: "editor-workflow", title: "Editor workflow", text: "Step one." }],
    };
    const box = await ask("How do we film the founder?");
    expect(h.invokes).toEqual([{ name: "brain-ask", body: { question: "How do we film the founder?" } }]);
    expect(within(box).getByTestId("brain-answer-text").textContent).toBe("Film the founder in daylight.");
    const sources = within(box).getByTestId("brain-answer-sources");
    const link = within(sources).getByRole("link", { name: "Editor workflow" });
    expect(link.getAttribute("href")).toBe("?section=playbooks&page=editor-workflow");
    fireEvent.click(link);
    expect(await screen.findByTestId("brain-page")).toBeTruthy();
    expect(screen.getByText("Step one.")).toBeTruthy();
  });

  it("without a model, shows the matching passages and cites each page", async () => {
    h.answer = {
      answer: null,
      mode: "passages",
      citations: [
        { section: "Playbooks", slug: "editor-workflow", title: "Editor workflow" },
        { section: "Handbook", slug: "decision-rights", title: "Decision rights" },
      ],
      passages: [
        { section: "Playbooks", slug: "editor-workflow", title: "Editor workflow", text: "Export at 1080 by 1920." },
        { section: "Handbook", slug: "decision-rights", title: "Decision rights", text: "Strategists decide hooks." },
      ],
    };
    const box = await ask("Who decides hooks?");
    expect(within(box).getByTestId("brain-answer-passages").textContent).toContain("Strategists decide hooks.");
    expect(within(within(box).getByTestId("brain-answer-sources")).getAllByRole("link").map((a) => a.textContent)).toEqual(["Editor workflow", "Decision rights"]);
  });

  it("says plainly when nothing matches, with no citations", async () => {
    h.answer = { answer: "Nothing in the Brain answers that yet.", mode: "none", citations: [], passages: [] };
    const box = await ask("What is the payroll deadline?");
    expect(within(box).getByTestId("brain-answer-none").textContent).toBe("Nothing in the Brain answers that yet.");
    expect(within(box).queryByTestId("brain-answer-sources")).toBeNull();
    expect(within(box).queryAllByRole("link")).toHaveLength(0);
  });

  it("treats an answer with no citations as no match", async () => {
    h.answer = { answer: "Made up.", mode: "answer", citations: [], passages: [] };
    const box = await ask("Anything?");
    expect(box.textContent).toBe("Nothing in the Brain answers that yet.");
  });

  it("is not shown to a client and nothing is asked", async () => {
    auth = { isBuilder: false, isEmployee: false, user: { id: ME } };
    renderAt();
    expect(screen.queryByTestId("brain-ask")).toBeNull();
    expect(h.invokes).toHaveLength(0);
  });

  it("gives heading anchors so a task can link to a playbook section", () => {
    expect(brainAnchor("Founder Story")).toBe("founder-story");
    expect(brainAnchor("  UGC / Testimonial!! ")).toBe("ugc-testimonial");
    expect(brainPagePath("/employee", "Playbooks", "video", "founder-story")).toBe("/employee/knowledge/brain?section=playbooks&page=video#founder-story");
    expect(brainPagePath("/employee", "Playbooks", "video")).toBe("/employee/knowledge/brain?section=playbooks&page=video");
  });

  it("shows the page title once: a leading # heading that repeats it is dropped", () => {
    expect(withoutRepeatedTitle("# Goodo Studios Overview\nBody text.", "Goodo Studios Overview")).toBe("Body text.");
    expect(withoutRepeatedTitle("\n#  goodo studios   overview  \n\nBody", "Goodo Studios Overview")).toBe("Body");
    // A different first heading, or a second-level one, stays.
    expect(withoutRepeatedTitle("# Something else\nBody", "Goodo Studios Overview")).toBe("# Something else\nBody");
    expect(withoutRepeatedTitle("## Goodo Studios Overview\nBody", "Goodo Studios Overview")).toBe("## Goodo Studios Overview\nBody");
    expect(withoutRepeatedTitle("Body only", "Title")).toBe("Body only");
  });
});
