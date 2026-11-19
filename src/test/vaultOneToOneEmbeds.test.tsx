/**
 * Regression: Vault pages lost scripts, frameworks and hooks, and some items opened as
 * "Item not found".
 *
 * inspiration_transcripts and inspiration_frameworks became unique(item_id) in audit 4.3, so
 * PostgREST returns each embed as one object (or null), not an array. The item page spread the
 * object (a TypeError, shown as "Item not found"), cards and the Hooks page read `[0]` of an
 * object and got nothing. Every earlier test fed arrays, which hid it. These feed the real shape.
 */
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const BASE_ITEM = {
  id: "it1",
  user_id: "u1",
  platform: "facebook_ad",
  title: "Plain title",
  creator_handle: null,
  source_url: null,
  thumbnail_url: null,
  thumbnail_path: null,
  video_url: null,
  file_path: null,
  brand_name: "Acme",
  industry: null,
  ad_format: null,
  target_audience: null,
  script_analysis: "The script analysis text",
  visual_analysis: null,
  status: "ready",
  error_message: null,
  hook_verbal_saved: false,
  hook_text_saved: false,
  hook_visual_saved: false,
  created_at: "2026-07-02T00:00:00Z",
};

const TRANSCRIPT = { id: "t1", item_id: "it1", cleaned_script: "This is the spoken script", created_at: "2026-07-02T00:00:00Z" };
const FRAMEWORK = {
  id: "f1",
  item_id: "it1",
  hook_verbal: "Spoken hook line",
  hook_text: "On screen hook",
  hook_visual: null,
  copywriting_framework: "PAS",
  created_at: "2026-07-02T00:00:00Z",
};

let ITEM_ROW: Record<string, unknown> = {};
let HOOK_ROWS: unknown[] = [];
let SINGLE_ERROR: { code: string; message: string } | null = null;

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.or = vi.fn(chain);
  builder.order = vi.fn(chain);
  builder.single = vi.fn(async () =>
    SINGLE_ERROR ? { data: null, error: SINGLE_ERROR } : { data: ITEM_ROW, error: null },
  );
  builder.then = (resolve: (v: unknown) => void) =>
    resolve({ data: table === "inspiration_items" ? HOOK_ROWS : [], error: null });
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((table: string) => makeBuilder(table)),
    storage: { from: vi.fn(() => ({ createSignedUrl: vi.fn(async () => ({ data: null, error: null })) })) },
    auth: { getSession: vi.fn(async () => ({ data: { session: null } })) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "" }));
vi.mock("@/features/vault/hooks/useItemStatus", () => ({ useItemStatus: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ItemDetailPage from "@/features/vault/ItemDetailPage";
import HooksPage from "@/features/vault/HooksPage";

function renderAt(path: string, routePath: string, element: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePath} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  HOOK_ROWS = [];
  SINGLE_ERROR = null;
});

describe("Vault item page with one-to-one embeds (objects, not arrays)", () => {
  it("opens an item whose transcript and framework come back as objects", async () => {
    ITEM_ROW = { ...BASE_ITEM, inspiration_transcripts: TRANSCRIPT, inspiration_frameworks: FRAMEWORK };
    renderAt("/ad-library/it1", "/ad-library/:id", <ItemDetailPage />);

    // Framework exists, so the page offers a re-run rather than a first run, and is not "not found".
    expect(await screen.findByRole("button", { name: "Re-analyze item" })).toHaveTextContent("Re-analyze");
    expect(screen.queryByText("Item not found")).toBeNull();
    expect(screen.queryByText(/No framework yet/)).toBeNull();
    // The framework tab is the default and shows the saved hook.
    expect(await screen.findByDisplayValue("Spoken hook line")).toBeTruthy();
  });

  it("shows the script when only the transcript exists as an object", async () => {
    ITEM_ROW = { ...BASE_ITEM, inspiration_transcripts: TRANSCRIPT, inspiration_frameworks: null };
    renderAt("/ad-library/it1", "/ad-library/:id", <ItemDetailPage />);

    expect(await screen.findByDisplayValue("This is the spoken script")).toBeTruthy();
    expect(screen.queryByText("Item not found")).toBeNull();
  });

  it("still opens an item with both embeds null and shows the analysis text", async () => {
    ITEM_ROW = { ...BASE_ITEM, inspiration_transcripts: null, inspiration_frameworks: null };
    renderAt("/ad-library/it1", "/ad-library/:id", <ItemDetailPage />);

    expect(await screen.findByRole("button", { name: "Re-analyze item" })).toHaveTextContent("Run analysis");
    expect(screen.queryByText("Item not found")).toBeNull();
  });

  it("still opens an item whose embeds are arrays", async () => {
    ITEM_ROW = { ...BASE_ITEM, inspiration_transcripts: [TRANSCRIPT], inspiration_frameworks: [FRAMEWORK] };
    renderAt("/ad-library/it1", "/ad-library/:id", <ItemDetailPage />);

    expect(await screen.findByDisplayValue("Spoken hook line")).toBeTruthy();
  });
});

describe("Vault item page load failures", () => {
  it("says not found only when the row does not exist", async () => {
    SINGLE_ERROR = { code: "PGRST116", message: "no rows" };
    renderAt("/ad-library/it1", "/ad-library/:id", <ItemDetailPage />);
    expect(await screen.findByText("Item not found")).toBeTruthy();
  });

  it("says the item could not be loaded for any other failure", async () => {
    SINGLE_ERROR = { code: "42501", message: "permission denied" };
    renderAt("/ad-library/it1", "/ad-library/:id", <ItemDetailPage />);
    expect(await screen.findByText("This item could not be loaded")).toBeTruthy();
    expect(screen.queryByText("Item not found")).toBeNull();
  });
});

describe("Hook library with a one-to-one framework embed", () => {
  it("lists a starred hook when the framework comes back as an object", async () => {
    HOOK_ROWS = [
      {
        id: "it1",
        title: "Plain title",
        brand_name: "Acme",
        thumbnail_url: null,
        platform: "facebook_ad",
        created_at: "2026-07-02T00:00:00Z",
        hook_verbal_saved: true,
        hook_text_saved: false,
        hook_visual_saved: false,
        inspiration_frameworks: { id: "f1", hook_verbal: "Spoken hook line", hook_text: null, hook_visual: null },
      },
    ];
    renderAt("/hooks", "/hooks", <HooksPage />);

    await waitFor(() => expect(screen.getAllByText(/Spoken hook line/).length).toBeGreaterThan(0));
  });
});
