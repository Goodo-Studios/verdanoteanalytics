/**
 * Client BIDs (consolidation step 6): read-only BID viewer.
 *
 * - The selected client's latest BID version opens first; no client selected asks for one; a client without a BID says so.
 * - The BID renders as markdown with a section list, its metadata and a made-up label.
 * - An older version can be picked; the page has no inputs that write anything.
 * - Empty and failed loads say so.
 * - model rules (sections, latest per client).
 * The database rules are in supabase/tests/client_bids_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WithClient } from "./clientSelection";

const data: Record<string, unknown[]> = {};
const errors: Record<string, { message: string } | null> = {};
const calls: Array<{ table: string; select: string; filters: Array<[string, unknown]> }> = [];
const rpc = vi.fn();

function chain(table: string, select: string) {
  const call = { table, select, filters: [] as Array<[string, unknown]> };
  calls.push(call);
  const q = {
    eq: (c: string, v: unknown) => (call.filters.push([c, v]), q),
    order: () => q,
    limit: () => q,
    then: (resolve: (v: unknown) => unknown) => {
      let rows = data[table] ?? [];
      const id = call.filters.find(([c]) => c === "id")?.[1];
      if (id) rows = rows.filter((r) => (r as { id: string }).id === id);
      return Promise.resolve({ data: errors[table] ? null : rows, error: errors[table] ?? null }).then(resolve);
    },
  };
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (table: string) => ({ select: (s: string) => chain(table, s) }),
  },
}));

import BidViewerPage from "@/features/bids/BidViewerPage";
import { latestByClient, splitSections, type BidSummary } from "@/features/bids/model";

const CLIENTS = [{ slug: "demo-glowdrip", name: "Glowdrip (demo)" }, { slug: "no-bid", name: "No BID client" }] as never[];
const page = (slug: string) => <WithClient slug={slug} clients={CLIENTS}><BidViewerPage /></WithClient>;

const v = (version: number, body: string, over: Record<string, unknown> = {}) => ({
  id: `b${version}`, client_slug: "demo-glowdrip", version, title: "Glowdrip (demo) BID", source: "staging-seed", data_origin: "made_up",
  generated_at: `2026-11-0${version}T00:00:00Z`, imported_at: "2026-11-10T00:00:00Z", body_markdown: body, body_sha256: "0".repeat(64), source_ref: "seed", ...over,
});

beforeEach(() => {
  calls.length = 0;
  rpc.mockReset();
  errors.client_bids = null;
  data.clients = [{ slug: "demo-glowdrip", name: "Glowdrip (demo)" }, { slug: "no-bid", name: "No BID client" }];
  data.client_bids = [
    v(2, "# Glowdrip\n\n> Made-up staging BID.\n\n## 1. Company Analysis\n\nThe **latest** text.\n\n## 2. Offer & Funnel Context\n\n- Point A"),
    v(1, "## 1. Company Analysis\n\nThe older text."),
  ];
});

describe("BidViewerPage", () => {
  it("opens the latest version of the selected client's BID as markdown with sections", async () => {
    render(page("demo-glowdrip"));
    const article = await screen.findByRole("article", { name: "BID Glowdrip (demo) BID" });
    expect(within(article).getByText("latest").tagName).toBe("STRONG");
    expect(within(article).getByRole("heading", { level: 2, name: "1. Company Analysis" })).toBeTruthy();
    expect(screen.getByTestId("bid-meta")).toHaveTextContent("version 2");
    expect(screen.getByTestId("bid-meta")).toHaveTextContent("Made-up staging BID");
    const nav = screen.getByRole("navigation", { name: "BID sections" });
    expect(within(nav).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["#bid-1-company-analysis", "#bid-2-offer-funnel-context"]);
    const listCall = calls.find((c) => c.table === "client_bids" && !c.filters.length);
    expect(listCall?.select).not.toMatch(/body_markdown/);
  });

  it("switches to an older version and has nothing to edit", async () => {
    render(page("demo-glowdrip"));
    await screen.findByRole("article");
    fireEvent.change(screen.getByLabelText("Version"), { target: { value: "b1" } });
    await waitFor(() => expect(screen.getByTestId("bid-meta")).toHaveTextContent("version 1"));
    expect(screen.getByText("The older text.")).toBeTruthy();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("says when the selected client has no BID and asks for a client when none is selected", async () => {
    const { unmount } = render(page("no-bid"));
    expect(await screen.findByText("This client has no BID loaded yet.")).toBeTruthy();
    unmount();
    render(page(""));
    expect(screen.getByText(/Pick a client in the switcher at the top of the page to see its BID/)).toBeTruthy();
  });

  it("says when no BID is loaded and when loading fails", async () => {
    data.client_bids = [];
    const { unmount } = render(page(""));
    expect(await screen.findByText("No client BIDs have been loaded yet.")).toBeTruthy();
    unmount();
    errors.client_bids = { message: "boom" };
    render(page(""));
    expect(await screen.findByRole("alert")).toHaveTextContent("Client BIDs could not load.");
  });
});

describe("BID model", () => {
  it("splits at level-2 headings, keeps the intro and ignores headings in code", () => {
    const s = splitSections("# Title\n\nIntro\n\n## 1. A\n\nText\n\n```\n## not a heading\n```\n\n### Sub\n\n## 2. B\n");
    expect(s.map((x) => x.heading)).toEqual(["", "1. A", "2. B"]);
    expect(s[0].anchor).toBe("bid-intro");
    expect(s[1].body).toMatch(/## not a heading/);
    expect(s[1].body).toMatch(/### Sub/);
  });

  it("gives repeated headings distinct anchors", () => {
    expect(splitSections("## Notes\n\na\n\n## Notes\n\nb").map((x) => x.anchor)).toEqual(["bid-notes", "bid-notes-2"]);
  });

  it("orders each client's versions latest first", () => {
    const rows = [{ client_slug: "a", version: 1 }, { client_slug: "a", version: 3 }, { client_slug: "b", version: 1 }] as BidSummary[];
    expect(latestByClient(rows).get("a")?.map((r) => r.version)).toEqual([3, 1]);
  });
});
