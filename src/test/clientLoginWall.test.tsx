/**
 * Client login wall, front end.
 *
 *  - A client login has no client selection: ?client=, ?brand= and a slug left in this browser's
 *    storage do not become the "selected client" (they used to, because only the switcher's queries were
 *    switched off for clients, not the selection itself). Staff keep both.
 *  - The client menu holds only client pages, and every one of those addresses is a route a client may
 *    open: none is a staff section, a hub page or an admin page.
 * The row rules are covered by supabase/tests/client_reads_only_own_rows_test.sql.
 */
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ isClient: true }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, isClient: h.isClient }) }));
vi.mock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => ({ isClientPreview: false, isEmployeePreview: false }) }));
vi.mock("@/contexts/AccountContext", () => ({
  useAccountContext: () => ({ accounts: [], selectedAccountId: null, setSelectedAccountId: () => {}, isLoading: false, accountFromLink: null }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => Promise.resolve({ data: [{ slug: "other", name: "Other Co", active: true }], error: null }) }) },
}));

import { ClientSelectionProvider } from "@/contexts/ClientSelectionProvider";
import { useClientSelection } from "@/contexts/ClientSelectionContext";
import { clientNavItems } from "@/components/AppSidebar";
import { SECTIONS } from "@/lib/sections";
import { CLIENT_SCOPED_LEGACY } from "@/lib/clientHub";

function Probe() {
  const { selectedSlug, clients } = useClientSelection();
  return (
    <div>
      <span data-testid="slug">{selectedSlug}</span>
      <span data-testid="clients">{clients.length}</span>
    </div>
  );
}
function renderAt(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <ClientSelectionProvider>
          <Probe />
        </ClientSelectionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.isClient = true;
  window.localStorage.clear();
});

describe("a client login has no client selection", () => {
  it.each(["/client/pipeline?client=other", "/client/pipeline?brand=other", "/client/clients/other"])("ignores %s", (path) => {
    renderAt(path);
    expect(screen.getByTestId("slug").textContent).toBe("");
    expect(screen.getByTestId("clients").textContent).toBe("0");
  });

  it("ignores a slug left in storage for this user", () => {
    window.localStorage.setItem("verdanote.selectedClient.u1", "other");
    renderAt("/client/pipeline");
    expect(screen.getByTestId("slug").textContent).toBe("");
  });

  it("staff still get the client named in the address", async () => {
    h.isClient = false;
    renderAt("/builder/work?client=other");
    expect(screen.getByTestId("slug").textContent).toBe("other");
    expect(await screen.findByText("1")).toBeTruthy();
  });
});

describe("the client menu", () => {
  const staffAddresses = new Set<string>([
    "/clients",
    "/work",
    "/admin",
    "/settings/taxonomy",
    ...SECTIONS.map((s) => `/${s.id}`),
    ...CLIENT_SCOPED_LEGACY.map((r) => r.from),
  ]);

  it("has no staff section, hub or legacy staff address", () => {
    const urls = clientNavItems.map((i) => i.url);
    for (const url of urls) expect(staffAddresses.has(url), url).toBe(false);
    expect(urls.some((u) => u.startsWith("/clients"))).toBe(false);
  });

  it("is exactly the eight client pages", () => {
    expect(clientNavItems.map((i) => i.url)).toEqual(["/", "/brief-review", "/review", "/assets", "/creatives", "/analytics", "/pipeline", "/reports"]);
  });
});
