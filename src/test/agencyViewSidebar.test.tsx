/**
 * The staff menu has ten items whatever client is selected (including "All clients", the
 * old Agency View), Admin shows for builders and employees, a client's sidebar is unchanged,
 * pages that need one client ask for one, and the mobile menu button is labelled.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  preview: {} as Record<string, unknown>,
  selected: "all" as string | null,
  setSelected: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => h.auth }));
vi.mock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => h.preview }));
vi.mock("@/contexts/AccountContext", () => ({
  useAccountContext: () => ({
    accounts: [
      { id: "act_b", name: "Bravo" },
      { id: "act_a", name: "Alpha" },
    ],
    selectedAccountId: h.selected,
    setSelectedAccountId: h.setSelected,
    isLoading: false,
  }),
}));
vi.mock("@/components/PresenceAvatars", () => ({ PresenceAvatars: () => null }));

import { AppSidebar, staffNavItems } from "@/components/AppSidebar";
import { RequireOneAccount } from "@/components/RequireOneAccount";
import { WithClient } from "@/test/clientSelection";

type Role = "builder" | "employee" | "client";

function setRole(role: Role) {
  h.auth = {
    user: { id: "u1", email: `${role}@test.com` },
    role,
    isBuilder: role === "builder",
    isEmployee: role === "employee",
    isClient: role === "client",
    signOut: () => {},
  };
  h.preview = { isClientPreview: false, isEmployeePreview: false, previewRole: null, setPreviewRole: () => {} };
}

function renderSidebar(role: Role) {
  setRole(role);
  return render(
    <MemoryRouter initialEntries={[`/${role}/`]}>
      <AppSidebar />
    </MemoryRouter>,
  );
}

const TEN = ["Home", "Clients", "Production", "Talent", "Creative", "Creative Vault", "Knowledge", "Growth Dashboard", "Ad Name Generator", "Admin"];
// An employee does not see the builder-only Growth Dashboard.
const EMPLOYEE_MENU = TEN.filter((t) => t !== "Growth Dashboard");

beforeEach(() => {
  h.selected = "all";
  h.setSelected.mockReset();
  window.localStorage.clear();
});

describe("staff sidebar", () => {
  it("has exactly the ten menu items, in order", () => {
    expect(staffNavItems.map((i) => i.title)).toEqual(TEN);
  });

  it.each(["builder", "employee"] as const)("%s sees their menu items with role-prefixed links", (role) => {
    renderSidebar(role);
    const main = screen.getByRole("navigation", { name: "Main" });
    const links = Array.from(main.querySelectorAll("a")).map((a) => a.textContent);
    expect(links).toEqual(role === "builder" ? TEN : EMPLOYEE_MENU);
    expect(screen.getByRole("link", { name: "Creative Vault" }).getAttribute("href")).toBe(`/${role}/vault`);
    expect(screen.getByRole("link", { name: "Ad Name Generator" }).getAttribute("href")).toBe(`/${role}/tools`);
    if (role === "builder") expect(screen.getByRole("link", { name: "Growth Dashboard" }).getAttribute("href")).toBe("/builder/growth");
    else expect(screen.queryByRole("link", { name: "Growth Dashboard" })).toBeNull();
    expect(screen.getByRole("link", { name: "Production" }).getAttribute("href")).toBe(`/${role}/production`);
    expect(screen.getByRole("link", { name: "Clients" }).getAttribute("href")).toBe(`/${role}/clients`);
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("href")).toBe(`/${role}/`);
  });

  it("drops the flat Staff group, the staff directory and the sidebar account switcher", () => {
    renderSidebar("builder");
    for (const name of ["Staff menu", "Client overview", "Deliverables", "Engagements", "Agency overview"]) {
      expect(screen.queryByRole("link", { name }), name).toBeNull();
    }
    expect(screen.queryByText("Staff")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("keeps the same menu on All clients and on one client", () => {
    h.selected = "act_a";
    renderSidebar("builder");
    const main = screen.getByRole("navigation", { name: "Main" });
    expect(Array.from(main.querySelectorAll("a")).map((a) => a.textContent)).toEqual(TEN);
  });

  it("keeps Settings in the footer", () => {
    renderSidebar("employee");
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/employee/settings");
  });

  it("a client keeps the short client menu and its account switcher rules", () => {
    h.selected = "act_a";
    renderSidebar("client");
    const main = screen.getByRole("navigation", { name: "Main" });
    expect(Array.from(main.querySelectorAll("a")).map((a) => a.textContent)).toEqual(["Overview", "Briefs", "Review", "Assets", "Creatives", "Analytics", "Content Pipeline", "Reports"]);
    for (const name of TEN.filter((n) => n !== "Home")) expect(screen.queryByRole("link", { name })).toBeNull();
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
  });
});

describe("RequireOneAccount", () => {
  it("asks for a client on All clients instead of rendering the page", () => {
    h.selected = "all";
    render(
      <WithClient slug="" clients={[{ slug: "glow", name: "Glow Drip", active: true }]}>
        <RequireOneAccount pageName="Landing Pages"><p>page body</p></RequireOneAccount>
      </WithClient>,
    );
    expect(screen.getByRole("heading", { name: "Pick a client" })).toBeTruthy();
    expect(screen.getByText(/Landing Pages shows one client at a time/)).toBeTruthy();
    expect(screen.queryByText("page body")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Choose a client" })).toBeTruthy();
  });

  it("says plainly when the chosen client has no ad account", () => {
    h.selected = "all";
    render(
      <WithClient slug="glow" clients={[{ slug: "glow", name: "Glow Drip", active: true }]} noAccount>
        <RequireOneAccount pageName="Landing Pages"><p>page body</p></RequireOneAccount>
      </WithClient>,
    );
    expect(screen.getByText("This client has no ad account linked yet, so there is nothing to show.")).toBeTruthy();
  });

  it("renders the page when one client's ad account is selected", () => {
    h.selected = "act_a";
    render(
      <WithClient slug="glow">
        <RequireOneAccount pageName="Landing Pages"><p>page body</p></RequireOneAccount>
      </WithClient>,
    );
    expect(screen.getByText("page body")).toBeTruthy();
    expect(screen.queryByTestId("pick-one-account")).toBeNull();
  });
});

describe("mobile menu button", () => {
  it("has an accessible name", async () => {
    setRole("builder");
    h.selected = "act_a";
    const { AppLayout } = await import("@/components/AppLayout");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/builder/"]}>
          <AppLayout><p>content</p></AppLayout>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const button = screen.getByRole("button", { name: "Open menu" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
  });
});
