/**
 * Knowledge (consolidation step 4a, port of the Goodo OS knowledge correction and
 * publication pages).
 *
 * - Lists sources with search, opens one with its current text and versions.
 * - Proposing a correction calls submit_knowledge_correction with the version on
 *   screen; a stale version shows the reload message.
 * - Review buttons only for corrections the signed-in person may review (not their
 *   own; procedure and permission for builders); publish and rollback for builders.
 * - model rules: status, canReview, canPublish, errorText, toSources.
 * The database rules themselves are in supabase/tests/knowledge_pages_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const rows: { current: unknown[] } = { current: [] };
const fail: { current: boolean } = { current: false };
let auth = { user: { id: "emp-1" }, isBuilder: false };

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (table: string) => ({
      select: () => ({
        order: () => Promise.resolve(table === "clients" ? { data: [{ slug: "glow", name: "Glow Drip" }], error: null } : fail.current && table !== "clients" ? { data: null, error: { message: "down" } } : { data: rows.current, error: null }),
      }),
    }),
  },
}));

import KnowledgePage from "@/features/knowledge/KnowledgePage";
import { canPublish, canReview, correctionStatus, errorText, type KnowledgeSource, toSources } from "@/features/knowledge/model";

const v = (version: number, body: string, kind = "create", extra: Record<string, unknown> = {}) => ({
  id: `v${version}`, version, body, kind, correction_id: null, rolled_back_to: null, reason: null, published_by: "b1", created_at: "2026-11-01T00:00:00Z", ...extra,
});
const SOURCE = {
  id: "s1", title: "Hook rules", namespace: "process", classification: "staff", release_scope: "global", client_slug: null,
  citation_url: "https://example.test/doc", current_version: 2, updated_at: "2026-11-02T00:00:00Z",
  knowledge_source_versions: [v(1, "Use three hooks."), v(2, "Use two hooks.", "publish", { correction_id: "c0" })],
  knowledge_corrections: [
    { id: "c1", source_id: "s1", source_version: 2, proposed_body: "Use four hooks.", reason: "New test", classification: "content", submitted_by: "emp-2", created_at: "2026-11-03T00:00:00Z", knowledge_correction_reviews: [] },
    { id: "c2", source_id: "s1", source_version: 2, proposed_body: "Ask first.", reason: "Process", classification: "procedure", submitted_by: "emp-2", created_at: "2026-11-03T01:00:00Z", knowledge_correction_reviews: [] },
    { id: "c3", source_id: "s1", source_version: 2, proposed_body: "Mine.", reason: "Mine", classification: "content", submitted_by: "emp-1", created_at: "2026-11-03T02:00:00Z", knowledge_correction_reviews: [] },
    { id: "c4", source_id: "s1", source_version: 2, proposed_body: "Use five hooks.", reason: "Accepted", classification: "factual", submitted_by: "emp-2", created_at: "2026-11-03T03:00:00Z", knowledge_correction_reviews: { decision: "accepted", reason: "ok", reviewer_id: "emp-1", created_at: "x" } },
  ],
};
const OTHER = { ...SOURCE, id: "s2", title: "Glow brand voice", release_scope: "client", client_slug: "glow", current_version: 1, knowledge_source_versions: [v(1, "Warm and plain.")], knowledge_corrections: [] };

beforeEach(() => {
  rpc.mockReset();
  rows.current = [SOURCE, OTHER];
  fail.current = false;
  auth = { user: { id: "emp-1" }, isBuilder: false };
});

async function open(title = "Hook rules") {
  render(<KnowledgePage />);
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(title) }));
  return screen.getByRole("region", { name: title });
}

describe("KnowledgePage", () => {
  it("shows a skeleton while loading, and Try again after a load error", async () => {
    fail.current = true;
    render(<KnowledgePage />);
    expect(screen.getByRole("status", { name: "Loading knowledge" })).toBeTruthy();
    expect(await screen.findByText("Knowledge could not load.")).toBeTruthy();
    fail.current = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /Hook rules/ })).toBeTruthy();
    expect(screen.queryByText("Knowledge could not load.")).toBeNull();
  });

  it("lists and searches sources, and shows the open review count", async () => {
    render(<KnowledgePage />);
    expect(await screen.findByRole("button", { name: /Hook rules · v2 · all clients · 3 to review/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search knowledge"), { target: { value: "warm" } });
    expect(screen.queryByRole("button", { name: /Hook rules/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Glow brand voice/ })).toBeTruthy();
    expect(screen.queryByText(/Add knowledge/)).toBeNull(); // employees do not add sources
  });

  it("opens a source with its current text and sends a correction against the version on screen", async () => {
    rpc.mockResolvedValue({ data: "c9", error: null });
    const region = await open();
    expect(within(region).getByTestId("knowledge-current-body")).toHaveTextContent("Use two hooks.");
    const send = within(region).getByRole("button", { name: "Send for review" });
    expect(send).toBeDisabled();
    fireEvent.change(within(region).getByLabelText("Corrected text"), { target: { value: "Use one hook." } });
    fireEvent.change(within(region).getByLabelText("Why"), { target: { value: "Fresh data" } });
    fireEvent.change(within(region).getByLabelText("Kind of correction"), { target: { value: "factual" } });
    fireEvent.click(send);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("submit_knowledge_correction", {
      p_source_id: "s1", p_source_version: 2, p_proposed_body: "Use one hook.", p_reason: "Fresh data", p_classification: "factual",
    }));
    expect(await within(region).findByRole("status")).toHaveTextContent("Correction sent for review.");
  });

  it("explains a stale version", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "changed" } });
    const region = await open();
    fireEvent.change(within(region).getByLabelText("Corrected text"), { target: { value: "Use one hook." } });
    fireEvent.change(within(region).getByLabelText("Why"), { target: { value: "x" } });
    fireEvent.click(within(region).getByRole("button", { name: "Send for review" }));
    expect(await within(region).findByRole("alert")).toHaveTextContent("changed since you opened it");
  });

  it("an employee reviews another person's content correction, not their own and not a procedure one", async () => {
    rpc.mockResolvedValue({ data: "r1", error: null });
    const region = await open();
    const c1 = within(region).getByTestId("correction-c1");
    expect(within(within(region).getByTestId("correction-c2")).queryByRole("button", { name: "Accept" })).toBeNull();
    expect(within(within(region).getByTestId("correction-c3")).queryByRole("button", { name: "Accept" })).toBeNull();
    fireEvent.click(within(c1).getByRole("button", { name: "Accept" }));
    expect(await within(c1).findByRole("alert")).toHaveTextContent("Add a reason");
    fireEvent.change(within(c1).getByLabelText("Review reason"), { target: { value: "Checked" } });
    fireEvent.click(within(c1).getByRole("button", { name: "Conflict" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("review_knowledge_correction", { p_correction_id: "c1", p_decision: "conflict", p_reason: "Checked" }));
    // No publish or rollback for an employee.
    expect(within(region).queryByRole("button", { name: /Publish/ })).toBeNull();
    expect(within(region).queryByRole("button", { name: /Roll back/ })).toBeNull();
  });

  it("a builder adds sources, publishes an accepted correction and rolls back", async () => {
    auth = { user: { id: "b1" }, isBuilder: true };
    rpc.mockResolvedValue({ data: 3, error: null });
    const region = await open();
    expect(screen.getByText(/Add knowledge/)).toBeTruthy();
    expect(within(within(region).getByTestId("correction-c2")).getByRole("button", { name: "Accept" })).toBeTruthy();
    fireEvent.click(within(within(region).getByTestId("correction-c4")).getByRole("button", { name: "Publish as version 3" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("publish_knowledge_correction", { p_correction_id: "c4" }));
    // Rolling back asks first; Cancel sends nothing.
    rpc.mockClear();
    fireEvent.click(within(region).getByRole("button", { name: "Roll back to this" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Roll back to version 1?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(rpc).not.toHaveBeenCalledWith("rollback_knowledge_source", expect.anything());
    fireEvent.click(within(region).getByRole("button", { name: "Roll back to this" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Roll back" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("rollback_knowledge_source", expect.objectContaining({ p_source_id: "s1", p_to_version: 1, p_expected_version: 2 })));
  });

  it("a builder adds a source for one client", async () => {
    auth = { user: { id: "b1" }, isBuilder: true };
    rpc.mockResolvedValue({ data: "s3", error: null });
    render(<KnowledgePage />);
    fireEvent.click(await screen.findByText(/Add knowledge/));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Glow offers" } });
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Free shipping over 50." } });
    fireEvent.change(screen.getByLabelText("Applies to"), { target: { value: "client" } });
    fireEvent.change(await screen.findByLabelText("Client"), { target: { value: "glow" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("create_knowledge_source", expect.objectContaining({
      p_title: "Glow offers", p_release_scope: "client", p_client_slug: "glow", p_classification: "staff",
    })));
  });

  it("says when there is no knowledge yet", async () => {
    rows.current = [];
    render(<KnowledgePage />);
    expect(await screen.findByText("No knowledge has been added yet.")).toBeTruthy();
  });
});

describe("model", () => {
  const [s] = toSources([SOURCE]) as KnowledgeSource[];
  const byId = (id: string) => s.corrections.find((c) => c.id === id)!;

  it("sorts versions newest first and takes the review from an object or an array", () => {
    expect(s.versions.map((x) => x.version)).toEqual([2, 1]);
    expect(byId("c4").review?.decision).toBe("accepted");
    expect(byId("c1").review).toBeNull();
  });

  it("status, review and publish rules", () => {
    expect(correctionStatus(byId("c1"), s)).toBe("open");
    expect(correctionStatus(byId("c4"), s)).toBe("accepted");
    expect(correctionStatus({ ...byId("c1"), id: "c0" }, s)).toBe("published");
    expect(canReview(byId("c1"), "emp-1", false)).toBe(true);
    expect(canReview(byId("c3"), "emp-1", false)).toBe(false);
    expect(canReview(byId("c2"), "emp-1", false)).toBe(false);
    expect(canReview(byId("c2"), "b1", true)).toBe(true);
    expect(canReview(byId("c1"), undefined, true)).toBe(false);
    expect(canPublish(byId("c4"), s, true)).toBe(true);
    expect(canPublish(byId("c4"), s, false)).toBe(false);
    expect(canPublish(byId("c4"), { ...s, current_version: 3 }, true)).toBe(false);
    expect(canPublish({ ...byId("c4"), classification: "procedure" }, s, true)).toBe(false);
  });

  it("errorText maps database codes", () => {
    expect(errorText("42501", "x")).toMatch(/not allowed/);
    expect(errorText("23505", "x")).toMatch(/already has a review/);
    expect(errorText("99999", "fallback")).toBe("fallback");
  });
});
