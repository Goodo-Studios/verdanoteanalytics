/**
 * Brain (Goodo OS OS-014, OS-016): pages published from HQ knowledge.
 *
 * - Four section tabs with counts; the list shows title, owner and last reviewed, and a calm
 *   "Needs review" tag for pages not reviewed in more than 90 days (or never).
 * - Opening a page shows its markdown, owner and last-reviewed date; links to other Brain pages
 *   stay in the app; raw HTML in a page is not rendered.
 * - Suggest a fix (OS-016): opens the shared correction form with the page text, cancels, and
 *   sends a fix locked to the page's content hash. The page owner (or a builder) sees Accept and
 *   Reject on someone else's open fix; another employee and the author do not. An accepted fix
 *   says to apply it in HQ until the page is published again.
 * - A client sees nothing and no query is made. Clients are also kept out of the staff area by
 *   the router (src/test/StaffArea.test.tsx) and by the table's row rules
 *   (supabase/tests/os_brain_pages_test.sql, supabase/tests/os_brain_review_test.sql).
 * - model rules: section from the address, the 90 day review rule, Brain links, fix status.
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
const PAGES: Record<string, Record<string, unknown>> = {
  "Handbook/decision-rights": {
    ...LIST[0], published_at: "2026-11-02T00:00:00Z", owner_user_id: ME, content_hash: "hash-1", source_path: "company/decision-rights.md",
    body_md: "# Decision rights\n\nSee [the workflow](#brain/playbooks/editor-workflow) and [docs](https://example.test/a).\n\n<script>alert(1)</script><b>bold html</b>",
  },
  "Playbooks/editor-workflow": {
    ...LIST[2], published_at: "2026-11-02T00:00:00Z", owner_user_id: OTHER, content_hash: "hash-3", source_path: "processes/editor-workflow.md", body_md: "Step one.",
  },
};
const fix = (id: string, page: string, over: Record<string, unknown> = {}) => ({
  id, brain_page_id: page, source_path: "company/decision-rights.md", page_title: "Decision rights", page_content_hash: "hash-1",
  proposed_body: `Fixed text ${id}`, reason: `Reason ${id}`, classification: "factual", submitted_by: OTHER,
  created_at: `2026-11-1${id}T00:00:00Z`, brain_page_correction_reviews: [], ...over,
});

const h = vi.hoisted(() => ({
  queries: [] as string[],
  rpcs: [] as Array<{ name: string; args: Record<string, unknown> }>,
  fixes: [] as unknown[],
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
      if (table === "brain_page_corrections") {
        return { data: h.fixes.filter((f) => (f as { brain_page_id: string }).brain_page_id === filters.brain_page_id), error: null };
      }
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
import { brainAnchor, brainPagePath, type BrainFix, canReviewFix, fixStatus, needsReview, NEEDS_REVIEW_DAYS, parseBrainHref, sectionFromParam } from "@/features/brain/model";

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
  h.fixes = [];
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

describe("Suggest a fix", () => {
  it("opens the correction form with the page text and cancels without sending", async () => {
    renderAt("?section=playbooks&page=editor-workflow");
    fireEvent.click(await screen.findByRole("button", { name: "Suggest a fix" }));
    const form = screen.getByTestId("correction-form");
    expect(within(form).getByLabelText("Corrected text")).toHaveProperty("value", "Step one.");
    expect(within(form).getByRole("button", { name: "Send to the owner" })).toHaveProperty("disabled", true);
    fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("correction-form")).toBeNull();
    expect(screen.getByRole("button", { name: "Suggest a fix" })).toBeTruthy();
    expect(h.rpcs).toEqual([]);
  });

  it("sends a fix locked to the page's content hash", async () => {
    renderAt("?section=playbooks&page=editor-workflow");
    fireEvent.click(await screen.findByRole("button", { name: "Suggest a fix" }));
    const form = screen.getByTestId("correction-form");
    fireEvent.change(within(form).getByLabelText("Corrected text"), { target: { value: "Step one, then step two." } });
    fireEvent.change(within(form).getByLabelText("Why"), { target: { value: "  Step two is missing " } });
    fireEvent.change(within(form).getByLabelText("Kind of correction"), { target: { value: "procedure" } });
    fireEvent.click(within(form).getByRole("button", { name: "Send to the owner" }));
    expect(await screen.findByText("Fix sent to the page owner.")).toBeTruthy();
    expect(h.rpcs).toEqual([{
      name: "submit_brain_page_correction",
      args: { p_page_id: "3", p_content_hash: "hash-3", p_proposed_body: "Step one, then step two.", p_reason: "Step two is missing", p_classification: "procedure" },
    }]);
  });

  it("says plainly when the page was published again since it was opened", async () => {
    h.rpcError = { code: "40001", message: "stale" };
    renderAt("?section=playbooks&page=editor-workflow");
    fireEvent.click(await screen.findByRole("button", { name: "Suggest a fix" }));
    const form = screen.getByTestId("correction-form");
    fireEvent.change(within(form).getByLabelText("Corrected text"), { target: { value: "New" } });
    fireEvent.change(within(form).getByLabelText("Why"), { target: { value: "Because" } });
    fireEvent.click(within(form).getByRole("button", { name: "Send to the owner" }));
    expect((await screen.findByRole("alert")).textContent).toBe("This page was published again since you opened it. Reload and try again.");
  });

  it("lets the page owner accept a fix with a reason", async () => {
    h.fixes = [fix("1", "1")];
    renderAt("?section=handbook&page=decision-rights");
    const row = await screen.findByTestId("brain-fix");
    expect(within(row).getByTestId("brain-fix-status").textContent).toBe("Waiting for the owner");
    fireEvent.click(within(row).getByRole("button", { name: "Accept" }));
    expect(within(row).getByRole("alert").textContent).toBe("Add a reason before recording a decision.");
    expect(h.rpcs).toEqual([]);
    fireEvent.change(within(row).getByLabelText("Decision reason"), { target: { value: "Right, updating HQ" } });
    fireEvent.click(within(row).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(h.rpcs).toEqual([
      { name: "review_brain_page_correction", args: { p_correction_id: "1", p_decision: "accepted", p_reason: "Right, updating HQ" } },
    ]));
  });

  it("lets the page owner reject a fix", async () => {
    h.fixes = [fix("1", "1")];
    renderAt("?section=handbook&page=decision-rights");
    const row = await screen.findByTestId("brain-fix");
    fireEvent.change(within(row).getByLabelText("Decision reason"), { target: { value: "Already correct" } });
    fireEvent.click(within(row).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(h.rpcs[0]).toEqual({ name: "review_brain_page_correction", args: { p_correction_id: "1", p_decision: "rejected", p_reason: "Already correct" } }));
  });

  it("does not offer accept or reject to an employee who is not the owner, or to the author", async () => {
    h.fixes = [fix("1", "3", { page_content_hash: "hash-3" }), fix("2", "3", { page_content_hash: "hash-3", submitted_by: ME })];
    renderAt("?section=playbooks&page=editor-workflow");
    const rows = await screen.findAllByTestId("brain-fix");
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(within(row).queryByRole("button", { name: "Accept" })).toBeNull();
  });

  it("offers a builder accept and reject on a page they do not own, but not on their own fix", async () => {
    auth = { isBuilder: true, isEmployee: false, user: { id: ME } };
    h.fixes = [fix("1", "3", { page_content_hash: "hash-3" }), fix("2", "3", { page_content_hash: "hash-3", submitted_by: ME })];
    renderAt("?section=playbooks&page=editor-workflow");
    const rows = await screen.findAllByTestId("brain-fix");
    expect(within(rows[0]).getByText(/Reason 2/)).toBeTruthy();
    expect(within(rows[0]).queryByRole("button", { name: "Accept" })).toBeNull();
    expect(within(rows[1]).getByRole("button", { name: "Accept" })).toBeTruthy();
    expect(within(rows[1]).getByRole("button", { name: "Reject" })).toBeTruthy();
  });

  it("shows an accepted fix as one to apply in HQ, with no more buttons", async () => {
    h.fixes = [fix("1", "1", { brain_page_correction_reviews: [{ decision: "accepted", reason: "Yes", reviewer_id: ME, created_at: "2026-11-12T00:00:00Z" }] })];
    renderAt("?section=handbook&page=decision-rights");
    const row = await screen.findByTestId("brain-fix");
    expect(within(row).getByTestId("brain-fix-status").textContent).toBe("Accepted, to apply in HQ");
    expect(within(row).getByTestId("brain-fix-apply").textContent).toBe("Apply this in HQ (company/decision-rights.md), then publish the Brain again.");
    expect(within(row).queryByRole("button", { name: "Accept" })).toBeNull();
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
  it("works out where a fix stands and who may review it", () => {
    const base = { ...fix("1", "1"), review: null } as unknown as BrainFix;
    const accepted = { ...base, review: { decision: "accepted" as const, reason: "ok", reviewer_id: ME, created_at: "" } };
    expect(fixStatus(base, "hash-1")).toBe("open");
    expect(fixStatus(accepted, "hash-1")).toBe("accepted");
    expect(fixStatus(accepted, "hash-2")).toBe("applied");
    expect(fixStatus({ ...accepted, review: { ...accepted.review, decision: "rejected" } }, "hash-1")).toBe("rejected");
    expect(canReviewFix(base, { owner_user_id: ME }, ME, false)).toBe(true);
    expect(canReviewFix(base, { owner_user_id: OTHER }, ME, false)).toBe(false);
    expect(canReviewFix(base, { owner_user_id: null }, ME, true)).toBe(true);
    expect(canReviewFix({ ...base, submitted_by: ME }, { owner_user_id: ME }, ME, true)).toBe(false);
    expect(canReviewFix(accepted, { owner_user_id: ME }, ME, true)).toBe(false);
    expect(canReviewFix(base, { owner_user_id: ME }, undefined, true)).toBe(false);
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
});
