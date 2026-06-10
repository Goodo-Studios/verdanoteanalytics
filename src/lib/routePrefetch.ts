// Lazy route chunk loaders, shared between the React.lazy() route definitions
// (App.tsx) and hover/focus prefetch (AppSidebar). A dynamic import() is cached
// by the bundler against its module specifier, so prefetching on hover and the
// eventual lazy() mount resolve to the same single network fetch.

export const routeImports = {
  overview: () => import("@/pages/OverviewPage"),
  creatives: () => import("@/pages/CreativesPage"),
  analytics: () => import("@/pages/AnalyticsPage"),
  compare: () => import("@/pages/ComparePage"),
  tagging: () => import("@/pages/TaggingPage"),
  reports: () => import("@/pages/ReportsPage"),
  clientReports: () => import("@/pages/ClientReportsPage"),
  reportDetail: () => import("@/pages/ReportDetailPage"),
  reportBuilder: () => import("@/pages/ReportBuilderPage"),
  settings: () => import("@/pages/SettingsPage"),
  briefs: () => import("@/pages/BriefsPage"),
  agencyDashboard: () => import("@/pages/AgencyDashboardPage"),
  contentPipeline: () => import("@/pages/ContentPipelinePage"),
  adLibrary: () => import("@/features/vault/LibraryPage"),
  vaultItemDetail: () => import("@/features/vault/ItemDetailPage"),
  boards: () => import("@/features/vault/BoardsPage"),
  boardDetail: () => import("@/features/vault/BoardDetailPage"),
  hooks: () => import("@/features/vault/HooksPage"),
} as const;

type Loader = () => Promise<unknown>;

// Map a role-relative nav path (the sidebar item.url) → chunk loader(s) to warm.
// A path may pull more than one chunk when the destination commonly fans out
// (e.g. /creatives → compare, /reports → client vs. builder variant).
const PATH_PREFETCH: Record<string, Loader[]> = {
  "/": [routeImports.overview],
  "/creatives": [routeImports.creatives, routeImports.compare],
  "/analytics": [routeImports.analytics],
  "/tagging": [routeImports.tagging],
  "/pipeline": [routeImports.contentPipeline],
  "/briefs": [routeImports.briefs],
  "/reports": [routeImports.reports, routeImports.clientReports],
  "/agency": [routeImports.agencyDashboard],
  "/settings": [routeImports.settings],
  "/ad-library": [routeImports.adLibrary, routeImports.vaultItemDetail],
  "/ad-library/boards": [routeImports.boards, routeImports.boardDetail],
  "/ad-library/hooks": [routeImports.hooks],
};

const prefetched = new Set<string>();

/**
 * Prefetch the route chunk(s) for a nav path. Idempotent per session; a role
 * prefix (/builder, /client, /employee) on the path is stripped before lookup.
 * Fire-and-forget — a failed prefetch is forgotten so the natural lazy() mount
 * can retry.
 */
export function prefetchRoute(path: string): void {
  const rel = path.replace(/^\/(builder|client|employee)/, "") || "/";
  if (prefetched.has(rel)) return;
  const loaders = PATH_PREFETCH[rel];
  if (!loaders) return;
  prefetched.add(rel);
  for (const load of loaders) {
    load().catch(() => prefetched.delete(rel));
  }
}
