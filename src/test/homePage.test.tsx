/**
 * Staff Home: replaces the flat staff directory page. A way into every part of the app, the client
 * being worked on, and the links to the apps that stay outside Verdanote (new tab, noopener).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));

import HomePage from "@/pages/HomePage";
import { WithClient } from "@/test/clientSelection";
import { ATTIO_URL, GOODO_TIME_URL, OLD_DASHBOARD_PUBLIC_URL } from "@/lib/staffMenu";

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
  it("links to Clients and every section", () => {
    renderHome();
    for (const [id, to] of [
      ["clients", "/builder/clients"],
      ["production", "/builder/production"],
      ["talent", "/builder/talent"],
      ["creative", "/builder/creative"],
      ["knowledge", "/builder/knowledge"],
      ["admin", "/builder/admin"],
    ]) {
      expect(screen.getByTestId(`home-card-${id}`).getAttribute("href"), id).toBe(to);
    }
  });

  it("opens the apps that stay outside Verdanote in a new tab", () => {
    renderHome();
    for (const [id, href] of [
      ["goodo-time", GOODO_TIME_URL],
      ["attio", ATTIO_URL],
      ["old-dashboard-public", OLD_DASHBOARD_PUBLIC_URL],
    ]) {
      const link = screen.getByTestId(`home-app-${id}`);
      expect(link.getAttribute("href")).toBe(href);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
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
