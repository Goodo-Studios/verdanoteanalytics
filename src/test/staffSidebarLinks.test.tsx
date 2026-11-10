/**
 * Goodo Time and Attio links in the staff section of the sidebar (consolidation step 9).
 * Staff see both, opening in a new tab with rel="noopener noreferrer". A client, and a
 * builder previewing as a client, never see them. The staff home page cards are covered
 * in StaffMenu.test.tsx, and a client cannot load /staff (StaffArea.test.tsx).
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
import { ATTIO_URL, GOODO_TIME_URL } from "@/lib/staffMenu";

type Role = "builder" | "employee" | "client";

function renderAs(role: Role, clientPreview = false) {
  authValue = {
    user: { id: "u1", email: `${role}@test.com` },
    role,
    isBuilder: role === "builder",
    isEmployee: role === "employee",
    isClient: role === "client",
    signOut: () => {},
  };
  previewValue = {
    isClientPreview: clientPreview,
    isEmployeePreview: false,
    previewRole: clientPreview ? "client" : null,
    setPreviewRole: () => {},
  };
  return render(
    <MemoryRouter initialEntries={[`/${role}/`]}>
      <AppSidebar />
    </MemoryRouter>,
  );
}

describe("staff sidebar links to Goodo Time and Attio", () => {
  it.each(["builder", "employee"] as const)("%s sees both links, each opening in a new tab", (role) => {
    renderAs(role);
    for (const [name, href] of [
      ["Goodo Time", GOODO_TIME_URL],
      ["Attio", ATTIO_URL],
    ] as const) {
      const link = screen.getByRole("link", { name });
      expect(link.getAttribute("href")).toBe(href);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("points at the agreed addresses", () => {
    expect(GOODO_TIME_URL).toBe("https://goodo-time.vercel.app");
    expect(ATTIO_URL).toBe("https://app.attio.com");
  });

  it("a client does not see them", () => {
    renderAs("client");
    expect(screen.getByRole("link", { name: "Content Pipeline" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Goodo Time" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Attio" })).toBeNull();
    expect(document.querySelector(`a[href="${GOODO_TIME_URL}"], a[href="${ATTIO_URL}"]`)).toBeNull();
  });

  it("a builder previewing as a client does not see them", () => {
    renderAs("builder", true);
    expect(screen.queryByRole("link", { name: "Goodo Time" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Attio" })).toBeNull();
  });
});
