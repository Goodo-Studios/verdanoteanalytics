/**
 * Vault share-link feature — public viewer + share control.
 *
 * PublicVaultItemPage: resolves a share token through the vault-share-item edge
 * function (supabase.functions.invoke) and renders the creative + full AI
 * analysis read-only; a revoked / unknown token degrades to a calm
 * "no longer available" state (it must NOT leak internal errors).
 *
 * VaultShareControl: an un-shared item shows "Share" which mints a token and
 * copies the /vault/share/:token URL to the clipboard; a shared item exposes
 * copy + disable affordances.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { supabase } from "@/integrations/supabase/client";
import PublicVaultItemPage from "@/pages/PublicVaultItemPage";
import { VaultShareControl } from "@/features/vault/components/VaultShareControl";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PublicVaultItemPage", () => {
  it("renders the shared item's brand, framework, and analysis (full detail)", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: {
        item: {
          id: "it1",
          platform: "facebook_ad",
          creator_handle: "acme",
          title: "Spring promo",
          source_url: null,
          thumbnail_url: "https://cdn/thumb.jpg",
          video_url: null,
          file_path: null,
          ad_body_text: "Buy now",
          brand_name: "Acme Co",
          industry: "Beauty",
          ad_format: "Testimonial",
          target_audience: "Women 25-40",
          script_analysis: "Strong hook.",
          visual_analysis: "Bright palette.",
          status: "ready",
          created_at: "2026-06-01T00:00:00Z",
        },
        transcript: { cleaned_script: "Hello there", duration_seconds: 30, word_count: 2 },
        framework: { id: "f1", item_id: "it1", copywriting_framework: "PAS" },
        signed_url: null,
      },
      error: null,
    } as never);

    const Wrap = wrapper();
    render(
      <Wrap>
        <MemoryRouter initialEntries={["/vault/share/tok123"]}>
          <Routes>
            <Route path="/vault/share/:token" element={<PublicVaultItemPage />} />
          </Routes>
        </MemoryRouter>
      </Wrap>,
    );

    expect(await screen.findByText("Acme Co")).toBeInTheDocument();
    expect(screen.getByText("Buy now")).toBeInTheDocument();
    // Resolve was called with the token + resolve action (no auth needed).
    expect(supabase.functions.invoke).toHaveBeenCalledWith("vault-share-item", {
      body: { action: "resolve", token: "tok123" },
    });
  });

  it("degrades to a calm unavailable state on a revoked/unknown token", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: null,
      error: { message: "not found" },
    } as never);

    const Wrap = wrapper();
    render(
      <Wrap>
        <MemoryRouter initialEntries={["/vault/share/dead"]}>
          <Routes>
            <Route path="/vault/share/:token" element={<PublicVaultItemPage />} />
          </Routes>
        </MemoryRouter>
      </Wrap>,
    );

    expect(
      await screen.findByText(/no longer available/i),
    ).toBeInTheDocument();
  });
});

describe("VaultShareControl", () => {
  it("mints a token and copies the public URL when sharing an un-shared item", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: { share_token: "abc123def456" },
      error: null,
    } as never);

    const Wrap = wrapper();
    render(
      <Wrap>
        <VaultShareControl itemId="it1" shareToken={null} />
      </Wrap>,
    );

    fireEvent.click(screen.getByRole("button", { name: /create public share link/i }));

    await waitFor(() =>
      expect(supabase.functions.invoke).toHaveBeenCalledWith("vault-share-item", {
        body: { action: "mint", item_id: "it1" },
      }),
    );
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("/vault/share/abc123def456"),
    );
  });

  it("exposes copy + disable affordances when already shared", async () => {
    const Wrap = wrapper();
    render(
      <Wrap>
        <VaultShareControl itemId="it1" shareToken="livetoken123" />
      </Wrap>,
    );
    expect(screen.getByRole("button", { name: /copy share link/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /disable share link/i })).toBeInTheDocument();
  });
});
