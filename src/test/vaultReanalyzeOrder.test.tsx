/**
 * Regression: Vault re-analyze must not pin an item at "Analyzing…".
 *
 * Root bug: ItemDetailPage's re-analyze called vault-analyze and awaited it, THEN
 * wrote status='analyzing'. But vault-analyze runs synchronously and writes the
 * terminal status ('ready'/'error') before responding — so the client's
 * post-fetch write clobbered the result and the item was stuck at 'analyzing'
 * forever, even on a successful analysis.
 *
 * The fix flips the ordering: write status='analyzing' BEFORE the fetch, let
 * vault-analyze's own terminal write land last, and revert to 'error' only if the
 * call never completes. These tests pin the ordering so it can't regress.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Shared ordering log — records the sequence of the 'analyzing' status write and
// the vault-analyze fetch so a test can assert the write happens BEFORE the call.
const order: string[] = [];

const READY_ITEM = {
  id: "it1",
  user_id: "u1",
  platform: "facebook_ad",
  title: "VID_UGC_PDP_JACKIE TESTIMONIAL",
  creator_handle: null,
  source_url: null,
  thumbnail_url: "https://cdn/thumb.jpg",
  video_url: null,
  file_path: "analytics/u1/123/media.mp4",
  brand_name: "Acme",
  industry: null,
  ad_format: null,
  target_audience: null,
  script_analysis: "s",
  visual_analysis: "v",
  status: "ready",
  error_message: null,
  created_at: "2026-07-02T00:00:00Z",
  inspiration_transcripts: [{ id: "t1", item_id: "it1", cleaned_script: "hi" }],
  inspiration_frameworks: [],
};

// Chainable supabase query-builder stub. Thenable so `await …update().eq().select()`
// and `await …delete().eq()` resolve; `.single()` serves the initial item query.
function makeBuilder() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = vi.fn(chain);
  builder.delete = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.update = vi.fn((payload: { status?: string }) => {
    if (payload?.status) order.push(`update:${payload.status}`);
    return builder;
  });
  builder.single = vi.fn(async () => ({ data: READY_ITEM, error: null }));
  // Awaiting the builder (update/delete terminals) resolves to a success shape.
  builder.then = (resolve: (v: unknown) => void) =>
    resolve({ data: [{ id: "it1" }], error: null });
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => makeBuilder()),
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(async () => ({
          data: { signedUrl: "https://signed/media.mp4" },
          error: null,
        })),
      })),
    },
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: "tok" } } })),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "" }));
vi.mock("./hooks/useItemStatus", () => ({ useItemStatus: () => undefined }));
vi.mock("@/features/vault/hooks/useItemStatus", () => ({ useItemStatus: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Stub heavy child components down to trivial markers.
vi.mock("./components/FrameworkPanel", () => ({ FrameworkPanel: () => null }));
vi.mock("./components/TagInput", () => ({ TagInput: () => null }));
vi.mock("./components/AddToBoardModal", () => ({ AddToBoardModal: () => null }));
vi.mock("./components/CopyButton", () => ({ CopyButton: () => null }));
vi.mock("./components/VaultShareControl", () => ({ VaultShareControl: () => null }));

import ItemDetailPage from "@/features/vault/ItemDetailPage";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/ad-library/it1"]}>
        <Routes>
          <Route path="/ad-library/:id" element={<ItemDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  order.length = 0;
  vi.clearAllMocks();
  // vault-analyze runs synchronously and writes the terminal status itself; the
  // mocked fetch just records that it was called and returns ok.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      order.push("fetch");
      return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
    }),
  );
});

describe("Vault re-analyze ordering", () => {
  it("writes status='analyzing' BEFORE calling vault-analyze (never after)", async () => {
    renderPage();

    const btn = await screen.findByLabelText("Re-analyze item");
    fireEvent.click(btn);

    await waitFor(() => expect(order).toContain("fetch"));

    // The 'analyzing' write must precede the vault-analyze call, and there must be
    // exactly one such write — a post-fetch write is the regression this guards.
    const analyzingWrites = order.filter((o) => o === "update:analyzing");
    expect(analyzingWrites).toHaveLength(1);
    expect(order.indexOf("update:analyzing")).toBeLessThan(order.indexOf("fetch"));
    // Nothing writes 'analyzing' after the fetch resolves.
    expect(order.lastIndexOf("update:analyzing")).toBeLessThan(order.indexOf("fetch"));
  });
});
