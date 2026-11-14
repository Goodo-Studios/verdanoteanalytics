/**
 * OS-004: the top client picker shows only on pages that filter by client: inside a client,
 * every Creative tab, and tabs marked usesClient. Everywhere else it is gone.
 */
import { describe, expect, it } from "vitest";
import { SECTIONS, showsClientPicker } from "@/lib/sections";

describe("showsClientPicker", () => {
  it.each([
    "/builder/clients/acme",
    "/builder/clients/acme/work",
    "/employee/clients/acme/setup/brand",
    "/builder/creative",
    "/builder/creative/creatives",
    "/builder/creative/briefs",
    "/builder/knowledge/meetings",
    "/builder/knowledge/bids",
    "/builder/knowledge/learning",
    "/builder/admin/operations",
    "/builder/admin/support",
    "/builder/production/casting",
    "/builder/talent/pipeline",
    "/builder/talent/approval-boards",
  ])("shows on %s", (path) => {
    expect(showsClientPicker(path)).toBe(true);
  });

  it.each([
    "/builder/",
    "/builder/work",
    "/builder/clients",
    "/builder/knowledge/shared",
    "/builder/tools/ad-name-generator",
    "/builder/admin/team",
    "/builder/admin/integration-health",
    "/builder/production/calendar",
    "/builder/talent/creators",
    "/builder/settings",
    "/builder/knowledge",
  ])("hides on %s", (path) => {
    expect(showsClientPicker(path)).toBe(false);
  });

  it("covers every Creative tab", () => {
    const creative = SECTIONS.find((s) => s.id === "creative")!;
    for (const tab of creative.tabs) expect(showsClientPicker(`/builder/creative/${tab.slug}`)).toBe(true);
  });

  it("Tools has no tab that uses the picker (the Ad Name Generator keeps its own Client field)", () => {
    const tools = SECTIONS.find((s) => s.id === "tools")!;
    expect(tools.tabs.some((t) => t.usesClient)).toBe(false);
  });
});
