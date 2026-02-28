import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import EditorOverviewPage from "./pages/EditorOverviewPage";
import { AccountProvider } from "@/contexts/AccountContext";
import { ClientPreviewContext, useClientPreviewMode } from "@/hooks/useClientPreviewMode";
import { ClientPreviewBanner } from "@/components/ClientPreviewBanner";
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

import NotFound from "./pages/NotFound";
import { Loader2 } from "lucide-react";
import { useClientPreview } from "@/hooks/useClientPreviewMode";

const queryClient = new QueryClient();

function ProtectedRoutes() {
  const { user, isLoading, isClient, isEditor, isBuilder } = useAuth();
  const { isClientPreview } = useClientPreview();
  const effectiveClient = isClient || isClientPreview;

  // Check if builder prefers agency dashboard as home
  const agencyHome = isBuilder && localStorage.getItem("verdanote_agency_default_home") === "true";

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return (
    <AccountProvider>
      <ClientPreviewBanner />
      <Routes>
        <Route path="/" element={isEditor ? <EditorOverviewPage /> : agencyHome ? <AgencyDashboardPage /> : <OverviewPage />} />
        <Route path="/agency" element={isBuilder ? <AgencyDashboardPage /> : <Navigate to="/" replace />} />
        <Route path="/creatives" element={isEditor ? <ClientCreativesPage /> : <CreativesPage />} />
        <Route path="/creatives/compare" element={isEditor ? <Navigate to="/" replace /> : <ComparePage />} />
        <Route path="/analytics" element={isEditor ? <Navigate to="/" replace /> : <AnalyticsPage />} />
        <Route path="/tagging" element={(effectiveClient || isEditor) ? <Navigate to="/" replace /> : <TaggingPage />} />
        
        <Route path="/reports" element={effectiveClient ? <ClientReportsPage /> : isEditor ? <ClientReportsPage /> : <ReportsPage />} />
        <Route path="/reports/:id" element={<ReportDetailPage />} />
        <Route path="/reports/:id/build" element={<ReportBuilderPage />} />
        <Route path="/settings" element={(effectiveClient || isEditor) ? <Navigate to="/" replace /> : <SettingsPage />} />
        <Route path="/user-settings" element={<UserSettingsPage />} />
        <Route path="/saved-views" element={(effectiveClient || isEditor) ? <Navigate to="/" replace /> : <SavedViewsPage />} />
        
        <Route path="/briefs" element={(effectiveClient || isEditor) ? <Navigate to="/" replace /> : <BriefsPage />} />
        
        
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
                  
                  
                  <Route path="/*" element={<ProtectedRoutes />} />
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
