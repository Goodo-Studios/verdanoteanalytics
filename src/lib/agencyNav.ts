import { LayoutGrid } from "lucide-react";
import type { NavItem, NavSection } from "@/components/AppSidebar";

/**
 * Staff on the Agency View (every account selected) keep the full staff menu.
 * The Creative Analytics section gains the agency overview at the top. Pages
 * that need one account stay listed and ask for an account on the page itself
 * (see RequireOneAccount).
 */
export const AGENCY_OVERVIEW_ITEM: NavItem = { title: "Agency overview", url: "/agency", icon: LayoutGrid };

export function sectionsForAgencyView(sections: NavSection[]): NavSection[] {
  return sections.map((section) =>
    section.id === "creative-analytics"
      ? { ...section, items: [AGENCY_OVERVIEW_ITEM, ...section.items] }
      : section,
  );
}
