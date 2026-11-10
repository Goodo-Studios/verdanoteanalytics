// Staff menu model. One place lists every staff tool: pages that already live in
// Verdanote, slots for tools that are still moving in from the other apps, and links
// to apps that stay outside. The menu page renders this list and the tests read it, so
// moving a tool in means changing one entry here (status "slot" -> "live", add `to`).
//
// Source plan: companies/goodo-studios/projects/goodo-os-consolidation/README.md,
// sections "The staff area inside Verdanote" and "Order of moves".

export type StaffMenuStatus = "live" | "slot" | "link";

export type StaffMenuItem = {
  id: string;
  title: string;
  description: string;
  status: StaffMenuStatus;
  /** Role-relative path of a page inside Verdanote (status "live"). */
  to?: string;
  /** Absolute URL of an app that stays outside Verdanote (status "link"). */
  href?: string;
  /** Plan step that fills the slot, for example "Step 1". Slots only. */
  step?: string;
  /** Builder-only entry, hidden from employees. */
  builderOnly?: boolean;
};

export type StaffMenuSection = {
  id: string;
  label: string;
  blurb: string;
  items: StaffMenuItem[];
};

export const GOODO_TIME_URL = "https://goodo-time.vercel.app";
export const ATTIO_URL = "https://app.attio.com";
// The old dashboard keeps its public pages (creator and actor application forms, and the
// secret-token links already sent to clients, talent and crew) at this address.
export const OLD_DASHBOARD_PUBLIC_URL = "https://goodostudios-production.vercel.app";

export const staffMenuSections: StaffMenuSection[] = [
  {
    id: "verdanote",
    label: "Verdanote tools",
    blurb: "Pages that are already part of Verdanote.",
    items: [
      { id: "agency", title: "Agency overview", description: "All accounts side by side.", status: "live", to: "/agency" },
      { id: "creative-library", title: "Creative Library", description: "Playable creatives with performance.", status: "live", to: "/creative-library" },
      { id: "briefs", title: "Briefs", description: "Creative briefs and templates.", status: "live", to: "/briefs" },
      { id: "reports", title: "Reports", description: "Build and share client reports.", status: "live", to: "/reports" },
      { id: "pipeline", title: "Content Pipeline", description: "Content in progress, by stage.", status: "live", to: "/pipeline" },
      { id: "vault", title: "Creative Vault", description: "Saved ads, boards and hooks.", status: "live", to: "/ad-library" },
      { id: "tagging", title: "Tagging", description: "Fix and review creative tags.", status: "live", to: "/tagging" },
      { id: "landing-pages", title: "Landing Pages", description: "Spend and results by landing page.", status: "live", to: "/landing-pages" },
      { id: "creative-rotation", title: "Creative Rotation", description: "Freshness and new ad cohorts.", status: "live", to: "/creative-rotation" },
      { id: "entities", title: "Creative Diversity", description: "Clusters of similar creatives.", status: "live", to: "/entities" },
      { id: "matrix", title: "Creative Matrix", description: "Theme and persona by creative type.", status: "live", to: "/matrix", builderOnly: true },
      { id: "ad-name-generator", title: "Ad Name Generator", description: "Ad codes from one shared counter.", status: "live", to: "/ad-name-generator" },
      { id: "integration-health", title: "Integration health", description: "ClickUp, Fireflies, Slack and ad sync status.", status: "live", to: "/integration-health" },
      { id: "meeting-recaps", title: "Meeting recaps", description: "Decisions and actions from Fireflies calls, confirmed by a person.", status: "live", to: "/meeting-recaps" },
      { id: "growth-dashboard", title: "Growth Dashboard", description: "Revenue and growth numbers. Builder only.", status: "live", to: "/growth-dashboard", builderOnly: true },
    ],
  },
  {
    id: "moving-in",
    label: "Moving in",
    blurb: "Tools from the other apps. Each slot opens when its page is built and checked in staging.",
    items: [
      { id: "goodo-os", title: "Goodo OS areas", description: "Knowledge pages, then waves B to D. Talent and call sheets move with step 5c.", status: "slot", step: "Step 4" },
      { id: "dashboard-pipeline", title: "Old dashboard: Overview, Client Detail, Pipeline, Follow-ups", description: "First batch of dashboard pages.", status: "slot", step: "Step 5a" },
      { id: "dashboard-creators", title: "Old dashboard: Creators, Actors, Applications", description: "Creator and actor management and application review.", status: "slot", step: "Step 5b" },
      { id: "dashboard-production", title: "Old dashboard: Production", description: "Casting, calendars, call sheets, locations, props, crew, shipments.", status: "slot", step: "Step 5c" },
      { id: "dashboard-settings", title: "Old dashboard: Settings and team", description: "Team management, merged with Verdanote user management.", status: "slot", step: "Step 5d" },
      { id: "wideframe", title: "Wideframe Prompt Library", description: "Read-only prompt pages for editors.", status: "slot", step: "Step 6" },
      { id: "bid-viewer", title: "Client BIDs", description: "Read-only view of each client's finished BID.", status: "slot", step: "Step 6" },
      { id: "content-leaderboard", title: "Content Leaderboard", description: "LinkedIn post log for the team.", status: "slot", step: "Step 8" },
    ],
  },
  {
    id: "elsewhere",
    label: "Other apps",
    blurb: "These stay outside Verdanote and open in a new tab.",
    items: [
      { id: "goodo-time", title: "Goodo Time", description: "Time tracking for the team.", status: "link", href: GOODO_TIME_URL },
      { id: "attio", title: "Attio", description: "Leads and relationships.", status: "link", href: ATTIO_URL },
      { id: "old-dashboard-public", title: "Old dashboard public pages", description: "Application forms and client, talent and crew links, until they move.", status: "link", href: OLD_DASHBOARD_PUBLIC_URL },
    ],
  },
];

/** Every item across all sections, flattened. */
export const allStaffMenuItems: StaffMenuItem[] = staffMenuSections.flatMap((s) => s.items);
