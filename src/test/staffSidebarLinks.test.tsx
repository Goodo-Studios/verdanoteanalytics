/**
 * The sidebar no longer links out to Goodo Time or Attio. Time is its own menu item inside the app.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

let authValue: Record<string, unknown>;
let previewValue: Record<string, unknown>;
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => authValue }));
vi.mock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => previewValue }));
vi.mock("@/contexts/AccountContext", () => ({
  useAccountContext: () => ({
    accounts: [{ id: "act_demo", name: "Demo" }],
    selectedAccountId: "act_demo",
    setSelectedAccountId: () => {},
    isLoading: false,
  }),
}));

import { AppSidebar } from "@/components/AppSidebar";

type Role = "builder" | "employee" | "client";

function renderAs(role: Role) {
  authValue = {
    user: { id: "u1", email: `${role}@test.com` },
    role,
    isBuilder: role === "builder",
    isEmployee: role === "employee",
    isClient: role === "client",
    signOut: () => {},
  };
  previewValue = { isClientPreview: false, isEmployeePreview: false, previewRole: null, setPreviewRole: () => {} };
  return render(
    <MemoryRouter initialEntries={[`/${role}/`]}>
      <AppSidebar />
    </MemoryRouter>,
  );
}

describe("staff sidebar has no outside links", () => {
  it.each(["builder", "employee"] as const)("%s sees Time as an in-app menu item and no Goodo Time or Attio link", (role) => {
    renderAs(role);
    expect(screen.getByRole("link", { name: "Time" }).getAttribute("href")).toBe(`/${role}/time`);
    expect(screen.queryByRole("link", { name: "Goodo Time" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Attio" })).toBeNull();
    expect(document.querySelector('a[target="_blank"]')).toBeNull();
  });

  it("a client sees neither", () => {
    renderAs("client");
    expect(screen.getByRole("link", { name: "Content Pipeline" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Time" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Attio" })).toBeNull();
  });
});
