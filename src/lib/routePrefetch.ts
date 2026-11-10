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
  entityReport: () => import("@/pages/EntityReportPage"),
  clientReports: () => import("@/pages/ClientReportsPage"),
  reportDetail: () => import("@/pages/ReportDetailPage"),
  reportBuilder: () => import("@/pages/ReportBuilderPage"),
  landingPages: () => import("@/pages/LandingPagesPage"),
  creativeRotation: () => import("@/pages/CreativeRotationPage"),
  settings: () => import("@/pages/SettingsPage"),
  briefs: () => import("@/pages/BriefsPage"),
  agencyDashboard: () => import("@/pages/AgencyDashboardPage"),
  staffHome: () => import("@/pages/StaffHomePage"),
  contentPipeline: () => import("@/pages/ContentPipelinePage"),
  creativeLibrary: () => import("@/features/creative-library/CreativeLibraryPage"),
  adLibrary: () => import("@/features/vault/LibraryPage"),
  vaultItemDetail: () => import("@/features/vault/ItemDetailPage"),
  boards: () => import("@/features/vault/BoardsPage"),
  boardDetail: () => import("@/features/vault/BoardDetailPage"),
  hooks: () => import("@/features/vault/HooksPage"),
  taxonomyConfig: () => import("@/features/matrix/config/TaxonomyConfigSection"),
  matrix: () => import("@/features/matrix/board/MatrixBoardPage"),
  growthDashboard: () => import("@/features/growth-dashboard/GrowthDashboardPage"),
  adNameGenerator: () => import("@/features/ad-name-generator/AdNameGeneratorPage"),
  integrationHealth: () => import("@/features/integration-health/IntegrationHealthPage"),
  meetingRecaps: () => import("@/features/meeting-recaps/MeetingRecapsPage"),
  knowledge: () => import("@/features/knowledge/KnowledgePage"),
  followUps: () => import("@/features/dashboard/FollowUpsPage"),
  creatorPipeline: () => import("@/features/dashboard/CreatorPipelinePage"),
  clientDetail: () => import("@/features/dashboard/ClientDetailPage"),
  clientOverview: () => import("@/features/dashboard/OverviewPage"),
  engagements: () => import("@/features/engagements/EngagementsPage"),
  deliverables: () => import("@/features/deliverables/DeliverablesPage"),
  qaGates: () => import("@/features/qa-gates/QaGatesPage"),
  handoffs: () => import("@/features/handoffs/HandoffsPage"),
  agentEvaluations: () => import("@/features/agent-evaluations/AgentEvaluationsPage"),
  operations: () => import("@/features/operations/OperationsPage"),
  operatingCosts: () => import("@/features/operating-costs/OperatingCostsPage"),
  supportInbox: () => import("@/features/support/SupportInboxPage"),
  learning: () => import("@/features/learning/LearningPage"),
  scopeChanges: () => import("@/features/scope-changes/ScopeChangesPage"),
  recommendations: () => import("@/features/recommendations/RecommendationsPage"),
  approvalBoards: () => import("@/features/dashboard/ApprovalBoardsPage"),
  locations: () => import("@/features/dashboard/LocationsPage"),
  props: () => import("@/features/dashboard/PropsPage"),
  crew: () => import("@/features/dashboard/CrewPage"),
  shipments: () => import("@/features/dashboard/ShipmentsPage"),
  productionCalendar: () => import("@/features/dashboard/ProductionCalendarPage"),
  casting: () => import("@/features/dashboard/CastingPage"),
  applications: () => import("@/features/dashboard/ApplicationsPage"),
  applicationDetail: () => import("@/features/dashboard/ApplicationDetailPage"),
  actors: () => import("@/features/dashboard/ActorsPage"),
  actorDetail: () => import("@/features/dashboard/ActorDetailPage"),
  creators: () => import("@/features/dashboard/CreatorsPage"),
  creatorDetail: () => import("@/features/dashboard/CreatorDetailPage"),
  strategy: () => import("@/features/strategy/StrategyPage"),
} as const;

type Loader = () => Promise<unknown>;

// Map a role-relative nav path (the sidebar item.url) → chunk loader(s) to warm.
// A path may pull more than one chunk when the destination commonly fans out
// (e.g. /creatives → compare, /reports → client vs. builder variant).
const PATH_PREFETCH: Record<string, Loader[]> = {
  "/": [routeImports.overview],
  "/creatives": [routeImports.creatives, routeImports.compare],
  "/creative-library": [routeImports.creativeLibrary],
  "/analytics": [routeImports.analytics],
  "/tagging": [routeImports.tagging],
  "/pipeline": [routeImports.contentPipeline],
  "/briefs": [routeImports.briefs],
  "/reports": [routeImports.reports, routeImports.clientReports],
  "/creative-rotation": [routeImports.creativeRotation],
  "/entities": [routeImports.entityReport],
  "/agency": [routeImports.agencyDashboard],
  "/staff": [routeImports.staffHome],
  "/settings": [routeImports.settings, routeImports.taxonomyConfig],
  "/matrix": [routeImports.matrix],
  "/growth-dashboard": [routeImports.growthDashboard],
  "/ad-name-generator": [routeImports.adNameGenerator],
  "/integration-health": [routeImports.integrationHealth],
  "/meeting-recaps": [routeImports.meetingRecaps],
  "/knowledge": [routeImports.knowledge],
  "/follow-ups": [routeImports.followUps],
  "/creator-pipeline": [routeImports.creatorPipeline],
  "/clients": [routeImports.clientOverview],
  "/engagements": [routeImports.engagements],
  "/deliverables": [routeImports.deliverables],
  "/qa-gates": [routeImports.qaGates],
  "/handoffs": [routeImports.handoffs],
  "/agent-evaluations": [routeImports.agentEvaluations],
  "/operations": [routeImports.operations],
  "/operating-costs": [routeImports.operatingCosts],
  "/support": [routeImports.supportInbox],
  "/learning": [routeImports.learning],
  "/scope-changes": [routeImports.scopeChanges],
  "/recommendations": [routeImports.recommendations],
  "/approval-boards": [routeImports.approvalBoards],
  "/locations": [routeImports.locations],
  "/props": [routeImports.props],
  "/crew": [routeImports.crew],
  "/shipments": [routeImports.shipments],
  "/production-calendar": [routeImports.productionCalendar],
  "/casting": [routeImports.casting],
  "/applications": [routeImports.applications],
  "/actors": [routeImports.actors],
  "/creators": [routeImports.creators],
  "/strategy": [routeImports.strategy],
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
