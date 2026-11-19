/**
 * Vault library: bulk download of ticked items, and search that covers the literal words in the
 * script, brand and other metadata (not only the semantic match).
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  user_id: "u1",
  status: "ready",
  platform: "facebook_ad",
  title: `Item ${id}`,
  thumbnail_path: null,
  file_path: null,
  thumbnail_url: null,
  video_url: null,
  creator_handle: null,
  brand_name: null,
  error_message: null,
  is_featured: false,
  created_at: "2026-08-01T00:00:00Z",
  inspiration_transcripts: null,
  inspiration_frameworks: null,
  ...extra,
});

const GRID_ROWS = [
  row("a", { file_path: "uploads/u1/a.mp4" }),
  row("b", { file_path: "uploads/u1/b.mp4" }),
  row("c"),
];
const MATCH_ROW = row("m1", { title: "Found by script" });

const calls: { table: string; method: string; args: unknown[] }[] = [];
const createSignedUrls = vi.fn(async (paths: string[], _ttl?: number, opts?: unknown) => ({
  data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example/${p}`, error: null })),
  error: null,
  opts,
}));

function builderFor(table: string) {
  const state = { idOnly: false, ranged: false, inList: false };
  const b: Record<string, unknown> = {};
  const record = (method: string) =>
    vi.fn((...args: unknown[]) => {
      calls.push({ table, method, args });
      if (method === "select" && args[0] === "id") state.idOnly = true;
      if (method === "range") state.ranged = true;
      if (method === "in") state.inList = true;
      return b;
    });
  for (const m of ["select", "eq", "order", "or", "ilike", "limit", "range", "in", "update", "delete"]) b[m] = record(m);
  b.then = (resolve: (v: unknown) => void) => {
    if (table === "inspiration_items") {
      if (state.idOnly) return resolve({ data: [{ id: "m1" }], error: null });
      if (state.inList) return resolve({ data: [MATCH_ROW], error: null });
      return resolve({ data: state.ranged ? GRID_ROWS : [], error: null });
    }
    if (table === "inspiration_transcripts") return resolve({ data: [{ item_id: "m1" }], error: null });
    return resolve({ data: [], error: null });
  };
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((table: string) => builderFor(table)),
    storage: { from: vi.fn(() => ({ createSignedUrl: vi.fn(), createSignedUrls })) },
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "t" } } })) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/vault/components/InspirationCard", () => ({
  InspirationCard: ({ item, onSelect }: { item: { id: string; title: string | null }; onSelect?: (id: string) => void }) => (
    <div>
      <span>{item.title}</span>
      <button type="button" onClick={() => onSelect?.(item.id)}>Select {item.id}</button>
    </div>
  ),
}));
vi.mock("@/features/vault/bulkDownload", async (orig) => {
  const actual = await orig<typeof import("@/features/vault/bulkDownload")>();
  const trigger = vi.fn();
  return {
    ...actual,
    downloadVaultItems: (items: Parameters<typeof actual.downloadVaultItems>[0]) =>
      actual.downloadVaultItems(items, {
        sign: async (paths) => (await createSignedUrls(paths, 600, { download: true })).data,
        trigger,
        pause: async () => undefined,
      }),
    __trigger: trigger,
  };
});

import LibraryPage from "@/features/vault/LibraryPage";
import * as bulk from "@/features/vault/bulkDownload";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LibraryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  // The semantic search call fails: text matches must still show.
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "down" }) })));
});

describe("Vault library bulk download", () => {
  it("downloads the stored file of each ticked item and reports the result", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Select a" }));
    fireEvent.click(screen.getByRole("button", { name: "Select c" }));
    fireEvent.click(screen.getByRole("button", { name: /^download$/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    // Item a has a file, item c has none: one download starts, one is reported as skipped.
    expect(createSignedUrls).toHaveBeenCalledWith(["uploads/u1/a.mp4"], 600, { download: true });
    expect((bulk as unknown as { __trigger: ReturnType<typeof vi.fn> }).__trigger).toHaveBeenCalledWith(
      "https://signed.example/uploads/u1/a.mp4",
    );
    expect(String(vi.mocked(toast.error).mock.calls[0][0])).toMatch(/1 of 2 had no saved file/);
  });

  it("selects every shown item with Select all shown", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Select a" }));
    fireEvent.click(screen.getByRole("button", { name: /select all shown/i }));
    expect(await screen.findByText("3 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^download$/i }));
    await waitFor(() => expect(createSignedUrls).toHaveBeenCalled());
    expect(createSignedUrls.mock.calls[0][0]).toEqual(["uploads/u1/a.mp4", "uploads/u1/b.mp4"]);
  });
});

describe("Vault library text search", () => {
  it("finds an item by script, brand and other metadata even when semantic search fails", async () => {
    renderPage();
    await screen.findByText("Item a");

    fireEvent.change(screen.getByPlaceholderText(/search script, brand, title, hooks, tags/i), {
      target: { value: "free shipping" },
    });

    expect(await screen.findByText("Found by script", {}, { timeout: 3000 })).toBeInTheDocument();

    const on = (table: string, method: string) => calls.filter((c) => c.table === table && c.method === method);
    // Script text, with the typed words as an ilike pattern.
    expect(on("inspiration_transcripts", "ilike").some((c) => c.args[0] === "cleaned_script" && c.args[1] === "%free shipping%")).toBe(true);
    // Item metadata: brand, title and the rest, in one or filter.
    const itemOr = String(on("inspiration_items", "or")[0].args[0]);
    for (const col of ["brand_name", "title", "ad_body_text", "industry"]) expect(itemOr).toContain(`${col}.ilike.%free shipping%`);
    // Hooks and tags.
    expect(String(on("inspiration_frameworks", "or")[0].args[0])).toContain("hook_verbal.ilike.%free shipping%");
    expect(on("inspiration_tags", "ilike").some((c) => c.args[0] === "tag")).toBe(true);
  });
});
