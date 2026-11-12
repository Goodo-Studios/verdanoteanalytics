import { ReactNode, useState } from "react";
import { useLocation } from "react-router-dom";
import { showsClientPicker } from "@/lib/sections";
import { AppSidebar } from "@/components/AppSidebar";
import { PresenceAvatars } from "@/components/PresenceAvatars";
import { ClientSwitcher } from "@/components/ClientSwitcher";
import { CommandPaletteHost } from "@/components/CommandPaletteHost";
import { ClientSelectionProvider } from "@/contexts/ClientSelectionProvider";
import { useAuth } from "@/contexts/AuthContext";
import { useClientPreview } from "@/hooks/useClientPreviewMode";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { GoodoOsMark } from "@/components/GoodoOsMark";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isClient } = useAuth();
  const { isClientPreview } = useClientPreview();
  const { pathname } = useLocation();
  // Staff pick a client in one switcher at the top, only on pages that filter by client
  // (OS-004: client pages, Creative, and tabs marked usesClient). A client login has none.
  const showSwitcher = !isClient && !isClientPreview && showsClientPicker(pathname);

  return (
    <ClientSelectionProvider>
    <div className="flex min-h-screen w-full">{/* transparent so the page grid shows (OS-005) */}
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
        <AppSidebar onNavigate={() => setMobileOpen(false)} />
      </div>

      {/* Main content */}
      <main id="app-scroll-container" className="flex-1 overflow-auto min-w-0 md:ml-56">
        {/* Header bar */}
        <div className="sticky top-0 z-30 flex items-center justify-between px-4 py-3 border-b border-border bg-sidebar/90 backdrop-blur">
          <div className="flex items-center gap-3 md:hidden">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              aria-expanded={mobileOpen}
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </Button>
            <GoodoOsMark size="sm" />
          </div>
          {/* Client switcher (staff) */}
          <div className="min-w-0 flex-1 px-2">{showSwitcher ? <ClientSwitcher /> : null}</div>
          <div className="flex items-center gap-2">
            <CommandPaletteHost />
            <PresenceAvatars />
          </div>
        </div>
        <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
          {children}
        </div>
      </main>
    </div>
    </ClientSelectionProvider>
  );
}
