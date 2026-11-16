/**
 * Vault library deletes (audit plan item 4.6).
 *
 * - Deleting one item from a card's menu removed it straight away, with no
 *   confirmation, while bulk delete asked first. Single delete now asks too.
 * - Both deletes said "Deleted" even when nothing was removed: RLS turns a
 *   delete the user is not allowed to make (for example a teammate's item)
 *   into a silent no-op that returns no error. The delete now asks for the
 *   removed ids back and reports what actually happened.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";

const ROWS = ["it0", "it1"].map((id, i) => ({
  id,
  user_id: "u1",
  status: "ready",
  platform: "facebook_ad",
  title: `Item ${i}`,
  thumbnail_path: null,
  file_path: null,
  thumbnail_url: null,
  video_url: null,
  creator_handle: null,
  brand_name: null,
  error_message: null,
  is_featured: false,
  created_at: "2026-08-01T00:00:00Z",
  inspiration_transcripts: [],
  inspiration_frameworks: [],
}));

/** ids the next delete reports as removed; `null` means "whatever was asked". */
let DELETED_IDS: string[] | null = null;
const deleteCalls: { ids: string[]; selectedId: boolean }[] = [];

function tableBuilder(rows: unknown[]) {
  let deleting = false;
  let ids: string[] = [];
  let selectedId = false;
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = vi.fn((cols?: string) => {
    if (deleting && cols === "id") selectedId = true;
    return builder;
  });
  builder.delete = vi.fn(() => {
    deleting = true;
    return builder;
  });
  let featuredOnly = false;
  builder.eq = vi.fn((col: string, val: string | boolean) => {
    if (deleting && col === "id") ids = [String(val)];
    if (col === "is_featured" && val === true) featuredOnly = true;
    return builder;
  });
  builder.in = vi.fn((col: string, vals: string[]) => {
    if (deleting && col === "id") ids = vals;
    return builder;
  });
  builder.order = vi.fn(chain);
  builder.update = vi.fn(chain);
  builder.range = vi.fn(chain);
  builder.then = (resolve: (v: unknown) => void) => {
    if (deleting) {
      deleteCalls.push({ ids, selectedId });
      const removed = DELETED_IDS ?? ids;
      return resolve({ data: selectedId ? removed.map((id) => ({ id })) : null, error: null });
    }
    return resolve({ data: featuredOnly ? [] : rows, error: null });
  };
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((table: string) => (table === "inspiration_items" ? tableBuilder(ROWS) : tableBuilder([]))),
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(),
        createSignedUrls: vi.fn(async () => ({ data: [], error: null })),
      })),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The card's own menu is a Radix dropdown; these tests are about what the page does with
// the card's callbacks, so the card is a pair of plain buttons.
vi.mock("@/features/vault/components/InspirationCard", () => ({
  InspirationCard: ({ item, onDelete, onSelect }: {
    item: { id: string };
    onDelete?: (id: string) => void;
    onSelect?: (id: string) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onSelect?.(item.id)}>Select {item.id}</button>
      <button type="button" onClick={() => onDelete?.(item.id)}>Delete {item.id}</button>
    </div>
  ),
}));

import LibraryPage from "@/features/vault/LibraryPage";

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
  deleteCalls.length = 0;
  DELETED_IDS = null;
});

describe("Vault library single delete", () => {
  it("asks before deleting one item", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Delete it0" }));

    expect(deleteCalls).toHaveLength(0);
    expect(await screen.findByText(/delete this item permanently/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /yes, delete/i }));
    await waitFor(() => expect(deleteCalls).toHaveLength(1));
    expect(deleteCalls[0].ids).toEqual(["it0"]);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("does nothing when the confirmation is cancelled", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Delete it0" }));
    fireEvent.click(await screen.findByRole("button", { name: /^cancel$/i }));
    await waitFor(() => expect(screen.queryByText(/delete this item permanently/i)).toBeNull());
    expect(deleteCalls).toHaveLength(0);
  });

  it("says so when nothing was deleted", async () => {
    DELETED_IDS = [];
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Delete it0" }));
    fireEvent.click(await screen.findByRole("button", { name: /yes, delete/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(deleteCalls[0].selectedId).toBe(true);
    expect(String(vi.mocked(toast.error).mock.calls[0][0])).toMatch(/not deleted|couldn't delete/i);
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("Vault library bulk delete", () => {
  async function bulkDeleteBoth() {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Select it0" }));
    fireEvent.click(screen.getByRole("button", { name: "Select it1" }));
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /yes, delete/i }));
    await waitFor(() => expect(deleteCalls).toHaveLength(1));
  }

  it("reports the number deleted when every item goes", async () => {
    await bulkDeleteBoth();
    expect(deleteCalls[0].selectedId).toBe(true);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/2 items/)));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("says how many were not deleted when only some go", async () => {
    DELETED_IDS = ["it0"];
    await bulkDeleteBoth();
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(vi.mocked(toast.error).mock.calls[0][0])).toMatch(/1 of 2/);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
