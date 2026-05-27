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
import { lazy, Suspense } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Critical pages — loaded eagerly (auth flow)
import LoginPage from "./pages/LoginPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import UpdatePasswordPage from "./pages/UpdatePasswordPage";

// Non-critical pages — lazy loaded for bundle splitting
const OverviewPage = lazy(() => import("./pages/OverviewPage"));
const CreativesPage = lazy(() => import("./pages/CreativesPage"));

const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage"));
const ComparePage = lazy(() => import("./pages/ComparePage"));
const TaggingPage = lazy(() => import("./pages/TaggingPage"));
const ReportsPage = lazy(() => import("./pages/ReportsPage"));
const ClientReportsPage = lazy(() => import("./pages/ClientReportsPage"));
const ReportDetailPage = lazy(() => import("./pages/ReportDetailPage"));
const ReportBuilderPage = lazy(() => import("./pages/ReportBuilderPage"));
const PublicReportPage = lazy(() => import("./pages/PublicReportPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

const BriefsPage = lazy(() => import("./pages/BriefsPage"));
const PublicBriefPage = lazy(() => import("./pages/PublicBriefPage"));
const AgencyDashboardPage = lazy(() => import("./pages/AgencyDashboardPage"));
const ContentPipelinePage = lazy(() => import("./pages/ContentPipelinePage"));
// Old Ad Library is replaced by the Creative Vault Library page (US-006).
// The old page lives at features/ad-library/AdLibraryPage.tsx and is no longer routed.
const AdLibraryPage = lazy(() => import("./features/vault/LibraryPage"));
const VaultItemDetailPage = lazy(() => import("./features/vault/ItemDetailPage"));
const SharedAdBoardPage = lazy(() => import("./pages/SharedAdBoardPage"));
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
  const prefix = useRolePrefix();
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
function RoleGuardedRoutes() {
  const { role: urlRole } = useParams<{ role: string }>();
  const prefix = useRolePrefix();
  const location = useLocation();
  const { user, isLoading, isClient, isBuilder } = useAuth();
  const { isClientPreview } = useClientPreview();
  const effectiveClient = isClient || isClientPreview;

  const agencyHome = isBuilder && localStorage.getItem("verdanote_agency_default_home") === "true";

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
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={agencyHome ? <AgencyDashboardPage /> : <OverviewPage />} />
          <Route path="/agency" element={isBuilder ? <AgencyDashboardPage /> : <Navigate to={`${prefix}/`} replace />} />
          <Route path="/creatives" element={<CreativesPage />} />
          <Route path="/creatives/compare" element={<ComparePage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/tagging" element={effectiveClient ? <Navigate to={`${prefix}/`} replace /> : <TaggingPage />} />
          
          <Route path="/reports" element={effectiveClient ? <ClientReportsPage /> : <ReportsPage />} />
          <Route path="/reports/:id" element={<ReportDetailPage />} />
          <Route path="/reports/:id/build" element={<ReportBuilderPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/user-settings" element={<Navigate to={`${prefix}/settings`} replace />} />
          
          <Route path="/briefs" element={effectiveClient ? <Navigate to={`${prefix}/`} replace /> : <BriefsPage />} />
          
          <Route path="/pipeline" element={<ContentPipelinePage />} />
          <Route path="/ad-library" element={effectiveClient ? <Navigate to={`${prefix}/`} replace /> : <AdLibraryPage />} />
          <Route path="/ad-library/:id" element={effectiveClient ? <Navigate to={`${prefix}/`} replace /> : <VaultItemDetailPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
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
