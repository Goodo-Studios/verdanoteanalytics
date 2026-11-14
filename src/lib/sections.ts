// Staff menu model. Eleven menu items: Home, Clients, Production, Creators, Creative, Creative Vault,
// Knowledge, Growth Dashboard, Ad Name Generator, Time and Admin. All but Home and Clients are one page
// each with tabs; every tab renders an existing page component unchanged. This file is
// pure data so the sidebar, the section pages, the redirects and the tests all read the
// same list.
import type { routeImports } from "@/lib/routePrefetch";
import { isHiddenPage } from "@/lib/hiddenPages";

export type PageKey = keyof typeof routeImports;
export type SectionId = "production" | "talent" | "creative" | "vault" | "knowledge" | "growth" | "tools" | "admin";

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
  /** Filters by the selected client, so the top client picker shows on this tab (OS-004). */
  usesClient?: boolean;
}

export interface SectionDef {
  id: SectionId;
  label: string;
  description: string;
  /**
   * Optional groups, in order. When set, the section shows one row of group links and, below
   * it, only the tabs of the open group. Every tab must then name one of these groups.
   */
  groups?: string[];
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
      { slug: "casting", label: "Casting", page: "casting", legacy: ["/casting"], usesClient: true },
      // Moved out of Talent. The old addresses redirect here.
      { slug: "actors", label: "Actors", page: "actors", legacy: ["/actors", "/talent/actors"] },
      { slug: "actor-applications", label: "Actor applications", page: "actorApplications", legacy: [] },
      { slug: "crew", label: "Crew", page: "crew", legacy: ["/crew"] },
      { slug: "locations", label: "Locations", page: "locations", legacy: ["/locations"] },
      { slug: "props", label: "Props", page: "props", legacy: ["/props"] },
      { slug: "shipments", label: "Shipments", page: "shipments", legacy: ["/shipments"] },
    ],
  },
  {
    id: "talent",
    label: "Creators",
    description: "Creators, their applications and the creator pipeline.",
    tabs: [
      { slug: "creators", label: "Creators", page: "creators", legacy: ["/creators"] },
      { slug: "applications", label: "Applications", page: "applications", legacy: ["/applications"] },
      { slug: "pipeline", label: "Creator pipeline", page: "creatorPipeline", legacy: ["/creator-pipeline"], usesClient: true },
      { slug: "approval-boards", label: "Approval boards", page: "approvalBoards", legacy: ["/approval-boards"], usesClient: true },
    ],
  },
  {
    id: "creative",
    label: "Creative",
    description: "Ad performance, the creative library, tagging and reports.",
    // Four groups, each with its own short row of tabs (Goodo OS OS-003). Slugs did not
    // change, so every old Creative address still opens the same page.
    groups: ["Performance", "Library", "Tagging", "Reports"],
    tabs: [
      { slug: "overview", label: "Overview", page: "overview", legacy: [], needsAccount: true, group: "Performance" },
      { slug: "agency", label: "Agency overview", page: "agencyDashboard", legacy: ["/agency"], group: "Performance" },
      { slug: "creatives", label: "Creatives", page: "creatives", legacy: ["/creatives"], needsAccount: true, group: "Performance" },
      { slug: "analytics", label: "Analytics", page: "analytics", legacy: ["/analytics"], needsAccount: true, group: "Performance" },
      { slug: "rotation", label: "Creative Rotation", page: "creativeRotation", legacy: ["/creative-rotation"], needsAccount: true, requireOneAccount: "Creative Rotation", group: "Performance" },
      { slug: "diversity", label: "Creative Diversity", page: "entityReport", legacy: ["/entities"], needsAccount: true, requireOneAccount: "Creative Diversity", group: "Performance" },
      { slug: "landing-pages", label: "Landing Pages", page: "landingPages", legacy: ["/landing-pages"], needsAccount: true, requireOneAccount: "Landing Pages", group: "Performance" },
      { slug: "library", label: "Creative Library", page: "creativeLibrary", legacy: ["/creative-library"], needsAccount: true, group: "Library" },
      { slug: "tagging", label: "Tagging", page: "tagging", legacy: ["/tagging"], needsAccount: true, group: "Tagging" },
      { slug: "matrix", label: "Matrix", page: "matrix", legacy: ["/matrix"], builderOnly: true, needsAccount: true, group: "Tagging" },
      { slug: "reports", label: "Reports", page: "reports", legacy: ["/reports"], needsAccount: true, group: "Reports" },
      { slug: "briefs", label: "Briefs", page: "briefs", legacy: ["/briefs"], needsAccount: true, group: "Reports" },
    ],
  },
  {
    id: "vault",
    label: "Creative Vault",
    description: "The saved ad library, boards of saved creatives and the hook library.",
    tabs: [
      // Moved out of Creative so the Vault stands apart from analytics. The old Creative
      // addresses redirect here.
      { slug: "library", label: "Vault", page: "adLibrary", legacy: ["/ad-library", "/creative/vault"] },
      { slug: "boards", label: "Boards", page: "boards", legacy: ["/ad-library/boards", "/creative/vault-boards"] },
      { slug: "hooks", label: "Hooks", page: "hooks", legacy: ["/ad-library/hooks", "/creative/vault-hooks"] },
    ],
  },
  {
    id: "knowledge",
    label: "Knowledge",
    description: "The company Brain, shared knowledge, meeting recaps and client BIDs.",
    tabs: [
      { slug: "shared", label: "Knowledge", page: "knowledge", legacy: [] },
      // Published from HQ knowledge by scripts/publish-brain.mjs (Goodo OS OS-014).
      { slug: "brain", label: "Brain", page: "brain", legacy: [] },
      { slug: "learning", label: "Learning", page: "learning", legacy: ["/learning"], usesClient: true },
      { slug: "meetings", label: "Meeting recaps", page: "meetingRecaps", legacy: ["/meeting-recaps"], usesClient: true },
      { slug: "bids", label: "Client BIDs", page: "bidViewer", legacy: ["/bids"], usesClient: true },
    ],
  },
  {
    id: "growth",
    label: "Growth Dashboard",
    description: "Revenue against the plan, call tracking and output trends.",
    tabs: [
      // Moved out of Admin so it sits in the side menu. The old Admin address redirects here.
      { slug: "dashboard", label: "Growth Dashboard", page: "growthDashboard", legacy: ["/growth-dashboard", "/admin/growth"], builderOnly: true },
    ],
  },
  {
    id: "tools",
    label: "Ad Name Generator",
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
      { slug: "operations", label: "Operations", page: "operations", legacy: ["/operations"], usesClient: true },
      { slug: "early-pages", label: "Early pages", page: "earlyPages", legacy: [], builderOnly: true },
      { slug: "operating-costs", label: "Operating costs", page: "operatingCosts", legacy: ["/operating-costs"], builderOnly: true },
      { slug: "agent-evaluations", label: "Agent evaluations", page: "agentEvaluations", legacy: ["/agent-evaluations"] },
      { slug: "support", label: "Support inbox", page: "supportInbox", legacy: ["/support"], usesClient: true },
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

/** Groups that have at least one tab this person may see, in the section's order. */
export function groupsFor(section: SectionDef, effectiveBuilder: boolean): string[] {
  const visible = tabsFor(section, effectiveBuilder);
  return (section.groups ?? []).filter((g) => visible.some((t) => t.group === g));
}

/**
 * Whether the top client picker shows on a page (OS-004). It shows inside a client, on every
 * Creative tab, and on tabs marked usesClient. Home, Work, Tools, Admin settings and the rest
 * show none. The path may carry the role prefix (/builder, /employee).
 */
export function showsClientPicker(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "builder" || parts[0] === "employee" || parts[0] === "client") parts.shift();
  const [first, second] = parts;
  if (first === "clients") return second !== undefined;
  if (first === "creative") return true;
  const section = first ? sectionById(first) : undefined;
  if (!section || !second) return false;
  return section.tabs.some((t) => t.slug === second && t.usesClient === true);
}

export const sectionPath = (section: SectionDef, tab?: TabDef): string => `/${section.id}${tab ? `/${tab.slug}` : ""}`;

// ---------------------------------------------------------------- Sidebar items

export type StaffNavId = "home" | "clients" | "time" | SectionId;
export interface StaffNavEntry {
  id: StaffNavId;
  label: string;
  /** Role-relative path. */
  url: string;
}

/** The eleven items of the staff menu, in order. */
export const STAFF_NAV: StaffNavEntry[] = [
  { id: "home", label: "Home", url: "/" },
  { id: "clients", label: "Clients", url: "/clients" },
  { id: "production", label: "Production", url: "/production" },
  { id: "talent", label: "Creators", url: "/talent" },
  { id: "creative", label: "Creative", url: "/creative" },
  { id: "vault", label: "Creative Vault", url: "/vault" },
  { id: "knowledge", label: "Knowledge", url: "/knowledge" },
  { id: "growth", label: "Growth Dashboard", url: "/growth" },
  { id: "tools", label: "Ad Name Generator", url: "/tools" },
  { id: "time", label: "Time", url: "/time" },
  { id: "admin", label: "Admin", url: "/admin" },
];
