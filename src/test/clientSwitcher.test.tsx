/**
 * The one client switcher. It replaces the sidebar account switcher, the "Brand" dropdown and
 * the "Client" dropdown. Covered here against the real provider and switcher:
 *  - the choice lives in the URL on client pages, comes from an old ?client= / ?brand= link, and is
 *    remembered in local storage otherwise;
 *  - it sets the ad account the analytics pages read: the client's first linked account, an account
 *    chooser for several, a plain message for none, and the all-accounts view for "All clients";
 *  - a client login has no switcher and no client queries.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const h = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  preview: { isClientPreview: false } as Record<string, unknown>,
  selectedAccountId: "act_c" as string | null,
  setSelectedAccountId: vi.fn(),
  tables: {} as Record<string, unknown[]>,
  from: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => h.auth }));
vi.mock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => h.preview }));
vi.mock("@/contexts/AccountContext", () => ({
  useAccountContext: () => ({
    accounts: [
      { id: "act_a", name: "Alpha Meta" },
      { id: "act_b", name: "Bravo Meta" },
      { id: "act_c", name: "Charlie Meta" },
    ],
    selectedAccountId: h.selectedAccountId,
    setSelectedAccountId: h.setSelectedAccountId,
    isLoading: false,
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      h.from(table);
      return { select: () => Promise.resolve({ data: h.tables[table] ?? [], error: null }) };
    },
  },
}));

import { useClientSelection } from "@/contexts/ClientSelectionContext";
import { ClientSelectionProvider } from "@/contexts/ClientSelectionProvider";
import { ClientSwitcher } from "@/components/ClientSwitcher";

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{`${loc.pathname}${loc.search}`}</div>;
}
function Probe() {
  const s = useClientSelection();
  return <div data-testid="probe">{`${s.selectedSlug}|${s.clients.length}|${s.noAccount}`}</div>;
}

function setRole(role: "builder" | "employee" | "client") {
  h.auth = { user: { id: "u1" }, role, isClient: role === "client", isBuilder: role === "builder", isEmployee: role === "employee" };
}

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route
            path="*"
            element={
              <ClientSelectionProvider>
                <ClientSwitcher />
                <Probe />
              </ClientSelectionProvider>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const select = () => screen.getByRole("combobox", { name: "Client" }) as HTMLSelectElement;
const probe = () => screen.getByTestId("probe").textContent;

beforeEach(() => {
  window.localStorage.clear();
  setRole("builder");
  h.preview = { isClientPreview: false };
  h.selectedAccountId = "act_c";
  h.setSelectedAccountId.mockReset();
  h.from.mockReset();
  h.tables = {
    clients: [
      { slug: "zeta", name: "Zeta Co", active: true },
      { slug: "glow", name: "Glow Drip", active: true },
      { slug: "multi", name: "Multi Brand", active: true },
      { slug: "none", name: "No Account Inc", active: false },
    ],
    client_ad_accounts: [
      { account_id: "act_a", client_slug: "glow" },
      { account_id: "act_a", client_slug: "multi" },
      { account_id: "act_b", client_slug: "multi" },
    ],
  };
});

describe("client switcher", () => {
  it("offers All clients and every client by name, and calls the field Client", async () => {
    renderAt("/builder/creative/creatives");
    await waitFor(() => expect(select().options.length).toBe(5));
    expect(Array.from(select().options).map((o) => o.textContent)).toEqual(["All clients", "Glow Drip", "Multi Brand", "No Account Inc (inactive)", "Zeta Co"]);
    expect(screen.queryByText(/brand/i, { selector: "label" })).toBeNull();
    expect(screen.getAllByRole("combobox", { name: "Client" })).toHaveLength(1);
  });

  it("picking a client remembers it and points the analytics pages at its ad account", async () => {
    renderAt("/builder/creative/creatives");
    await waitFor(() => expect(select().options.length).toBe(5));
    fireEvent.change(select(), { target: { value: "glow" } });
    expect(window.localStorage.getItem("verdanote.selectedClient.u1")).toBe("glow");
    await waitFor(() => expect(h.setSelectedAccountId).toHaveBeenCalledWith("act_a"));
    expect(select().value).toBe("glow");
  });

  it("picking All clients clears the choice and selects the all-accounts view", async () => {
    window.localStorage.setItem("verdanote.selectedClient.u1", "glow");
    renderAt("/builder/creative/creatives");
    await waitFor(() => expect(select().value).toBe("glow"));
    h.setSelectedAccountId.mockClear();
    fireEvent.change(select(), { target: { value: "" } });
    expect(window.localStorage.getItem("verdanote.selectedClient.u1")).toBeNull();
    await waitFor(() => expect(h.setSelectedAccountId).toHaveBeenCalledWith("all"));
  });

  it("remembers the client on pages that are not per client", async () => {
    window.localStorage.setItem("verdanote.selectedClient.u1", "zeta");
    renderAt("/builder/production/calendar");
    await waitFor(() => expect(select().value).toBe("zeta"));
    expect(probe()).toBe("zeta|4|true");
  });

  it("forgets a remembered client that no longer exists", async () => {
    window.localStorage.setItem("verdanote.selectedClient.u1", "deleted-client");
    renderAt("/builder/production/calendar");
    await waitFor(() => expect(probe()).toBe("|4|false"));
    expect(select().value).toBe("");
  });
});

describe("client in the address", () => {
  it("the client hub path selects that client and becomes the remembered one", async () => {
    renderAt("/builder/clients/multi/work");
    await waitFor(() => expect(select().value).toBe("multi"));
    expect(window.localStorage.getItem("verdanote.selectedClient.u1")).toBe("multi");
  });

  it("changing the client on a hub page keeps the tab and swaps the client in the address", async () => {
    renderAt("/builder/clients/glow/work");
    await waitFor(() => expect(select().value).toBe("glow"));
    fireEvent.change(select(), { target: { value: "zeta" } });
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/builder/clients/zeta/work"));
  });

  it("choosing All clients on a hub page goes to the client list", async () => {
    renderAt("/builder/clients/glow/scope/engagements");
    await waitFor(() => expect(select().value).toBe("glow"));
    fireEvent.change(select(), { target: { value: "" } });
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/builder/clients"));
  });

  it.each([
    ["client", "/builder/production/casting?client=glow"],
    ["brand", "/builder/production/casting?brand=glow"],
  ])("an old ?%s= link selects the client and it is remembered", async (_k, path) => {
    renderAt(path);
    await waitFor(() => expect(select().value).toBe("glow"));
    expect(window.localStorage.getItem("verdanote.selectedClient.u1")).toBe("glow");
  });

  it("?brand=all (the old All brands view) means All clients", async () => {
    window.localStorage.setItem("verdanote.selectedClient.u1", "glow");
    renderAt("/builder/talent/pipeline?brand=all");
    await waitFor(() => expect(select().options.length).toBe(5));
    expect(select().value).toBe("");
  });

  it("choosing a client on a page with an old ?client= link drops the param so it does not win again", async () => {
    renderAt("/builder/production/casting?client=glow&month=2026-11");
    await waitFor(() => expect(select().value).toBe("glow"));
    fireEvent.change(select(), { target: { value: "zeta" } });
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/builder/production/casting?month=2026-11"));
    expect(select().value).toBe("zeta");
  });
});

describe("how the client maps to ad accounts", () => {
  it("a client with one ad account moves the analytics pages to it and shows no account chooser", async () => {
    window.localStorage.setItem("verdanote.selectedClient.u1", "glow");
    renderAt("/builder/creative/analytics");
    await waitFor(() => expect(h.setSelectedAccountId).toHaveBeenCalledWith("act_a"));
    expect(screen.queryByRole("combobox", { name: "Ad account" })).toBeNull();
    expect(screen.queryByTestId("client-switcher-no-account")).toBeNull();
  });

  it("a client with several ad accounts starts on the first and gets a small account chooser", async () => {
    window.localStorage.setItem("verdanote.selectedClient.u1", "multi");
    renderAt("/builder/creative/analytics");
    await waitFor(() => expect(h.setSelectedAccountId).toHaveBeenCalledWith("act_a"));
    const chooser = await screen.findByRole("combobox", { name: "Ad account" });
    expect(Array.from((chooser as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(["Alpha Meta", "Bravo Meta"]);
    h.setSelectedAccountId.mockClear();
    fireEvent.change(chooser, { target: { value: "act_b" } });
    expect(h.setSelectedAccountId).toHaveBeenCalledWith("act_b");
  });

  it("keeps the account the person chose when it is one of the client's accounts", async () => {
    h.selectedAccountId = "act_b";
    window.localStorage.setItem("verdanote.selectedClient.u1", "multi");
    renderAt("/builder/creative/analytics");
    await screen.findByRole("combobox", { name: "Ad account" });
    expect(h.setSelectedAccountId).not.toHaveBeenCalled();
  });

  it("a client with no ad account says so and leaves the account alone", async () => {
    window.localStorage.setItem("verdanote.selectedClient.u1", "none");
    renderAt("/builder/creative/analytics");
    expect((await screen.findByTestId("client-switcher-no-account")).textContent).toBe("No ad account linked yet");
    expect(h.setSelectedAccountId).not.toHaveBeenCalled();
    expect(probe()).toBe("none|4|true");
  });

  it("an explicit ?account= link is left alone", async () => {
    window.localStorage.setItem("verdanote.selectedClient.u1", "glow");
    renderAt("/builder/creative/analytics?account=act_c");
    await waitFor(() => expect(select().value).toBe("glow"));
    await new Promise((r) => setTimeout(r, 30));
    expect(h.setSelectedAccountId).not.toHaveBeenCalled();
  });

  it("waits until the account context has settled on an account", async () => {
    h.selectedAccountId = null;
    window.localStorage.setItem("verdanote.selectedClient.u1", "glow");
    renderAt("/builder/creative/analytics");
    await waitFor(() => expect(select().value).toBe("glow"));
    await new Promise((r) => setTimeout(r, 30));
    expect(h.setSelectedAccountId).not.toHaveBeenCalled();
  });
});

describe("who gets a switcher", () => {
  it("an employee gets the switcher", async () => {
    setRole("employee");
    renderAt("/employee/");
    await waitFor(() => expect(select().options.length).toBe(5));
  });

  it("a client login runs no client queries and sees no clients", async () => {
    setRole("client");
    renderAt("/client/");
    await new Promise((r) => setTimeout(r, 30));
    expect(h.from).not.toHaveBeenCalled();
    expect(probe()).toBe("|0|false");
  });

  it("a builder previewing the client view runs no client queries", async () => {
    h.preview = { isClientPreview: true };
    renderAt("/client/");
    await new Promise((r) => setTimeout(r, 30));
    expect(h.from).not.toHaveBeenCalled();
    expect(probe()).toBe("|0|false");
  });
});
