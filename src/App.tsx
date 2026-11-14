import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AccountProvider } from "@/contexts/AccountContext";
import { DateRangeProvider } from "@/contexts/DateRangeContext";
import { ClientPreviewContext, useClientPreviewMode } from "@/hooks/useClientPreviewMode";
import { ClientPreviewBanner } from "@/components/ClientPreviewBanner";
import { useRolePrefix } from "@/hooks/useRolePath";
import { Loader2 } from "lucide-react";
import { useClientPreview } from "@/hooks/useClientPreviewMode";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppLayout } from "@/components/AppLayout";
import { RequireOneAccount } from "@/components/RequireOneAccount";
import { PageSkeleton } from "@/components/skeletons/PageSkeleton";
import { routeImports } from "@/lib/routePrefetch";
import { SectionPage } from "@/components/sections/SectionPage";
import { LEGACY_REDIRECTS } from "@/lib/legacyRoutes";
import { SECTIONS } from "@/lib/sections";
import { CLIENT_SCOPED_LEGACY, STAFF_PIPELINE_LEGACY } from "@/lib/clientHub";
import { ClientScopedRedirect } from "@/components/ClientScopedRedirect";

// Critical pages — loaded eagerly (auth flow)
import LoginPage from "./pages/LoginPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import UpdatePasswordPage from "./pages/UpdatePasswordPage";
import { PrivacyPolicyPage, TermsPage, DataDeletionPage } from "./pages/LegalPages";

// Non-critical pages — lazy loaded for bundle splitting. The shell pages share
// their import thunks with the hover-prefetch registry (src/lib/routePrefetch)
// so a hovered tab and its eventual mount resolve to one fetch. Pages that only
// show inside a section tab are loaded by SectionPage (src/components/sections).
const OverviewPage = lazy(routeImports.overview);
const CreativesPage = lazy(routeImports.creatives);
const AnalyticsPage = lazy(routeImports.analytics);
const ComparePage = lazy(routeImports.compare);
const ClientReportsPage = lazy(routeImports.clientReports);
const ClientBriefsPage = lazy(routeImports.clientBriefs);
const ClientReviewPage = lazy(routeImports.clientReview);
const ClientAssetsPage = lazy(routeImports.clientAssets);
const ReportDetailPage = lazy(routeImports.reportDetail);
const ReportBuilderPage = lazy(routeImports.reportBuilder);
const PublicReportPage = lazy(() => import("./pages/PublicReportPage"));
const SettingsPage = lazy(routeImports.settings);
const PublicBriefPage = lazy(() => import("./pages/PublicBriefPage"));
// Staff Home: the front door of the staff area (builder and employee only).
const HomePage = lazy(routeImports.home);
const WorkPage = lazy(routeImports.work);
const MyWorkPage = lazy(routeImports.myWork);
const TimeLogPage = lazy(routeImports.timeLog);
const TimeReportsPage = lazy(routeImports.timeReports);
const ContentPipelinePage = lazy(routeImports.contentPipeline);
const VaultItemDetailPage = lazy(routeImports.vaultItemDetail);
const BoardDetailPage = lazy(routeImports.boardDetail);
// Client list and client hub (builder and employee). The hub renders the pages inside its tabs.
const ClientOverviewPage = lazy(routeImports.clientOverview);
const ClientHubPage = lazy(routeImports.clientHub);
// Detail pages for the Talent tabs (builder and employee).
const ApplicationDetailPage = lazy(routeImports.applicationDetail);
const ActorDetailPage = lazy(routeImports.actorDetail);
const CreatorDetailPage = lazy(routeImports.creatorDetail);

const SharedAdBoardPage = lazy(() => import("./pages/SharedAdBoardPage"));
const PublicVaultItemPage = lazy(() => import("./pages/PublicVaultItemPage"));
// Pages opened from a secret link with no login (approval boards, casting). Lazy: they stay out of
// the first load, and they pull in nothing from the staff area.
const PublicBoardPage = lazy(() => import("./features/public-links/PublicBoardPage"));
const PublicLocationBoardPage = lazy(() => import("./features/public-links/PublicLocationBoardPage"));
const PublicCallSheetPage = lazy(() => import("./features/public-links/PublicCallSheetPage"));
const PublicApplyPage = lazy(() => import("./features/public-links/PublicApplyPage"));
const BookmarkletReceiver = lazy(() => import("./pages/BookmarkletReceiver"));
// Mobile capture surfaces (vault-mobile-capture). Un-prefixed and lazy: both are
// opened cold from a phone — the Android share sheet (US-003) and an iOS
// home-screen icon (US-004) — so neither should pull in the app shell.
const CaptureShareTarget = lazy(() => import("./pages/CaptureShareTarget"));
const CaptureQuickAdd = lazy(() => import("./pages/CaptureQuickAdd"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Cached data belongs to one login. Drop all of it when someone signs out or a different user
// signs in, so the next person on this tab never sees the previous client's cards or decisions.
export function ClearCacheOnUserChange() {
  const client = useQueryClient();
  const { user } = useAuth();
  const previous = useRef<string | null>(null);
  const id = user?.id ?? null;
  useEffect(() => {
    if (previous.current !== null && previous.current !== id) client.clear();
    previous.current = id;
  }, [id, client]);
  return null;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000, // 2 minutes
      gcTime: 10 * 60 * 1000,   // 10 minutes
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});


function PageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

/** Redirect / to the correct role prefix */
function RoleRedirect() {
  const { isLoading } = useAuth();
  const prefix = useRolePrefix();
  // Wait for the role to resolve before redirecting. Without this guard,
  // useRolePrefix() returns the "/builder" default while the role is still
  // pending, so a client momentarily lands on /builder/ before settling on
  // /client/ — a visible flash, and a race for any consumer reading the URL.
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return <Navigate to={`${prefix}/`} replace />;
}

/** Redirect /editor/* to /builder/* */
function EditorRedirect() {
  const location = useLocation();
  const rest = location.pathname.replace(/^\/editor\/?/, "/");
  return <Navigate to={`/builder${rest}${location.search}`} replace />;
}

/**
 * Validates URL role prefix matches user's actual role.
 * If mismatch, redirects to the correct prefix preserving the sub-path.
 */
export function RoleGuardedRoutes() {
  const { role: urlRole } = useParams<{ role: string }>();
  const prefix = useRolePrefix();
  const location = useLocation();
  const { user, isLoading, isClient, isBuilder, isEmployee } = useAuth();
  const { isClientPreview, isEmployeePreview } = useClientPreview();
  const effectiveClient = isClient || isClientPreview;
  // Employee feature parity (owner decision 2026-07-21): employees get every
  // PRODUCT surface builders have. Admin (user mgmt, Meta/settings, API keys,
  // cache tools) stays builder-only.
  const isStaff = isBuilder || isEmployee;
  // A staff page loads for real staff only. A builder previewing the client view sees what a
  // client sees, so staff pages redirect there too.
  const staffPage = isStaff && !effectiveClient;
  // Builder-only surfaces (US-007 Creative Matrix, matching the US-003 taxonomy
  // config gate): a real builder, not previewing another role.

  const [agencyHomeFlag] = useState(() => localStorage.getItem("verdanote_agency_default_home") === "true");
  const agencyHome = isStaff && agencyHomeFlag;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // Validate URL role matches user role — redirect if mismatch
  if (`/${urlRole}` !== prefix) {
    const rest = location.pathname.replace(/^\/(builder|client|employee)/, "");
    return <Navigate to={`${prefix}${rest}${location.search}`} replace />;
  }

  return (
    <AccountProvider>
      <DateRangeProvider>
      <ClientPreviewBanner />
      <AppLayout>
        <Suspense fallback={<PageSkeleton />}>
        <Routes>
          {/* Home. Staff who chose the agency overview as their start page land on it. */}
          <Route
            path="/"
            element={
              staffPage ? (agencyHome ? <Navigate to={`${prefix}/creative/agency`} replace /> : <HomePage />) : <OverviewPage />
            }
          />
          {/* Work: every client's ClickUp cards (a tab under Home). Staff only. */}
          <Route path="/work" element={staffPage ? <WorkPage /> : <Navigate to={`${prefix}/`} replace />} />
          {/* My work: my open Goodo OS tasks with the task side panel (a tab under Home). Staff only. */}
          <Route path="/my-work" element={staffPage ? <MyWorkPage /> : <Navigate to={`${prefix}/`} replace />} />
          {/* Time: my weekly time log, from the timer and by hand (a tab under Home, OS-012). Staff only. */}
          <Route path="/time" element={staffPage ? <TimeLogPage /> : <Navigate to={`${prefix}/`} replace />} />
          {/* Time reports: by client, person, task, content type or category, with CSV (OS-013). Staff only. */}
          <Route path="/time/reports" element={staffPage ? <TimeReportsPage /> : <Navigate to={`${prefix}/`} replace />} />
          {/* Staff menu sections: one page each, with tabs. A client, or a builder previewing
              the client view, goes to the index. */}
          {SECTIONS.flatMap((section) => [
            <Route key={section.id} path={`/${section.id}`} element={<SectionPage section={section} />} />,
            <Route key={`${section.id}-tab`} path={`/${section.id}/:tab`} element={<SectionPage section={section} />} />,
          ])}
          {/* Old addresses: every page that moved under a tab redirects to it, keeping the
              query string (?client=, ?brand=, ?account=). Anyone who is not staff goes to the
              index, as these routes did before. */}
          {LEGACY_REDIRECTS.filter((r) => !r.clientAccessible).map((r) => (
            <Route
              key={r.from}
              path={r.from}
              element={<Navigate to={staffPage ? `${prefix}${r.to}${location.search}` : `${prefix}/`} replace />}
            />
          ))}
          {/* A client's own pages stay where they are. Staff are sent to the tab. */}
          <Route path="/creatives" element={staffPage ? <Navigate to={`${prefix}/creative/creatives${location.search}`} replace /> : <CreativesPage />} />
          <Route path="/creatives/compare" element={<ComparePage />} />
          <Route path="/analytics" element={staffPage ? <Navigate to={`${prefix}/creative/analytics${location.search}`} replace /> : <AnalyticsPage />} />
          <Route path="/reports" element={staffPage ? <Navigate to={`${prefix}/creative/reports${location.search}`} replace /> : <ClientReportsPage />} />
          <Route path="/reports/:id" element={<ReportDetailPage />} />
          {/* Client pages (OS-019): Briefs, Review and Assets. Client logins only; staff go to their home. */}
          <Route path="/brief-review" element={staffPage ? <Navigate to={`${prefix}/`} replace /> : <ClientBriefsPage />} />
          <Route path="/review" element={staffPage ? <Navigate to={`${prefix}/`} replace /> : <ClientReviewPage />} />
          <Route path="/assets" element={staffPage ? <Navigate to={`${prefix}/`} replace /> : <ClientAssetsPage />} />
          {/* The report builder is a staff page. Clients read finished reports only. */}
          <Route path="/reports/:id/build" element={effectiveClient ? <Navigate to={`${prefix}/`} replace /> : <ReportBuilderPage />} />
          {/* Clients: the list, and the client hub (tabs) with the client in the address. */}
          <Route path="/clients" element={staffPage ? <ClientOverviewPage /> : <Navigate to={`${prefix}/`} replace />} />
          <Route path="/clients/:slug" element={staffPage ? <ClientHubPage /> : <Navigate to={`${prefix}/`} replace />} />
          <Route path="/clients/:slug/:tab" element={staffPage ? <ClientHubPage /> : <Navigate to={`${prefix}/`} replace />} />
          <Route path="/clients/:slug/:tab/:sub" element={staffPage ? <ClientHubPage /> : <Navigate to={`${prefix}/`} replace />} />
          <Route path="/applications/:kind/:id" element={staffPage ? <ApplicationDetailPage /> : <Navigate to={`${prefix}/`} replace />} />
          <Route path="/actors/:id" element={staffPage ? <ActorDetailPage /> : <Navigate to={`${prefix}/`} replace />} />
          <Route path="/creators/:id" element={staffPage ? <CreatorDetailPage /> : <Navigate to={`${prefix}/`} replace />} />
          {/* Pages that moved into the client hub. The old address goes to the same page for the
              client in ?client= / ?brand= or the switcher, or to the client list. */}
          {CLIENT_SCOPED_LEGACY.map((r) => (
            <Route key={r.from} path={r.from} element={staffPage ? <ClientScopedRedirect from={r.from} /> : <Navigate to={`${prefix}/`} replace />} />
          ))}
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/user-settings" element={<Navigate to={`${prefix}/settings`} replace />} />
          {/* A client login keeps its board here. Staff see it as the Work tab of the client. */}
          <Route path="/pipeline" element={staffPage ? <ClientScopedRedirect from={STAFF_PIPELINE_LEGACY.from} /> : <ContentPipelinePage />} />
          {/* Vault pages that are not tabs. The tabs are under /creative; item and board
              detail pages keep their addresses. */}
          <Route path="/ad-library/boards/:id" element={effectiveClient ? <Navigate to={`${prefix}/`} replace /> : <BoardDetailPage />} />
          <Route path="/ad-library/:id" element={effectiveClient ? <Navigate to={`${prefix}/`} replace /> : <VaultItemDetailPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </AppLayout>
      </DateRangeProvider>
    </AccountProvider>
  );
}

const App = () => {
  const clientPreview = useClientPreviewMode();

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ClearCacheOnUserChange />
          <ClientPreviewContext.Provider value={clientPreview}>
            <TooltipProvider>
              <Sonner />
              <ErrorBoundary>
              <BrowserRouter>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/reset-password" element={<ResetPasswordPage />} />
                  <Route path="/update-password" element={<UpdatePasswordPage />} />
                  <Route path="/public/reports/:id" element={
                    <Suspense fallback={<PageFallback />}>
                      <PublicReportPage />
                    </Suspense>
                  } />
                  <Route path="/briefs/share/:token" element={
                    <Suspense fallback={<PageFallback />}>
                      <PublicBriefPage />
                    </Suspense>
                  } />
                  <Route path="/shared/ad-board/:shareToken" element={
                    <Suspense fallback={<PageFallback />}>
                      <SharedAdBoardPage />
                    </Suspense>
                  } />
                  <Route path="/vault/share/:token" element={
                    <Suspense fallback={<PageFallback />}>
                      <PublicVaultItemPage />
                    </Suspense>
                  } />
                  <Route path="/approve/:token" element={
                    <Suspense fallback={<PageFallback />}>
                      <PublicBoardPage type="approval" />
                    </Suspense>
                  } />
                  <Route path="/cast/:token" element={
                    <Suspense fallback={<PageFallback />}>
                      <PublicBoardPage type="casting" />
                    </Suspense>
                  } />
                  <Route path="/locations-board/:token" element={
                    <Suspense fallback={<PageFallback />}>
                      <PublicLocationBoardPage />
                    </Suspense>
                  } />
                  <Route path="/call-sheet/:token" element={
                    <Suspense fallback={<PageFallback />}>
                      <PublicCallSheetPage />
                    </Suspense>
                  } />
                  <Route path="/creatorapply" element={
                    <Suspense fallback={<PageFallback />}>
                      <PublicApplyPage kind="creator" />
                    </Suspense>
                  } />
                  <Route path="/actorapply" element={
                    <Suspense fallback={<PageFallback />}>
                      <PublicApplyPage kind="actor" />
                    </Suspense>
                  } />
                  <Route path="/apply" element={<Navigate to="/creatorapply" replace />} />
                  <Route path="/bookmarklet-receiver" element={
                    <Suspense fallback={<PageFallback />}>
                      <BookmarkletReceiver />
                    </Suspense>
                  } />

                  {/* Phone capture — no role prefix: the OS opens these paths
                      verbatim from the manifest / a home-screen bookmark. */}
                  <Route path="/capture/share-target" element={
                    <Suspense fallback={<PageFallback />}>
                      <CaptureShareTarget />
                    </Suspense>
                  } />
                  {/* iOS has no share-target equivalent, so the iPhone path is
                      this page, opened from a home-screen icon (US-004). */}
                  <Route path="/capture/quick-add" element={
                    <Suspense fallback={<PageFallback />}>
                      <CaptureQuickAdd />
                    </Suspense>
                  } />

                  {/* Public legal pages — linked from the Meta App dashboard */}
                  <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
                  <Route path="/terms" element={<TermsPage />} />
                  <Route path="/data-deletion" element={<DataDeletionPage />} />

                  {/* Root → redirect to role prefix */}
                  <Route path="/" element={<RoleRedirect />} />
                  
                  {/* /editor/* → redirect to /builder/* */}
                  <Route path="/editor/*" element={<EditorRedirect />} />
                  
                  {/* Role-prefixed routes */}
                  <Route path="/:role/*" element={<RoleGuardedRoutes />} />
                </Routes>
              </BrowserRouter>
              </ErrorBoundary>
            </TooltipProvider>
          </ClientPreviewContext.Provider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
};

export default App;
