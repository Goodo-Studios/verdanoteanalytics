import { ReactNode, useState, useCallback } from "react";
import { AppSidebar } from "@/components/AppSidebar";

import { NotificationCenter } from "@/components/NotificationCenter";
import { PresenceAvatars } from "@/components/PresenceAvatars";
import { CommandBar, CommandBarTrigger } from "@/components/CommandBar";
import { KeyboardShortcutsModal } from "@/components/KeyboardShortcutsModal";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useTheme } from "@/contexts/ThemeContext";
import { useAccountContext } from "@/contexts/AccountContext";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Menu, Sun, Moon, Keyboard } from "lucide-react";
import verdanoteLogo from "@/assets/verdanote_logo.png";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { accounts, selectedAccountId, setSelectedAccountId } = useAccountContext();

  const handleAccountPrev = useCallback(() => {
    if (!accounts.length) return;
    const idx = accounts.findIndex((a: any) => a.id === selectedAccountId);
    const prev = idx <= 0 ? accounts.length - 1 : idx - 1;
    setSelectedAccountId(accounts[prev].id);
  }, [accounts, selectedAccountId, setSelectedAccountId]);

  const handleAccountNext = useCallback(() => {
    if (!accounts.length) return;
    const idx = accounts.findIndex((a: any) => a.id === selectedAccountId);
    const next = idx >= accounts.length - 1 ? 0 : idx + 1;
    setSelectedAccountId(accounts[next].id);
  }, [accounts, selectedAccountId, setSelectedAccountId]);

  useKeyboardShortcuts({
    onOpenShortcutsModal: () => setShortcutsOpen(true),
    onAccountPrev: handleAccountPrev,
    onAccountNext: handleAccountNext,
  });

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
        <AppSidebar onNavigate={() => setMobileOpen(false)} />
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
          <div className="flex items-center gap-2">
            <PresenceAvatars />
            <CommandBarTrigger />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setShortcutsOpen(true)}
                  aria-label="Keyboard shortcuts"
                >
                  <Keyboard className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Shortcuts <kbd className="ml-1 text-[10px] font-mono bg-muted px-1 rounded">?</kbd>
              </TooltipContent>
            </Tooltip>
            <NotificationCenter />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={toggleTheme}
              aria-label="Toggle theme"
            >
              {theme === "light" ? (
                <Moon className="h-4 w-4 transition-transform duration-200 rotate-0" />
              ) : (
                <Sun className="h-4 w-4 transition-transform duration-200 rotate-180" />
              )}
            </Button>
          </div>
        </div>
        <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
          {children}
        </div>
      </main>
      
      <CommandBar />
      <KeyboardShortcutsModal open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}
