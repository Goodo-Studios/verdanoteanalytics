/**
 * Staff Home: replaces the flat staff directory page. A way into every part of the app, the client
 * being worked on, and the links to the apps that stay outside Verdanote (new tab, noopener).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));
// The blocks have their own tests (staffHome.test.tsx); here they are a marker.
vi.mock("@/features/home/StaffHomeBlocks", () => ({ StaffHomeBlocks: () => <div data-testid="staff-home-blocks" /> }));
// Today has its own tests (todayPanel.test.tsx); here it is a marker.
vi.mock("@/features/home/TodayPanel", () => ({ TodayPanel: () => <div data-testid="today-panel" /> }));

import HomePage from "@/pages/HomePage";
import { WithClient } from "@/test/clientSelection";
import { ATTIO_URL, GOODO_TIME_URL } from "@/lib/staffMenu";

function renderHome(slug = "") {
  return render(
    <MemoryRouter>
      <WithClient slug={slug} clients={[{ slug: "glow", name: "Glow Drip", active: true }]}>
        <HomePage />
      </WithClient>
    </MemoryRouter>,
  );
}

describe("Home", () => {
  it("puts the day's blocks first and has Today, My work, Time and Work tabs", () => {
    renderHome();
    expect(screen.getByTestId("staff-home-blocks")).toBeTruthy();
    // OS-010: the Today panel (one next action) comes before the blocks.
    const today = screen.getByTestId("today-panel");
    expect(today.compareDocumentPosition(screen.getByTestId("staff-home-blocks")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const tabs = screen.getByRole("navigation", { name: "Home tabs" });
    expect(tabs.querySelector('[aria-current="page"]')?.textContent).toBe("Today");
    expect(Array.from(tabs.querySelectorAll("a")).map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Today", "/builder/"],
      ["My work", "/builder/my-work"],
      ["Time", "/builder/time"],
      ["Work", "/builder/work"],
    ]);
  });

  it("does not repeat the sidebar as Go to cards (OS-002)", () => {
    renderHome();
    expect(screen.queryByText("Go to")).toBeNull();
    for (const id of ["clients", "production", "talent", "creative", "knowledge", "tools", "admin"]) {
      expect(screen.queryByTestId(`home-card-${id}`), id).toBeNull();
    }
  });

  it("has no outside-app cards: Goodo Time and Attio live in the sidebar, the old dashboard card is gone", () => {
    renderHome();
    expect(screen.queryByText("Other apps")).toBeNull();
    for (const id of ["goodo-time", "attio", "old-dashboard-public"]) {
      expect(screen.queryByTestId(`home-app-${id}`), id).toBeNull();
    }
    for (const href of [GOODO_TIME_URL, ATTIO_URL, "https://goodostudios-production.vercel.app"]) {
      expect(document.querySelector(`a[href="${href}"]`), href).toBeNull();
    }
  });

  it("says no client is picked, and names the picked client with a link to its page", () => {
    const { unmount } = renderHome();
    expect(screen.getByText(/No client picked/)).toBeTruthy();
    expect(screen.queryByTestId("home-open-client")).toBeNull();
    unmount();
    renderHome("glow");
    expect(screen.getByText("Glow Drip")).toBeTruthy();
    expect(screen.getByTestId("home-open-client").getAttribute("href")).toBe("/builder/clients/glow");
  });

  it("shows no old staff menu items or developer wording", () => {
    renderHome();
    expect(screen.queryByText("Moving in")).toBeNull();
    expect(screen.queryByText(/^Step \d/)).toBeNull();
    expect(screen.queryByText(/slug|account id/i)).toBeNull();
  });
});
