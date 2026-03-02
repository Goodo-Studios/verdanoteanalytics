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
import OverviewPage from "./pages/OverviewPage";
import ClientOverviewPage from "./pages/ClientOverviewPage";
import CreativesPage from "./pages/CreativesPage";
import ClientCreativesPage from "./pages/ClientCreativesPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import ComparePage from "./pages/ComparePage";
import TaggingPage from "./pages/TaggingPage";

import ReportsPage from "./pages/ReportsPage";
import ClientReportsPage from "./pages/ClientReportsPage";
import ReportDetailPage from "./pages/ReportDetailPage";
import ReportBuilderPage from "./pages/ReportBuilderPage";
import PublicReportPage from "./pages/PublicReportPage";

import SettingsPage from "./pages/SettingsPage";
import UserSettingsPage from "./pages/UserSettingsPage";
import SavedViewsPage from "./pages/SavedViewsPage";
import LoginPage from "./pages/LoginPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import UpdatePasswordPage from "./pages/UpdatePasswordPage";
import AIChatPage from "./pages/AIChatPage";

import BriefsPage from "./pages/BriefsPage";
import PublicBriefPage from "./pages/PublicBriefPage";

import AgencyDashboardPage from "./pages/AgencyDashboardPage";
import ContentPipelinePage from "./pages/ContentPipelinePage";

import NotFound from "./pages/NotFound";
import { Loader2 } from "lucide-react";
import { useClientPreview } from "@/hooks/useClientPreviewMode";

const queryClient = new QueryClient();

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
        <Route path="/settings" element={effectiveClient ? <Navigate to={`${prefix}/`} replace /> : <SettingsPage />} />
        <Route path="/user-settings" element={<UserSettingsPage />} />
        <Route path="/saved-views" element={effectiveClient ? <Navigate to={`${prefix}/`} replace /> : <SavedViewsPage />} />
        
        <Route path="/briefs" element={effectiveClient ? <Navigate to={`${prefix}/`} replace /> : <BriefsPage />} />
        
        <Route path="/pipeline" element={<ContentPipelinePage />} />
        <Route path="/ai-chat" element={<AIChatPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
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
              <BrowserRouter>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/reset-password" element={<ResetPasswordPage />} />
                  <Route path="/update-password" element={<UpdatePasswordPage />} />
                  <Route path="/public/reports/:id" element={<PublicReportPage />} />
                  <Route path="/briefs/share/:token" element={<PublicBriefPage />} />
                  
                  {/* Root → redirect to role prefix */}
                  <Route path="/" element={<RoleRedirect />} />
                  
                  {/* /editor/* → redirect to /builder/* */}
                  <Route path="/editor/*" element={<EditorRedirect />} />
                  
                  {/* Role-prefixed routes */}
                  <Route path="/:role/*" element={<RoleGuardedRoutes />} />
                </Routes>
              </BrowserRouter>
            </TooltipProvider>
          </ClientPreviewContext.Provider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
};

export default App;
