import { NavLink } from "@/components/NavLink";
import { HelpCircle } from "lucide-react";
import {
  Settings,
  LayoutGrid,
  BarChart3,
  FileText,
  Zap,
  LogOut,
  UserCog,
  Bookmark,
  Tags,
  Eye,
  Sparkles,
  Users,
  Share2,
  FlaskConical,
} from "lucide-react";
import verdanoteLogo from "@/assets/verdanote_logo.png";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccountContext } from "@/contexts/AccountContext";
import { useAuth } from "@/contexts/AuthContext";
import { useClientPreview } from "@/hooks/useClientPreviewMode";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const baseNavItems = [
  { title: "Overview", url: "/", icon: LayoutGrid },
  { title: "Creatives", url: "/creatives", icon: Zap },
  { title: "Creators", url: "/creators", icon: Users },
  { title: "Tests", url: "/tests", icon: FlaskConical },
  { title: "Whitelisting", url: "/whitelisting", icon: Share2 },
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
  { title: "Tagging", url: "/tagging", icon: Tags },
  { title: "Reports", url: "/reports", icon: FileText },
  { title: "Saved Views", url: "/saved-views", icon: Bookmark },
  { title: "AI Analyst", url: "/ai-chat", icon: Sparkles },
];

const clientNavItems = [
  { title: "Overview", url: "/", icon: LayoutGrid },
  { title: "Creatives", url: "/creatives", icon: Zap },
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
  { title: "Reports", url: "/reports", icon: FileText },
  { title: "AI Analyst", url: "/ai-chat", icon: Sparkles },
];

const editorNavItems = [
  { title: "Overview", url: "/", icon: LayoutGrid },
  { title: "Creatives", url: "/creatives", icon: Zap },
  { title: "Reports", url: "/reports", icon: FileText },
  { title: "AI Analyst", url: "/ai-chat", icon: Sparkles },
];

export function AppSidebar({ onNavigate, onTakeTour }: { onNavigate?: () => void; onTakeTour?: () => void }) {
  const { accounts, selectedAccountId, setSelectedAccountId, isLoading } = useAccountContext();
  const { role, isClient, isBuilder, isEmployee, isEditor, user, signOut } = useAuth();
  const { isClientPreview, toggleClientPreview } = useClientPreview();

  const effectiveClient = isClient || isClientPreview;

  const showSwitcher = !effectiveClient || accounts.length > 1;
  const showSettings = !effectiveClient && !isEditor;
  const navItems = effectiveClient
    ? clientNavItems
    : isEditor
    ? editorNavItems
    : baseNavItems;

  const roleBadgeClass = role === "client"
    ? "font-label text-[9px] uppercase tracking-[0.1em] font-semibold bg-gold-light text-[#92730F] capitalize h-4 px-1.5 border-0"
    : role === "editor"
    ? "font-label text-[9px] uppercase tracking-[0.1em] font-semibold bg-blue-50 text-blue-600 capitalize h-4 px-1.5 border-0"
    : "font-label text-[9px] uppercase tracking-[0.1em] text-sage capitalize h-4 px-1.5 border-border/50";

  return (
    <aside className="flex h-screen w-56 flex-col bg-background border-r border-input">
      {/* Logo */}
      <div className="flex items-center px-5 py-5 border-b border-input">
        <img src={verdanoteLogo} alt="Verdanote" className="h-7" />
      </div>

      {/* Role badge + Account Switcher */}
      <div className="px-3 pt-4 pb-2 space-y-2">
        <div className="flex items-center justify-between px-2">
          <p className="font-label text-[9px] uppercase tracking-[0.1em] text-sage">Account</p>
          {(!effectiveClient || isEditor) && (
            <Badge variant="outline" className={roleBadgeClass}>{role}</Badge>
          )}
        </div>
        {showSwitcher && accounts.length > 0 && (
          <Select value={selectedAccountId || ""} onValueChange={setSelectedAccountId}>
            <SelectTrigger className="w-full h-9 font-body text-[13px] font-medium text-charcoal border border-input bg-background rounded-md [&>svg]:text-sage">
              <SelectValue placeholder="Select account" />
            </SelectTrigger>
            <SelectContent className="bg-white border border-border-light rounded-[8px] shadow-modal">
              {!effectiveClient && !isEditor && <SelectItem value="all" className="font-body text-[13px] font-normal text-charcoal py-2 px-4 focus:bg-cream-dark data-[state=checked]:bg-sage-light data-[state=checked]:text-forest data-[state=checked]:font-medium [&>span:first-child]:text-verdant">All Accounts</SelectItem>}
              {[...accounts].sort((a: any, b: any) => a.name.localeCompare(b.name)).map((acc: any) => (
                <SelectItem key={acc.id} value={acc.id} className="font-body text-[13px] font-normal text-charcoal py-2 px-4 focus:bg-cream-dark data-[state=checked]:bg-sage-light data-[state=checked]:text-forest data-[state=checked]:font-medium [&>span:first-child]:text-verdant">
                  {acc.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {effectiveClient && !isEditor && accounts.length === 1 && (
          <p className="font-body text-[13px] font-medium text-charcoal px-2 truncate">{accounts[0].name}</p>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.url}
            to={item.url}
            end={item.url === "/"}
            className="flex items-center gap-3 rounded-md px-3 py-2.5 font-body text-[14px] font-medium text-slate transition-[background-color,color,border-color] duration-150 ease hover:text-forest hover:bg-accent"
            activeClassName="!font-semibold !text-forest bg-sage-light border-l-[3px] border-verdant"
            onClick={onNavigate}
          >
            <item.icon className="h-4 w-4 flex-shrink-0" />
            {item.title}
          </NavLink>
        ))}
        {showSettings && (
          <NavLink
            to="/settings"
            className="flex items-center gap-3 rounded-md px-3 py-2.5 font-body text-[14px] font-medium text-slate transition-[background-color,color,border-color] duration-150 ease hover:text-forest hover:bg-accent"
            activeClassName="!font-semibold !text-forest bg-sage-light border-l-[3px] border-verdant"
            onClick={onNavigate}
          >
            <Settings className="h-4 w-4 flex-shrink-0" />
            Settings
          </NavLink>
        )}
      </nav>

      {/* Footer */}
      <div className="mx-5 border-t border-input" />
      {!effectiveClient && !isEditor && (
        <div className="px-3 pt-3 pb-1">
          <NavLink
            to="/user-settings"
            className="flex items-center gap-3 rounded-md px-3 py-2 font-body text-[13px] text-slate transition-[background-color,color,border-color] duration-150 ease hover:text-forest hover:bg-accent"
            activeClassName="!font-semibold !text-forest bg-sage-light border-l-[3px] border-verdant"
            onClick={onNavigate}
          >
            <UserCog className="h-4 w-4 flex-shrink-0" />
            User Settings
          </NavLink>
        </div>
      )}
      {/* Client Preview toggle for builders */}
      {(isBuilder || isEmployee) && !isClient && !isEditor && (
        <div className="px-3 pb-1">
          <button
            onClick={toggleClientPreview}
            className={`flex items-center gap-3 rounded-md px-3 py-2 font-body text-[13px] w-full text-left transition-hover ${isClientPreview ? "text-[#92730F] bg-gold-light/50 font-medium" : "text-slate hover:text-forest hover:bg-accent"}`}
          >
            <Eye className="h-4 w-4 flex-shrink-0" />
            {isClientPreview ? "Exit Client View" : "Preview as Client"}
          </button>
        </div>
      )}
      <div className="px-5 pb-2 pt-1 flex items-center justify-between">
        <div className="min-w-0">
          <p className="font-body text-[11px] text-sage truncate">{user?.email}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 rounded-md text-muted-foreground hover:text-foreground"
          onClick={signOut}
          title="Sign out"
        >
          <LogOut className="h-3.5 w-3.5" />
        </Button>
      </div>
      {onTakeTour && (
        <div className="px-3 pb-4">
          <button
            onClick={onTakeTour}
            className="flex items-center gap-3 rounded-md px-3 py-2 font-body text-[12px] text-sage hover:text-forest hover:bg-accent w-full text-left transition-colors"
          >
            <HelpCircle className="h-3.5 w-3.5 flex-shrink-0" />
            Take the tour
          </button>
        </div>
      )}
    </aside>
  );
}
