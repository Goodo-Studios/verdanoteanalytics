// US-003 — Per-account taxonomy configuration surface (builder-only).
//
// e2eTests (from the PRD):
//   1. Given a builder on the config surface, when they add a Theme/Persona and
//      activate a creative type, then both appear and persist after reload.
//   2. Given a non-builder session, when navigating to the config surface, then
//      access is denied.
//
// Unlike US-001/US-002 (Deno edge + prod-only DB → static file assertions), this
// is a React surface with a real jsdom + Testing Library harness, so these are
// live behavioral tests:
//   • Test 1 renders the REAL TaxonomyConfigSection wired to the REAL api.ts +
//     useAccountTaxonomy hook, with only the network boundary
//     (supabase.functions.invoke) mocked by an in-memory fake of the
//     account-taxonomy edge function. Adding a Theme/Persona and toggling a
//     creative type mutate that fake's state; a fresh remount (new QueryClient =
//     "reload") re-fetches via `list` and must still show both — proving the
//     write persisted server-side and every surface reads the single RPC shape.
//   • Test 2 renders the REAL SettingsPage and asserts the builder-only gate:
//     the "Taxonomy" tab and surface appear for a builder and are absent for a
//     client, an employee, and a builder in client-preview (the three
//     non-builder effective roles). Heavy sibling sections/modals are stubbed so
//     the test isolates the role gate, mirroring RouteGuard.test.tsx.
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ACCOUNT_ID = "act_bearaby";

// Mutable role drivers + the network mock, shared across the file's module mocks.
const h = vi.hoisted(() => {
  // A permissive proxy for the SettingsPage page-state hooks: any unspecified
  // field access resolves to a callable that also answers `.isPending`/`.mutate`,
  // so props for the always-rendered (but stubbed-to-null) modals never throw.
  // We only pin the fields whose concrete type matters (accounts array, nulls).
  const anyProxy = (): unknown => {
    const fn = () => anyProxy();
    return new Proxy(fn, {
      get: (_t, prop) => (prop === "isPending" ? false : anyProxy()),
      apply: () => anyProxy(),
    });
  };
  const stateStub = (overrides: Record<string, unknown>) =>
    new Proxy(overrides, {
      get: (target, prop) => (prop in target ? (target as Record<string | symbol, unknown>)[prop] : anyProxy()),
    });
  return {
    invoke: vi.fn(),
    auth: { isBuilder: true, isEmployee: false, isClient: false },
    preview: { isClientPreview: false, isEmployeePreview: false },
    stateStub,
  };
});

// --- Network boundary: an in-memory fake of the account-taxonomy edge fn. ------
// Every action returns a fresh `taxonomy` payload in the exact rpc_account_taxonomy
// shape (see 20260724000002 migration), so the real hook's cache-write path runs.
function makeServer() {
  const themes: Record<string, unknown>[] = [];
  const creativeTypes = [
    { creative_type_id: "ct_static", lane: "Static", type_name: "Static Image", menu_sort_order: 0, active: false, activation_id: null as string | null, account_sort_order: null },
    { creative_type_id: "ct_ugc", lane: "Video", type_name: "UGC", menu_sort_order: 0, active: false, activation_id: null as string | null, account_sort_order: null },
  ];
  let seq = 0;
  const taxonomy = () => ({
    account_id: ACCOUNT_ID,
    themes: themes.map((t) => ({ ...t })),
    creative_types: creativeTypes.map((c) => ({ ...c })),
  });

  return async (_name: string, opts: { body: Record<string, unknown> }) => {
    const body = opts.body;
    switch (body.action) {
      case "list":
        return { data: { taxonomy: taxonomy() }, error: null };
      case "create": {
        const t = {
          id: `th_${++seq}`,
          label: body.name as string,
          theme: null,
          summary: null,
          origin: "manual",
          test_status: null,
          archived: false,
          archived_at: null,
          score: null,
          created_at: new Date(2026, 6, 24, 0, 0, seq).toISOString(),
        };
        themes.push(t);
        return { data: { created: { id: t.id, label: t.label }, taxonomy: taxonomy() }, error: null };
      }
      case "rename": {
        const t = themes.find((x) => x.id === body.angle_id);
        if (t) t.label = body.name as string;
        return { data: { renamed: { id: body.angle_id, label: body.name }, taxonomy: taxonomy() }, error: null };
      }
      case "archive":
      case "unarchive": {
        const t = themes.find((x) => x.id === body.angle_id);
        if (t) {
          t.archived = body.action === "archive";
          t.archived_at = body.action === "archive" ? new Date().toISOString() : null;
        }
        return { data: { updated: { id: body.angle_id, archived_at: t?.archived_at ?? null }, taxonomy: taxonomy() }, error: null };
      }
      case "set_creative_type": {
        const c = creativeTypes.find((x) => x.creative_type_id === body.creative_type_id);
        if (c) {
          c.active = body.active as boolean;
          c.activation_id = `a_${c.creative_type_id}`;
        }
        return { data: { activation: { id: c?.activation_id, creative_type_id: body.creative_type_id, active: body.active }, taxonomy: taxonomy() }, error: null };
      }
      case "seed":
        return { data: { seed: { source: "none", review_mining_count: 0, seeded_ids: [], empty: true }, taxonomy: taxonomy() }, error: null };
      default:
        return { data: null, error: { message: `unknown action ${String(body.action)}` } };
    }
  };
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => h.invoke(...args) } },
}));

vi.mock("@/contexts/AccountContext", () => ({
  useAccountContext: () => ({ selectedAccountId: ACCOUNT_ID }),
}));

// SettingsPage role gate drivers.
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => h.auth }));
vi.mock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => h.preview }));
vi.mock("@/hooks/useIsSyncing", () => ({ useIsSyncing: () => false }));
vi.mock("@/hooks/useUserSettingsPageState", () => ({
  useUserSettingsPageState: () => h.stateStub({ loadingProfile: false, accounts: [] }),
}));
vi.mock("@/hooks/useSettingsPageState", () => ({
  useSettingsPageState: () => h.stateStub({ accounts: [{ id: ACCOUNT_ID, name: "Bearaby" }], account: null }),
}));

// Stub SettingsPage's sibling sections/modals so the gate test isolates the
// role logic (not the unrelated Profile/Account/Admin sections' deps). Factories
// are hoisted above imports, so each returns its own inline stub (no shared helper).
vi.mock("@/components/SyncStatusBanner", () => ({ SyncStatusBanner: () => null }));
vi.mock("@/components/MediaRefreshBanner", () => ({ MediaRefreshBanner: () => null }));
vi.mock("@/components/user-settings/ProfileInfoSection", () => ({ ProfileInfoSection: () => null }));
vi.mock("@/components/user-settings/ChangePasswordSection", () => ({ ChangePasswordSection: () => null }));
vi.mock("@/components/user-settings/MetaConnectionSection", () => ({ MetaConnectionSection: () => null }));
vi.mock("@/components/user-settings/AdAccountsSection", () => ({ AdAccountsSection: () => null }));
vi.mock("@/components/user-settings/UserManagementSection", () => ({ UserManagementSection: () => null }));
vi.mock("@/components/user-settings/AddAccountModal", () => ({ AddAccountModal: () => null }));
vi.mock("@/components/user-settings/CreateUserModal", () => ({ CreateUserModal: () => null }));
vi.mock("@/components/user-settings/ConfirmDeleteDialog", () => ({ ConfirmDeleteDialog: () => null }));
vi.mock("@/components/settings/AccountOverviewSection", () => ({ AccountOverviewSection: () => null }));
vi.mock("@/components/settings/SyncSettingsSection", () => ({ SyncSettingsSection: () => null }));
vi.mock("@/components/settings/SyncScheduleSection", () => ({ SyncScheduleSection: () => null }));
vi.mock("@/components/settings/SyncHistorySection", () => ({ SyncHistorySection: () => null }));
vi.mock("@/components/settings/RenameAccountModal", () => ({ RenameAccountModal: () => null }));
vi.mock("@/components/settings/CsvUploadModal", () => ({ CsvUploadModal: () => null }));
vi.mock("@/components/settings/DataHealthSection", () => ({ DataHealthSection: () => null }));
vi.mock("@/components/settings/SpendDiagnosticSection", () => ({ SpendDiagnosticSection: () => null }));
vi.mock("@/components/settings/DataExportSection", () => ({ DataExportSection: () => null }));
vi.mock("@/components/settings/NamingConventionSection", () => ({ NamingConventionSection: () => null }));
vi.mock("@/components/settings/ApiKeysSection", () => ({ ApiKeysSection: () => null }));
vi.mock("@/components/settings/SystemHealthSection", () => ({ SystemHealthSection: () => null }));

import TaxonomyConfigSection from "@/features/matrix/config/TaxonomyConfigSection";
import SettingsPage from "@/pages/SettingsPage";

const ACCOUNTS = [{ id: ACCOUNT_ID, name: "Bearaby" }];

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TaxonomyConfigSection accounts={ACCOUNTS} />
    </QueryClientProvider>,
  );
}

function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.invoke.mockImplementation(makeServer());
  h.auth = { isBuilder: true, isEmployee: false, isClient: false };
  h.preview = { isClientPreview: false, isEmployeePreview: false };
});

afterEach(() => cleanup());

describe("US-003: builder adds a Theme/Persona and activates a creative type (e2e 1)", () => {
  it("both appear immediately and persist after a reload", async () => {
    renderSection();

    // Initial list resolves — the empty-state prompt shows, UGC is inactive.
    await screen.findByText(/No Theme\/Personas yet/i);
    const ugc = screen.getByRole("switch", { name: "Toggle UGC" });
    expect(ugc).toHaveAttribute("aria-checked", "false");

    // Add a Theme/Persona.
    fireEvent.change(screen.getByPlaceholderText(/New Theme\/Persona/i), {
      target: { value: "Busy parents" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add/i }));
    expect(await screen.findByText("Busy parents")).toBeInTheDocument();

    // Activate a creative type.
    fireEvent.click(screen.getByRole("switch", { name: "Toggle UGC" }));
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Toggle UGC" })).toHaveAttribute("aria-checked", "true"),
    );

    // "Reload": fresh QueryClient + remount re-fetches via `list`. Both the added
    // Theme/Persona and the activated creative type must still be present.
    cleanup();
    renderSection();
    expect(await screen.findByText("Busy parents")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Toggle UGC" })).toHaveAttribute("aria-checked", "true"),
    );
  });

  it("routes every read/write through the session-authed account-taxonomy edge fn", async () => {
    renderSection();
    await screen.findByText(/No Theme\/Personas yet/i);
    // The surface never talks to the key-gated external `api` function directly.
    for (const call of h.invoke.mock.calls) {
      expect(call[0]).toBe("account-taxonomy");
    }
  });
});

describe("US-003: builder-only gate — non-builder access is denied (e2e 2)", () => {
  it("shows the Taxonomy tab and surface for a builder", async () => {
    h.auth = { isBuilder: true, isEmployee: false, isClient: false };
    renderSettings();

    const tab = await screen.findByRole("button", { name: /Taxonomy/i });
    fireEvent.click(tab);
    // The real, lazily-loaded surface mounts and fetches the taxonomy.
    expect(await screen.findByText(/Account taxonomy/i)).toBeInTheDocument();
  });

  it("hides the Taxonomy tab and surface from a client", () => {
    h.auth = { isBuilder: false, isEmployee: false, isClient: true };
    renderSettings();
    expect(screen.queryByRole("button", { name: /Taxonomy/i })).toBeNull();
    expect(screen.queryByText(/Account taxonomy/i)).toBeNull();
  });

  it("hides the Taxonomy tab and surface from an employee", () => {
    h.auth = { isBuilder: false, isEmployee: true, isClient: false };
    renderSettings();
    expect(screen.queryByRole("button", { name: /Taxonomy/i })).toBeNull();
    expect(screen.queryByText(/Account taxonomy/i)).toBeNull();
  });

  it("hides the Taxonomy tab and surface from a builder in client-preview", () => {
    h.auth = { isBuilder: true, isEmployee: false, isClient: false };
    h.preview = { isClientPreview: true, isEmployeePreview: false };
    renderSettings();
    expect(screen.queryByRole("button", { name: /Taxonomy/i })).toBeNull();
    expect(screen.queryByText(/Account taxonomy/i)).toBeNull();
  });
});
