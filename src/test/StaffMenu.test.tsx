/**
 * Staff menu: slots for the tools that are moving in, and links to the apps that stay out.
 * Renders the real StaffHomePage and checks the links and slots from src/lib/staffMenu.ts.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

let authValue: Record<string, unknown>;
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => authValue }));
vi.mock("@/hooks/useClientPreviewMode", () => ({
  useClientPreview: () => ({ isClientPreview: false, isEmployeePreview: false }),
}));

import StaffHomePage from "@/pages/StaffHomePage";
import {
  ATTIO_URL,
  GOODO_TIME_URL,
  OLD_DASHBOARD_PUBLIC_URL,
  allStaffMenuItems,
  staffMenuSections,
} from "@/lib/staffMenu";

function renderAs(role: "builder" | "employee") {
  authValue = { role, isBuilder: role === "builder", isEmployee: role === "employee", isClient: false };
  return render(
    <MemoryRouter>
      <StaffHomePage />
    </MemoryRouter>,
  );
}

describe("staff menu content", () => {
  it("links to Goodo Time, Attio and the old dashboard public pages, each in a new tab", () => {
    renderAs("employee");
    for (const [id, href] of [
      ["goodo-time", GOODO_TIME_URL],
      ["attio", ATTIO_URL],
      ["old-dashboard-public", OLD_DASHBOARD_PUBLIC_URL],
    ] as const) {
      const link = screen.getByTestId(`staff-menu-${id}`);
      expect(link.getAttribute("href")).toBe(href);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
    }
  });

  it("has a slot for each tool that is moving in, shown but not clickable", () => {
    renderAs("builder");
    const slots = allStaffMenuItems.filter((i) => i.status === "slot");
    // Each slot is a tool still to move in. A slot leaves this list only when its pages are live
    // (step 5a: Client overview, client pages, Creator pipeline and Follow-ups replaced "dashboard-pipeline";
    // step 5b moves the old dashboard Creators, Actors, Applications and approval boards out of "dashboard-creators").
    expect(slots.map((s) => s.id).sort()).toEqual(
      ["bid-viewer", "content-leaderboard", "dashboard-creators", "dashboard-production", "dashboard-settings", "goodo-os", "wideframe"],
    );
    for (const id of ["client-overview", "creator-pipeline", "follow-ups", "creators", "actors"]) {
      expect(allStaffMenuItems.find((i) => i.id === id)?.status, id).toBe("live");
    }
    for (const slot of slots) {
      const el = screen.getByTestId(`staff-menu-${slot.id}`);
      expect(el.tagName).not.toBe("A");
      expect(el.getAttribute("aria-disabled")).toBe("true");
      expect(within(el).getByText(slot.step ?? "Planned")).toBeTruthy();
    }
  });

  it("names the planned tools", () => {
    renderAs("builder");
    for (const title of ["Growth Dashboard", "Ad Name Generator", "Goodo OS areas", "Wideframe Prompt Library"]) {
      expect(screen.getByText(title)).toBeTruthy();
    }
  });

  it("points live entries at the role prefix of the signed-in staff member", () => {
    renderAs("employee");
    expect(screen.getByTestId("staff-menu-briefs").getAttribute("href")).toBe("/employee/briefs");
    expect(screen.getByTestId("staff-menu-vault").getAttribute("href")).toBe("/employee/ad-library");
  });

  it("hides builder-only entries from employees and shows them to builders", () => {
    const { unmount } = renderAs("employee");
    expect(screen.queryByTestId("staff-menu-matrix")).toBeNull();
    expect(screen.queryByTestId("staff-menu-growth-dashboard")).toBeNull();
    unmount();
    renderAs("builder");
    expect(screen.getByTestId("staff-menu-matrix")).toBeTruthy();
    expect(screen.getByTestId("staff-menu-growth-dashboard")).toBeTruthy();
  });

  it("gives every entry a unique id and a destination that fits its status", () => {
    const ids = allStaffMenuItems.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of allStaffMenuItems) {
      if (item.status === "live") expect(item.to, item.id).toMatch(/^\//);
      if (item.status === "link") expect(item.href, item.id).toMatch(/^https:\/\//);
      if (item.status === "slot") expect(item.step, item.id).toBeTruthy();
    }
    expect(staffMenuSections.length).toBeGreaterThanOrEqual(3);
  });
});
