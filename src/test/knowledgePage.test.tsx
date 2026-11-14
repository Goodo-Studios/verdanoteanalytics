/**
 * Knowledge: staff edit documents directly (replaces the correction and review flow).
 *
 * - Lists sources with search and opens one with its current text (rendered markdown).
 * - Only the newest version of each source is requested.
 * - Edit opens the document editor; Save calls edit_knowledge_source with the version on screen
 *   and the new text shows at once; Cancel sends nothing; a stale version shows the message.
 * - The change-request controls (propose a correction, review, publish, roll back, version
 *   list) are gone.
 * - A builder still adds sources.
 * - model rules: toSources, currentVersion, errorText.
 * The database rules are in supabase/tests/os_edit_knowledge_documents_test.sql and
 * supabase/tests/knowledge_pages_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const calls: string[] = [];
const rows: { current: unknown[] } = { current: [] };
const fail: { current: boolean } = { current: false };
let auth = { user: { id: "emp-1" }, isBuilder: false };

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => {
  const query = (table: string) => {
    const q = {
      order: (column: string, opts?: unknown) => { calls.push(`order ${column} ${JSON.stringify(opts ?? null)}`); return q; },
      limit: (n: number, opts?: unknown) => { calls.push(`limit ${n} ${JSON.stringify(opts ?? null)}`); return q; },
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
        Promise.resolve(
          table === "clients"
            ? { data: [{ slug: "glow", name: "Glow Drip" }], error: null }
            : fail.current ? { data: null, error: { message: "down" } } : { data: rows.current, error: null },
        ).then(ok, bad),
    };
    return q;
  };
  return {
    supabase: {
      rpc: (...args: unknown[]) => rpc(...args),
      from: (table: string) => ({ select: () => query(table) }),
    },
  };
});

import KnowledgePage from "@/features/knowledge/KnowledgePage";
import { currentVersion, errorText, matchesSearch, type KnowledgeSource, toSources } from "@/features/knowledge/model";

const v = (version: number, body: string, kind = "create") => ({
  id: `v${version}`, version, body, kind, correction_id: null, rolled_back_to: null, reason: null, published_by: "b1", created_at: "2026-11-01T00:00:00Z",
});
const SOURCE = {
  id: "s1", title: "Hook rules", namespace: "process", classification: "staff", release_scope: "global", client_slug: null,
  citation_url: "https://example.test/doc", current_version: 2, updated_at: "2026-11-02T00:00:00Z",
  knowledge_source_versions: [v(2, "Use two hooks.\n\n- keep it short", "edit")],
};
const OTHER = { ...SOURCE, id: "s2", title: "Glow brand voice", release_scope: "client", client_slug: "glow", current_version: 1, knowledge_source_versions: [v(1, "Warm and plain.")] };

beforeEach(() => {
  rpc.mockReset();
  calls.length = 0;
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

  it("lists and searches sources and asks for only the newest version of each", async () => {
    render(<KnowledgePage />);
    expect(await screen.findByRole("button", { name: /Hook rules · all clients/ })).toBeTruthy();
    expect(calls).toContain('order version {"ascending":false,"referencedTable":"knowledge_source_versions"}');
    expect(calls).toContain('limit 1 {"referencedTable":"knowledge_source_versions"}');
    fireEvent.change(screen.getByLabelText("Search knowledge"), { target: { value: "warm" } });
    expect(screen.queryByRole("button", { name: /Hook rules/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Glow brand voice/ })).toBeTruthy();
    expect(screen.queryByText(/Add knowledge/)).toBeNull(); // employees do not add sources
  });

  it("opens a source and shows its current text as formatted text, with no change-request controls", async () => {
    const region = await open();
    const body = within(region).getByTestId("knowledge-current-body");
    expect(body).toHaveTextContent("Use two hooks.");
    expect(body.querySelectorAll("li")).toHaveLength(1);
    for (const gone of [/Propose a correction/, /Send for review/, /Roll back/, /Publish/, /Versions/, /Corrections/]) {
      expect(within(region).queryByText(gone)).toBeNull();
      expect(within(region).queryByRole("button", { name: gone })).toBeNull();
    }
    expect(screen.queryByText(/to review/)).toBeNull();
  });

  it("an employee edits a source: Save sends the version on screen and the new text shows at once", async () => {
    rpc.mockImplementation(async () => {
      rows.current = [{ ...SOURCE, current_version: 3, knowledge_source_versions: [v(3, "Use one hook.", "edit")] }, OTHER];
      return { data: 3, error: null };
    });
    const region = await open();
    fireEvent.click(within(region).getByRole("button", { name: "Edit" }));
    const editor = within(region).getByTestId("document-editor");
    const save = within(editor).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    expect(within(editor).getByLabelText("Document text")).toHaveProperty("value", "Use two hooks.\n\n- keep it short");
    fireEvent.change(within(editor).getByLabelText("Document text"), { target: { value: "Use one hook." } });
    fireEvent.click(save);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("edit_knowledge_source", { p_source_id: "s1", p_body: "Use one hook.", p_expected_version: 2 }));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Hook rules" })).getByTestId("knowledge-current-body")).toHaveTextContent("Use one hook."));
    expect(screen.queryByTestId("document-editor")).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("Cancel leaves the text alone and sends nothing", async () => {
    const region = await open();
    fireEvent.click(within(region).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(region).getByLabelText("Document text"), { target: { value: "Changed" } });
    fireEvent.click(within(region).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("document-editor")).toBeNull();
    expect(within(region).getByTestId("knowledge-current-body")).toHaveTextContent("Use two hooks.");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("explains a stale version and keeps the text in the editor", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "changed" } });
    const region = await open();
    fireEvent.click(within(region).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(region).getByLabelText("Document text"), { target: { value: "Use one hook." } });
    fireEvent.click(within(region).getByRole("button", { name: "Save" }));
    expect(await within(region).findByRole("alert")).toHaveTextContent("changed this document since you opened it");
    expect(within(region).getByLabelText("Document text")).toHaveProperty("value", "Use one hook.");
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

  it("takes the current version, from an array or a single object, newest first", () => {
    expect(currentVersion(s)?.body).toBe("Use two hooks.\n\n- keep it short");
    const many = toSources([{ ...SOURCE, knowledge_source_versions: [v(1, "a"), v(2, "b")] }])[0];
    expect(many.versions.map((x) => x.version)).toEqual([2, 1]);
    expect(toSources([{ ...SOURCE, knowledge_source_versions: v(2, "one") }])[0].versions).toHaveLength(1);
    expect(toSources(null)).toEqual([]);
  });

  it("searches title, topic, client and text", () => {
    expect(matchesSearch(s, "two hooks")).toBe(true);
    expect(matchesSearch(s, "process")).toBe(true);
    expect(matchesSearch(s, "nothing like this")).toBe(false);
    expect(matchesSearch(s, "  ")).toBe(true);
  });

  it("errorText maps database codes", () => {
    expect(errorText("40001", "x")).toMatch(/changed this document since you opened it/);
    expect(errorText("42501", "x")).toMatch(/not allowed/);
    expect(errorText("22023", "x")).toMatch(/Nothing changed/);
    expect(errorText("99999", "fallback")).toBe("fallback");
  });
});
