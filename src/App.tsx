import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AccountProvider } from "@/contexts/AccountContext";
import { ClientPreviewContext, useClientPreviewMode } from "@/hooks/useClientPreviewMode";
import { ClientPreviewBanner } from "@/components/ClientPreviewBanner";
import { useRolePrefix } from "@/hooks/useRolePath";
import { Loader2 } from "lucide-react";
import { useClientPreview } from "@/hooks/useClientPreviewMode";
import { lazy, Suspense, useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppLayout } from "@/components/AppLayout";
import { PageSkeleton } from "@/components/skeletons/PageSkeleton";
import { routeImports } from "@/lib/routePrefetch";

// Critical pages — loaded eagerly (auth flow)
import LoginPage from "./pages/LoginPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import UpdatePasswordPage from "./pages/UpdatePasswordPage";

// Non-critical pages — lazy loaded for bundle splitting. The shell pages share
// their import thunks with the hover-prefetch registry (src/lib/routePrefetch)
// so a hovered tab and its eventual mount resolve to one fetch.
const OverviewPage = lazy(routeImports.overview);
const CreativesPage = lazy(routeImports.creatives);

const AnalyticsPage = lazy(routeImports.analytics);
const ComparePage = lazy(routeImports.compare);
const TaggingPage = lazy(routeImports.tagging);
const ReportsPage = lazy(routeImports.reports);
const EntityReportPage = lazy(routeImports.entityReport);
const ClientReportsPage = lazy(routeImports.clientReports);
const ReportDetailPage = lazy(routeImports.reportDetail);
const ReportBuilderPage = lazy(routeImports.reportBuilder);
const CreativeRotationPage = lazy(routeImports.creativeRotation);
const PublicReportPage = lazy(() => import("./pages/PublicReportPage"));
const SettingsPage = lazy(routeImports.settings);
const LandingPagesPage = lazy(routeImports.landingPages);

const BriefsPage = lazy(routeImports.briefs);
const PublicBriefPage = lazy(() => import("./pages/PublicBriefPage"));
const AgencyDashboardPage = lazy(routeImports.agencyDashboard);
const ContentPipelinePage = lazy(routeImports.contentPipeline);
// Old Ad Library is replaced by the Creative Vault Library page (US-006).
// The old page lives at features/ad-library/AdLibraryPage.tsx and is no longer routed.
const CreativeLibraryPage = lazy(routeImports.creativeLibrary);
const AdLibraryPage = lazy(routeImports.adLibrary);
const VaultItemDetailPage = lazy(routeImports.vaultItemDetail);
const BoardsPage = lazy(routeImports.boards);
const BoardDetailPage = lazy(routeImports.boardDetail);
const HooksPage = lazy(routeImports.hooks);

const SharedAdBoardPage = lazy(() => import("./pages/SharedAdBoardPage"));
const PublicVaultItemPage = lazy(() => import("./pages/PublicVaultItemPage"));
const BookmarkletReceiver = lazy(() => import("./pages/BookmarkletReceiver"));
const NotFound = lazy(() => import("./pages/NotFound"));

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
  const { user, isLoading, isClient, isBuilder } = useAuth();
  const { isClientPreview } = useClientPreview();
  const effectiveClient = isClient || isClientPreview;

  const [agencyHomeFlag] = useState(() => localStorage.getItem("verdanote_agency_default_home") === "true");
  const agencyHome = isBuilder && agencyHomeFlag;

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
      <ClientPreviewBanner />
      <AppLayout>
        <Suspense fallback={<PageSkeleton />}>
        <Routes>
          <Route path="/" element={agencyHome ? <AgencyDashboardPage /> : <OverviewPage />} />
          <Route path="/agency" element={isBuilder ? <AgencyDashboardPage /> : <Navigate to={`${prefix}/`} replace />} />
          <Route path="/creatives" element={<CreativesPage />} />
          <Route path="/creatives/compare" element={<ComparePage />} />
          {/* Creative Library (Feature 4 + F3 + F6). Builder/employee only; the
              page itself gates to the builder account for the dogfood rollout. */}
          <Route path="/creative-library" element={isBuilder ? <CreativeLibraryPage /> : <Navigate to={`${prefix}/`} replace />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/tagging" element={effectiveClient ? <Navigate to={`${prefix}/`} replace /> : <TaggingPage />} />
          
          <Route path="/landing-pages" element={isBuilder ? <LandingPagesPage /> : <Navigate to={`${prefix}/`} replace />} />
          <Route path="/reports" element={effectiveClient ? <ClientReportsPage /> : <ReportsPage />} />
          <Route path="/entities" element={isBuilder ? <EntityReportPage /> : <Navigate to={`${prefix}/`} replace />} />
          <Route path="/reports/:id" element={<ReportDetailPage />} />
          <Route path="/reports/:id/build" element={<ReportBuilderPage />} />
          <Route path="/creative-rotation" element={isBuilder ? <CreativeRotationPage /> : <Navigate to={`${prefix}/`} replace />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/user-settings" element={<Navigate to={`${prefix}/settings`} replace />} />
          
          <Route path="/briefs" element={effectiveClient ? <Navigate to={`${prefix}/`} replace /> : <BriefsPage />} />
          
          <Route path="/pipeline" element={<ContentPipelinePage />} />
          {/* Viral Feed was removed — redirect old bookmarks/links to the Ad Library.
              Bare (unprefixed) forms also land here via the role-mismatch redirect above.
              /ad-library/viral must precede /ad-library/:id or the :id route swallows it. */}
          <Route path="/viral-feed" element={<Navigate to={`${prefix}/ad-library`} replace />} />
          <Route path="/ad-library/viral" element={<Navigate to={`${prefix}/ad-library`} replace />} />
          <Route path="/ad-library" element={effectiveClient ? <Navigate to={`${prefix}/`} replace /> : <AdLibraryPage />} />
          <Route path="/ad-library/boards" element={effectiveClient ? <Navigate to={`${prefix}/`} replace /> : <BoardsPage />} />
          <Route path="/ad-library/boards/:id" element={effectiveClient ? <Navigate to={`${prefix}/`} replace /> : <BoardDetailPage />} />
          <Route path="/ad-library/hooks" element={effectiveClient ? <Navigate to={`${prefix}/`} replace /> : <HooksPage />} />
          <Route path="/ad-library/:id" element={effectiveClient ? <Navigate to={`${prefix}/`} replace /> : <VaultItemDetailPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </AppLayout>
    </AccountProvider>
  );
}

const App = () => {
  const clientPreview = useClientPreviewMode();

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
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
                  <Route path="/bookmarklet-receiver" element={
                    <Suspense fallback={<PageFallback />}>
                      <BookmarkletReceiver />
                    </Suspense>
                  } />
                  
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
