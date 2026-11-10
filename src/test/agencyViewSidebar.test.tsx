/**
 * Agency View (every account selected): staff keep the full staff menu plus the
 * agency overview, pages that need one account ask for one, and a client's
 * sidebar is unchanged. Also covers the labelled mobile menu button.
 */
import { fireEvent, render, screen } from "@testing-library/react";
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

import { AppSidebar, builderSections } from "@/components/AppSidebar";
import { AGENCY_OVERVIEW_ITEM, sectionsForAgencyView } from "@/lib/agencyNav";
import { RequireOneAccount } from "@/components/RequireOneAccount";

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
    <MemoryRouter initialEntries={[`/${role}/agency`]}>
      <AppSidebar />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  h.selected = "all";
  h.setSelected.mockReset();
  window.localStorage.clear();
});

describe("sidebar on the Agency View", () => {
  it.each(["builder", "employee"] as const)("%s keeps the staff menu and gets the agency overview", (role) => {
    renderSidebar(role);
    expect(screen.getByRole("link", { name: "Agency overview" }).getAttribute("href")).toBe(`/${role}/agency`);
    for (const name of ["Creatives", "Analytics", "Staff menu", "Client overview", "Deliverables", "Library"]) {
      expect(screen.getByRole("link", { name }), name).toBeTruthy();
    }
    // Pages that need one account stay listed; they ask for an account on the page.
    expect(screen.getByRole("link", { name: "Landing Pages" })).toBeTruthy();
  });

  it("adds the agency overview only to the Creative Analytics section", () => {
    const sections = sectionsForAgencyView(builderSections);
    const analytics = sections.find((s) => s.id === "creative-analytics");
    expect(analytics?.items[0]).toBe(AGENCY_OVERVIEW_ITEM);
    expect(sections.flatMap((s) => s.items).filter((i) => i.url === "/agency")).toHaveLength(1);
    expect(builderSections.find((s) => s.id === "creative-analytics")?.items.some((i) => i.url === "/agency")).toBe(false);
  });

  it("a staff member with one account selected sees no agency overview item", () => {
    h.selected = "act_a";
    renderSidebar("builder");
    expect(screen.queryByRole("link", { name: "Agency overview" })).toBeNull();
    expect(screen.getByRole("link", { name: "Staff menu" })).toBeTruthy();
  });

  it("a client keeps the short client menu", () => {
    h.selected = "act_a";
    renderSidebar("client");
    for (const name of ["Overview", "Creatives", "Analytics", "Content Pipeline", "Reports"]) {
      expect(screen.getByRole("link", { name })).toBeTruthy();
    }
    expect(screen.queryByRole("link", { name: "Staff menu" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Agency overview" })).toBeNull();
  });
});

describe("RequireOneAccount", () => {
  it("asks for an account on the Agency View instead of rendering the page", () => {
    h.selected = "all";
    render(<RequireOneAccount pageName="Landing Pages"><p>page body</p></RequireOneAccount>);
    expect(screen.getByRole("heading", { name: "Pick an account" })).toBeTruthy();
    expect(screen.getByText(/Landing Pages shows one account at a time/)).toBeTruthy();
    expect(screen.queryByText("page body")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Account" })).toBeTruthy();
  });

  it("renders the page when one account is selected", () => {
    h.selected = "act_a";
    render(<RequireOneAccount pageName="Landing Pages"><p>page body</p></RequireOneAccount>);
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
      <MemoryRouter initialEntries={["/builder/"]}>
        <AppLayout><p>content</p></AppLayout>
      </MemoryRouter>,
    );
    const button = screen.getByRole("button", { name: "Open menu" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
  });
});
