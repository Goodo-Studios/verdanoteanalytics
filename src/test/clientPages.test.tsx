/**
 * OS-019 client pages: the home lead picks the right next item, Review approves and requests
 * changes through os_client_decide, Assets group by month with download links, unknown fields from
 * the server are dropped and never drawn, and a long list renders quickly.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  groupAssetsByMonth,
  nextItem,
  noteProblem,
  toClientCards,
  upNext,
  type ClientCard,
} from "@/lib/clientPages";

const h = vi.hoisted(() => ({
  cards: [] as unknown[],
  comments: [] as unknown[],
  rpcs: [] as Array<{ fn: string; args: unknown }>,
  decideError: null as null | { message: string; code: string },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      h.rpcs.push({ fn, args });
      if (fn === "os_client_task_cards") return Promise.resolve({ data: h.cards, error: null });
      if (fn === "list_task_comments") return Promise.resolve({ data: h.comments, error: null });
      if (fn === "os_client_decide") {
        return Promise.resolve(h.decideError ? { data: null, error: h.decideError } : { data: { status: "recorded" }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-client" }, isClient: true }) }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/client" }));

import ClientReviewPage from "@/features/client-pages/ClientReviewPage";
import ClientAssetsPage from "@/features/client-pages/ClientAssetsPage";
import ClientBriefsPage from "@/features/client-pages/ClientBriefsPage";
import { ClientHomeLead } from "@/features/client-pages/ClientHomeLead";

const card = (over: Partial<ClientCard> & { id: string }): ClientCard => ({
  title: over.id,
  stage: null,
  due_date: null,
  brief: null,
  asset_url: null,
  decision: null,
  ...over,
});

function renderPage(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.cards = [];
  h.comments = [];
  h.rpcs = [];
  h.decideError = null;
});

describe("next item for the client home", () => {
  it("picks the task in Client Review that is due first", () => {
    const cards = [
      card({ id: "r-late", stage: "Client Review", due_date: "2026-12-09" }),
      card({ id: "b", stage: "Preparing Content", brief: "x", due_date: "2026-11-01" }),
      card({ id: "r-first", stage: "Client Review", due_date: "2026-12-01" }),
    ];
    const lead = nextItem(cards);
    expect(lead).toEqual({ kind: "review", card: cards[2] });
    expect(upNext(cards, lead).map((c) => c.id)).toEqual(["r-late", "b"]);
  });

  it("falls back to the next brief, and only briefs with text", () => {
    const cards = [
      card({ id: "no-text", stage: "Preparing Content", due_date: "2026-10-01" }),
      card({ id: "brief", stage: "Preparing Content", brief: "Read me", due_date: "2026-12-01" }),
      card({ id: "done", stage: "Ready to Launch", asset_url: "https://x.test/a" }),
    ];
    expect(nextItem(cards)).toEqual({ kind: "brief", card: cards[1] });
  });

  it("says nothing needs the client when nothing does", () => {
    expect(nextItem([card({ id: "done", stage: "Ready to Launch" })])).toEqual({ kind: "none" });
  });

  it("puts a review with no date after a dated one", () => {
    const cards = [card({ id: "none", stage: "Client Review" }), card({ id: "dated", stage: "Client Review", due_date: "2027-01-01" })];
    expect(nextItem(cards)).toMatchObject({ card: { id: "dated" } });
  });

  it("renders the lead and the short list", async () => {
    h.cards = [
      { id: "r1", title: "Spring hero cut", stage: "Client Review", due_date: "2026-12-01", brief: null, asset_url: "https://x.test/1", decision: null },
      { id: "b1", title: "Summer brief", stage: "Preparing Content", due_date: "2026-12-05", brief: "Text", asset_url: null, decision: null },
    ];
    renderPage(<ClientHomeLead />);
    expect(await screen.findByTestId("client-next-title")).toHaveTextContent("Spring hero cut");
    expect(within(screen.getByTestId("client-up-next")).getByText("Summer brief")).toBeInTheDocument();
  });

  it("renders the calm empty card", async () => {
    renderPage(<ClientHomeLead />);
    expect(await screen.findByTestId("client-next-none")).toHaveTextContent("Nothing needs you right now.");
  });
});

describe("assets grouped by month", () => {
  it("groups delivered assets by due month, newest first, no date last", () => {
    const groups = groupAssetsByMonth([
      card({ id: "oct", stage: "Ready to Launch", asset_url: "https://x.test/o", due_date: "2026-10-20" }),
      card({ id: "nov-1", stage: "Ready to Launch", asset_url: "https://x.test/n1", due_date: "2026-11-02" }),
      card({ id: "nov-2", stage: "Ready to Launch", asset_url: "https://x.test/n2", due_date: "2026-11-25" }),
      card({ id: "undated", stage: "Ready to Launch", asset_url: "https://x.test/u" }),
      card({ id: "no-link", stage: "Ready to Launch", due_date: "2026-11-03" }),
      card({ id: "in-review", stage: "Client Review", asset_url: "https://x.test/r", due_date: "2026-11-04" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["November 2026", "October 2026", "No date"]);
    expect(groups[0].cards.map((c) => c.id)).toEqual(["nov-2", "nov-1"]);
  });

  it("renders a Download link per asset that opens the asset URL", async () => {
    h.cards = [
      { id: "a1", title: "Hero 9x16", stage: "Ready to Launch", due_date: "2026-11-02", brief: null, asset_url: "https://x.test/hero", decision: null },
      { id: "a2", title: "Static", stage: "Ready to Launch", due_date: "2026-10-02", brief: null, asset_url: "https://x.test/static", decision: null },
    ];
    renderPage(<ClientAssetsPage />);
    const months = await screen.findAllByTestId("client-asset-month");
    expect(months).toHaveLength(2);
    const link = within(months[0]).getByRole("link", { name: "Download" });
    expect(link).toHaveAttribute("href", "https://x.test/hero");
    expect(link).toHaveAttribute("target", "_blank");
  });
});

describe("Review: approve and request changes", () => {
  beforeEach(() => {
    h.cards = [
      { id: "t1", title: "Hero cut", stage: "Client Review", due_date: "2026-12-01", brief: null, asset_url: "https://x.test/hero", decision: null },
    ];
    h.comments = [
      { id: 1, thread: "client", body: "Looks close", created_at: "2026-11-10T10:00:00Z", author_user_id: "staff" },
      { id: 2, thread: "internal", body: "SECRET internal note", created_at: "2026-11-10T10:00:00Z", author_user_id: "staff" },
    ];
  });

  it("approves with one click", async () => {
    renderPage(<ClientReviewPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await screen.findByTestId("client-decision-sent");
    expect(h.rpcs.find((r) => r.fn === "os_client_decide")?.args).toEqual({ p_task_id: "t1", p_decision: "approved", p_note: null });
  });

  it("asks for a note before sending a change request", async () => {
    renderPage(<ClientReviewPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Request changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Send change request" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Please tell us what to change.");
    expect(h.rpcs.some((r) => r.fn === "os_client_decide")).toBe(false);
    fireEvent.change(screen.getByLabelText("What should we change?"), { target: { value: "  Shorter intro " } });
    fireEvent.click(screen.getByRole("button", { name: "Send change request" }));
    await screen.findByTestId("client-decision-sent");
    expect(h.rpcs.find((r) => r.fn === "os_client_decide")?.args).toEqual({ p_task_id: "t1", p_decision: "changes_requested", p_note: "Shorter intro" });
  });

  it("shows a plain message when the task already left review", async () => {
    h.decideError = { message: "x", code: "P0409" };
    renderPage(<ClientReviewPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This is no longer waiting for your review.");
  });

  it("shows the asset link and only the client thread", async () => {
    renderPage(<ClientReviewPage />);
    expect(await screen.findByRole("link", { name: "Open the asset" })).toHaveAttribute("href", "https://x.test/hero");
    expect(await screen.findByText("Looks close")).toBeInTheDocument();
    expect(screen.queryByText(/SECRET internal note/)).toBeNull();
  });

  it("offers no way to edit the title, date or status", async () => {
    renderPage(<ClientReviewPage />);
    await screen.findByText("Hero cut");
    const page = screen.getByTestId("client-review-page");
    // The only text inputs are the comment box (and the note box once opened).
    expect(within(page).getAllByRole("textbox").map((e) => e.getAttribute("aria-label"))).toEqual(["Add a comment"]);
    expect(within(page).queryByRole("combobox")).toBeNull();
  });
});

describe("no internal fields reach the page", () => {
  const leaky = {
    id: "t1",
    title: "Hero cut",
    stage: "Client Review",
    due_date: "2026-12-01",
    brief: "Brief text",
    asset_url: "https://x.test/hero",
    decision: null,
    status: "internal review edits",
    strategist_id: "STRATEGIST-UUID",
    hooks: ["SECRET HOOK"],
    stuck_reason: "SECRET STUCK",
    description: "SECRET DESCRIPTION",
  };

  it("drops unknown keys and bad links", () => {
    const [c] = toClientCards([{ ...leaky, asset_url: "javascript:alert(1)" }]);
    expect(Object.keys(c).sort()).toEqual(["asset_url", "brief", "decision", "due_date", "id", "stage", "title"]);
    expect(c.asset_url).toBeNull();
    expect(toClientCards([{ title: "no id" }, null, "x"])).toEqual([]);
  });

  it("renders none of them on Review, Briefs or home", async () => {
    h.cards = [leaky, { ...leaky, id: "b1", stage: "Preparing Content" }];
    for (const ui of [<ClientReviewPage key="r" />, <ClientBriefsPage key="b" />, <ClientHomeLead key="h" />]) {
      const { container, unmount } = renderPage(ui);
      await waitFor(() => expect(container.textContent).toContain("Hero cut"));
      for (const secret of ["STRATEGIST-UUID", "SECRET HOOK", "SECRET STUCK", "SECRET DESCRIPTION", "internal review edits"]) {
        expect(container.textContent).not.toContain(secret);
      }
      unmount();
    }
  });
});

describe("change request note rules", () => {
  it("needs text for changes and nothing for approval", () => {
    expect(noteProblem("approved", "")).toBeNull();
    expect(noteProblem("changes_requested", "   ")).toBe("Please tell us what to change.");
    expect(noteProblem("changes_requested", "x".repeat(1001))).toMatch(/under 1000/);
    expect(noteProblem("changes_requested", "Shorter")).toBeNull();
  });
});

describe("long lists stay cheap", () => {
  it("renders 1,000 delivered assets quickly", async () => {
    h.cards = Array.from({ length: 1000 }, (_, i) => ({
      id: `a${i}`,
      title: `Asset ${i}`,
      stage: "Ready to Launch",
      due_date: `2026-${String((i % 12) + 1).padStart(2, "0")}-10`,
      brief: null,
      asset_url: `https://x.test/${i}`,
      decision: null,
    }));
    const start = performance.now();
    renderPage(<ClientAssetsPage />);
    expect(await screen.findAllByTestId("client-asset-month")).toHaveLength(12);
    expect(screen.getAllByTestId("client-asset-row")).toHaveLength(1000);
    expect(performance.now() - start).toBeLessThan(3000);
  });
});
