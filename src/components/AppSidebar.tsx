
import { useNavigate, useLocation } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import {
  Settings,
  LayoutGrid,
  BarChart3,
  FileText,
  Zap,
  LogOut,
  Tags,
  Eye,
  ListChecks,
  Library,
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
import { useRolePrefix } from "@/hooks/useRolePath";
import { Button } from "@/components/ui/button";

const baseNavItems = [
  { title: "Overview", url: "/", icon: LayoutGrid },
  { title: "Creatives", url: "/creatives", icon: Zap },
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
  { title: "Tagging", url: "/tagging", icon: Tags },
  { title: "Reports", url: "/reports", icon: FileText },
  { title: "Ad Library", url: "/ad-library", icon: Library },
];

const clientNavItems = [
  { title: "Overview", url: "/", icon: LayoutGrid },
  { title: "Creatives", url: "/creatives", icon: Zap },
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
  { title: "Content Pipeline", url: "/pipeline", icon: ListChecks },
  { title: "Reports", url: "/reports", icon: FileText },
];

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { accounts, selectedAccountId, setSelectedAccountId, isLoading } = useAccountContext();
  const { role, isClient, isBuilder, isEmployee, user, signOut } = useAuth();
  const { isClientPreview, isEmployeePreview, previewRole, setPreviewRole } = useClientPreview();
  const navigate = useNavigate();
  const location = useLocation();
  const prefix = useRolePrefix();

  const isAgencyView = selectedAccountId === "all";
  const effectiveClient = isClient || isClientPreview;
  const effectiveEmployee = isEmployeePreview;

  const showSwitcher = !effectiveClient || accounts.length > 1;
  
  const agencyNavItems = [
    { title: "Overview", url: "/agency", icon: LayoutGrid },
  ];

  const navItems = isAgencyView
    ? agencyNavItems
    : effectiveClient
    ? clientNavItems
    : baseNavItems;

  const handleAccountChange = (value: string) => {
    setSelectedAccountId(value);
    if (value === "all") {
      navigate(`${prefix}/agency`);
    } else if (location.pathname.includes("/agency")) {
      navigate(`${prefix}/`);
    }
  };

  const effectiveRole = effectiveClient ? "client" : effectiveEmployee ? "employee" : role;

  const handleRoleClick = (r: "builder" | "employee" | "client") => {
    if (!isBuilder) return; // Only builders can switch
    if (r === role) {
      // Clicking own role exits preview
      setPreviewRole(null);
    } else if (r === "client") {
      setPreviewRole("client");
    } else if (r === "employee") {
      setPreviewRole("employee");
    } else {
      setPreviewRole(null);
    }
    // Navigate to root of new role view
    const newPrefix = r === "client" ? "/client" : r === "employee" ? "/employee" : "/builder";
    navigate(`${newPrefix}/`);
  };

  return (
    <aside className="flex h-screen w-56 flex-col bg-background border-r border-input">
      {/* Logo */}
      <div className="flex items-center px-5 py-5 border-b border-input">
        <img src={verdanoteLogo} alt="Verdanote" className="h-7" />
      </div>

      {/* Role indicator - only builders can see/switch roles */}
      {isBuilder && (
        <div className="px-3 pt-4 pb-1">
          <div className="flex items-center rounded-md bg-muted/50 p-0.5">
            {(["builder", "employee", "client"] as const).map((r) => (
              <button
                key={r}
                onClick={() => handleRoleClick(r)}
                className={`flex-1 text-center py-1.5 rounded-[5px] font-label text-[9px] uppercase tracking-[0.1em] font-semibold transition-colors ${
                  effectiveRole === r
                    ? "bg-background text-forest shadow-sm"
                    : "text-sage/50 hover:text-sage cursor-pointer"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Account Switcher */}
      <div className="px-3 pt-2 pb-2 space-y-1.5">
        <p className="font-label text-[9px] uppercase tracking-[0.1em] text-sage px-2">Account</p>
        {showSwitcher && accounts.length > 0 && (
          <Select value={selectedAccountId || ""} onValueChange={handleAccountChange}>
            <SelectTrigger className="w-full h-9 font-body text-[13px] font-medium text-charcoal border border-input bg-background rounded-md [&>svg]:text-sage">
              <SelectValue placeholder="Select account" />
            </SelectTrigger>
            <SelectContent className="bg-white border border-border-light rounded-[8px] shadow-modal">
              {isBuilder && !effectiveClient && <SelectItem value="all" className="font-body text-[13px] font-normal text-charcoal py-2 px-4 focus:bg-cream-dark data-[state=checked]:bg-sage-light data-[state=checked]:text-forest data-[state=checked]:font-medium [&>span:first-child]:text-verdant">Agency View</SelectItem>}
              {[...accounts].sort((a, b) => a.name.localeCompare(b.name)).map((acc) => (
                <SelectItem key={acc.id} value={acc.id} className="font-body text-[13px] font-normal text-charcoal py-2 px-4 focus:bg-cream-dark data-[state=checked]:bg-sage-light data-[state=checked]:text-forest data-[state=checked]:font-medium [&>span:first-child]:text-verdant">
                  {acc.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {effectiveClient && accounts.length === 1 && (
          <p className="font-body text-[13px] font-medium text-charcoal px-2 truncate">{accounts[0].name}</p>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.url}
            to={`${prefix}${item.url}`}
            end={item.url === "/"}
            className="flex items-center gap-3 rounded-md px-3 py-2.5 font-body text-[14px] font-medium text-slate transition-[background-color,color,border-color] duration-150 ease hover:text-forest hover:bg-accent"
            activeClassName="!font-semibold !text-forest bg-sage-light border-l-[3px] border-verdant"
            onClick={onNavigate}
          >
            <item.icon className="h-4 w-4 flex-shrink-0" />
            {item.title}
          </NavLink>
        ))}
      </nav>

      <div className="mx-3 border-t border-input" />
      {/* Preview mode indicator for builders */}
      {isBuilder && previewRole && (
        <div className="px-3 py-1">
          <button
            onClick={() => { setPreviewRole(null); navigate(`/builder/`); }}
            className="flex items-center gap-3 rounded-md px-3 py-2 font-body text-[13px] w-full text-left text-[#92730F] bg-gold-light/50 font-medium transition-hover"
          >
            <Eye className="h-4 w-4 flex-shrink-0" />
            Exit {previewRole === "client" ? "Client" : "Employee"} View
          </button>
        </div>
      )}
      {/* Settings + logout */}
      <div className="px-3 pb-4 pt-1">
        <div className="flex items-center justify-between">
          <NavLink
            to={`${prefix}/settings`}
            className="flex items-center gap-3 rounded-md px-3 py-2.5 font-body text-[14px] font-medium text-slate transition-[background-color,color,border-color] duration-150 ease hover:text-forest hover:bg-accent flex-1"
            activeClassName="!font-semibold !text-forest bg-sage-light border-l-[3px] border-verdant"
            onClick={onNavigate}
          >
            <Settings className="h-4 w-4 flex-shrink-0" />
            Settings
          </NavLink>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 rounded-md text-muted-foreground hover:text-foreground flex-shrink-0"
            onClick={signOut}
            title="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
