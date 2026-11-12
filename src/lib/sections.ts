// Staff menu model. Eight menu items: Home, Clients, Production, Talent, Creative,
// Knowledge, Tools and Admin. Production, Talent, Creative, Knowledge, Tools and Admin are one page
// each with tabs; every tab renders an existing page component unchanged. This file is
// pure data so the sidebar, the section pages, the redirects and the tests all read the
// same list.
import type { routeImports } from "@/lib/routePrefetch";
import { isHiddenPage } from "@/lib/hiddenPages";

export type PageKey = keyof typeof routeImports;
export type SectionId = "production" | "talent" | "creative" | "knowledge" | "tools" | "admin";

export interface TabDef {
  /** Last URL segment: /production/calendar. */
  slug: string;
  label: string;
  /** The existing page this tab shows. */
  page: PageKey;
  /** Role-relative paths this tab used to live at. They redirect here. */
  legacy: string[];
  /** Real builder only (matches the page's old route guard). */
  builderOnly?: boolean;
  /** Works on one client's ad account. Shows a plain message when the client has none. */
  needsAccount?: boolean;
  /** Page that needs exactly one ad account: asks for a client on the all-clients view. */
  requireOneAccount?: string;
  /** Small label above a run of related tabs. */
  group?: string;
}

export interface SectionDef {
  id: SectionId;
  label: string;
  description: string;
  tabs: TabDef[];
}

export const SECTIONS: SectionDef[] = [
  {
    id: "production",
    label: "Production",
    description: "Shoots, call sheets, casting, crew, locations, props and shipments.",
    tabs: [
      { slug: "calendar", label: "Production calendar", page: "productionCalendar", legacy: ["/production-calendar"] },
      { slug: "call-sheets", label: "Call sheets", page: "callSheets", legacy: ["/call-sheets"] },
      { slug: "casting", label: "Casting", page: "casting", legacy: ["/casting"] },
      { slug: "crew", label: "Crew", page: "crew", legacy: ["/crew"] },
      { slug: "locations", label: "Locations", page: "locations", legacy: ["/locations"] },
      { slug: "props", label: "Props", page: "props", legacy: ["/props"] },
      { slug: "shipments", label: "Shipments", page: "shipments", legacy: ["/shipments"] },
    ],
  },
  {
    id: "talent",
    label: "Talent",
    description: "Creators, actors, applications and the creator pipeline.",
    tabs: [
      { slug: "creators", label: "Creators", page: "creators", legacy: ["/creators"] },
      { slug: "actors", label: "Actors", page: "actors", legacy: ["/actors"] },
      { slug: "applications", label: "Applications", page: "applications", legacy: ["/applications"] },
      { slug: "pipeline", label: "Creator pipeline", page: "creatorPipeline", legacy: ["/creator-pipeline"] },
      { slug: "follow-ups", label: "Follow-ups", page: "followUps", legacy: ["/follow-ups"] },
      { slug: "approval-boards", label: "Approval boards", page: "approvalBoards", legacy: ["/approval-boards"] },
    ],
  },
  {
    id: "creative",
    label: "Creative",
    description: "Ad analytics, creatives, briefs, reports and the Creative Vault.",
    tabs: [
      { slug: "overview", label: "Overview", page: "overview", legacy: [], needsAccount: true },
      { slug: "agency", label: "Agency overview", page: "agencyDashboard", legacy: ["/agency"] },
      { slug: "creatives", label: "Creatives", page: "creatives", legacy: ["/creatives"], needsAccount: true },
      { slug: "library", label: "Creative Library", page: "creativeLibrary", legacy: ["/creative-library"], needsAccount: true },
      { slug: "analytics", label: "Analytics", page: "analytics", legacy: ["/analytics"], needsAccount: true },
      { slug: "matrix", label: "Matrix", page: "matrix", legacy: ["/matrix"], builderOnly: true, needsAccount: true },
      { slug: "tagging", label: "Tagging", page: "tagging", legacy: ["/tagging"], needsAccount: true },
      { slug: "briefs", label: "Briefs", page: "briefs", legacy: ["/briefs"], needsAccount: true },
      { slug: "reports", label: "Reports", page: "reports", legacy: ["/reports"], needsAccount: true },
      { slug: "landing-pages", label: "Landing Pages", page: "landingPages", legacy: ["/landing-pages"], needsAccount: true, requireOneAccount: "Landing Pages" },
      { slug: "rotation", label: "Creative Rotation", page: "creativeRotation", legacy: ["/creative-rotation"], needsAccount: true, requireOneAccount: "Creative Rotation" },
      { slug: "diversity", label: "Creative Diversity", page: "entityReport", legacy: ["/entities"], needsAccount: true, requireOneAccount: "Creative Diversity" },
      { slug: "vault", label: "Library", page: "adLibrary", legacy: ["/ad-library"], group: "Vault" },
      { slug: "vault-boards", label: "Boards", page: "boards", legacy: ["/ad-library/boards"], group: "Vault" },
      { slug: "vault-hooks", label: "Hooks", page: "hooks", legacy: ["/ad-library/hooks"], group: "Vault" },
    ],
  },
  {
    id: "knowledge",
    label: "Knowledge",
    description: "Shared knowledge, meeting recaps and client BIDs.",
    tabs: [
      { slug: "shared", label: "Knowledge", page: "knowledge", legacy: [] },
      { slug: "learning", label: "Learning", page: "learning", legacy: ["/learning"] },
      { slug: "meetings", label: "Meeting recaps", page: "meetingRecaps", legacy: ["/meeting-recaps"] },
      { slug: "bids", label: "Client BIDs", page: "bidViewer", legacy: ["/bids"] },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    description: "Everyday utilities for production work, such as naming ad files.",
    tabs: [
      // Moved out of Admin (Goodo OS OS-002). The old Admin address redirects here.
      { slug: "ad-name-generator", label: "Ad Name Generator", page: "adNameGenerator", legacy: ["/ad-name-generator", "/admin/ad-name-generator"] },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    description: "Team, integrations, notifications, operations and the support inbox.",
    tabs: [
      { slug: "team", label: "Team and settings", page: "team", legacy: ["/team"] },
      { slug: "integration-health", label: "Integration health", page: "integrationHealth", legacy: ["/integration-health"] },
      { slug: "notifications", label: "Notifications", page: "notifications", legacy: [] },
      { slug: "operations", label: "Operations", page: "operations", legacy: ["/operations"] },
      { slug: "early-pages", label: "Early pages", page: "earlyPages", legacy: [], builderOnly: true },
      { slug: "operating-costs", label: "Operating costs", page: "operatingCosts", legacy: ["/operating-costs"], builderOnly: true },
      { slug: "agent-evaluations", label: "Agent evaluations", page: "agentEvaluations", legacy: ["/agent-evaluations"] },
      { slug: "growth", label: "Growth Dashboard", page: "growthDashboard", legacy: ["/growth-dashboard"], builderOnly: true },
      { slug: "support", label: "Support inbox", page: "supportInbox", legacy: ["/support"] },
    ],
  },
];

export const sectionById = (id: string): SectionDef | undefined => SECTIONS.find((s) => s.id === id);

/**
 * Tabs shown in the menu, the tab bar and the palette. Builder-only tabs need a real builder.
 * Hidden pages (src/lib/hiddenPages.ts) are never listed; the address still opens for a builder.
 */
export function tabsFor(section: SectionDef, effectiveBuilder: boolean): TabDef[] {
  return section.tabs.filter((t) => (effectiveBuilder || !t.builderOnly) && !isHiddenPage(t.page));
}

export const sectionPath = (section: SectionDef, tab?: TabDef): string => `/${section.id}${tab ? `/${tab.slug}` : ""}`;

// ---------------------------------------------------------------- Sidebar items

export type StaffNavId = "home" | "clients" | SectionId;
export interface StaffNavEntry {
  id: StaffNavId;
  label: string;
  /** Role-relative path. */
  url: string;
}

/** The eight items of the staff menu, in order. */
export const STAFF_NAV: StaffNavEntry[] = [
  { id: "home", label: "Home", url: "/" },
  { id: "clients", label: "Clients", url: "/clients" },
  { id: "production", label: "Production", url: "/production" },
  { id: "talent", label: "Talent", url: "/talent" },
  { id: "creative", label: "Creative", url: "/creative" },
  { id: "knowledge", label: "Knowledge", url: "/knowledge" },
  { id: "tools", label: "Tools", url: "/tools" },
  { id: "admin", label: "Admin", url: "/admin" },
];
