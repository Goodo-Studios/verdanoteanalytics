import { ReactNode, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { AIChatWidget } from "@/components/AIChatWidget";
import { NotificationCenter } from "@/components/NotificationCenter";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { useFirstLogin } from "@/hooks/useFirstLogin";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import verdanoteLogo from "@/assets/verdanote_logo.png";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { showOnboarding, openTour, closeTour } = useFirstLogin();

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`
          fixed inset-y-0 left-0 z-50 transition-transform duration-200 md:translate-x-0
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <AppSidebar onNavigate={() => setMobileOpen(false)} onTakeTour={openTour} />
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-auto min-w-0 md:ml-56">
        {/* Header bar */}
        <div className="sticky top-0 z-30 flex items-center justify-between px-4 py-3 border-b border-border/60 bg-background">
          <div className="flex items-center gap-3 md:hidden">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <img src={verdanoteLogo} alt="Verdanote" className="h-5" />
          </div>
          {/* Spacer for desktop */}
          <div className="hidden md:block" />
          <NotificationCenter />
        </div>
        <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
          {children}
        </div>
      </main>
      <AIChatWidget />

      {/* Onboarding wizard */}
      <OnboardingWizard open={showOnboarding} onClose={closeTour} />
    </div>
  );
}
