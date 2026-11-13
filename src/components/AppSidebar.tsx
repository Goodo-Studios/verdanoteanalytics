import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import {
  Settings,
  LayoutGrid,
  BarChart3,
  FileText,
  Zap,
  LogOut,
  Eye,
  ListChecks,
  ExternalLink,
  House,
  Building2,
  Clapperboard,
  Contact,
  Palette,
  BookOpen,
  ShieldCheck,
  Wrench,
  CheckCircle2,
  Download,
} from "lucide-react";
import { ATTIO_URL, GOODO_TIME_URL } from "@/lib/staffMenu";
import { STAFF_NAV, type StaffNavId } from "@/lib/sections";
import { GoodoOsMark } from "@/components/GoodoOsMark";
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
import { prefetchRoute } from "@/lib/routePrefetch";

export type NavItem = {
  title: string;
  url: string;
  icon: typeof LayoutGrid;
};

const STAFF_ICONS: Record<StaffNavId, typeof LayoutGrid> = {
  home: House,
  clients: Building2,
  production: Clapperboard,
  talent: Contact,
  creative: Palette,
  knowledge: BookOpen,
  tools: Wrench,
  admin: ShieldCheck,
};

/**
 * Staff menu: eight items. Production, Talent, Creative, Knowledge, Tools and Admin are pages with
 * tabs (see src/lib/sections.ts). Admin shows for builders and employees; the tabs inside it
 * that are builder only stay hidden from employees.
 */
export const staffNavItems: NavItem[] = STAFF_NAV.map((entry) => ({
  title: entry.label,
  url: entry.url,
  icon: STAFF_ICONS[entry.id],
}));

// Client surface: clients get the core analytics tabs — Overview, Creatives,
// Analytics — alongside their Content Pipeline + Reports. Overview routes to the
// same OverviewPage builders see (the purpose-built ClientHomePage is retired).
// Deeper strategist surfaces (Tagging, Briefs, Vault) stay
// client-gated — see route guards in App.tsx.
//
// OS-019: Overview is the client home (it leads with the one item that needs the client). Briefs,
// Review and Assets replace the three ClickUp client views. "Briefs" here is the client page at
// /brief-review; the strategist Briefs page at /briefs stays staff only.
export const clientNavItems: NavItem[] = [
  { title: "Overview", url: "/", icon: LayoutGrid },
  { title: "Briefs", url: "/brief-review", icon: BookOpen },
  { title: "Review", url: "/review", icon: CheckCircle2 },
  { title: "Assets", url: "/assets", icon: Download },
  { title: "Creatives", url: "/creatives", icon: Zap },
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
  { title: "Content Pipeline", url: "/pipeline", icon: ListChecks },
  { title: "Reports", url: "/reports", icon: FileText },
];

const ITEM_CLASS =
  "flex items-center gap-3 rounded-md px-3 py-2.5 font-body text-[14px] font-medium text-slate transition-[background-color,color,border-color] duration-150 ease hover:text-forest hover:bg-accent";
const ACTIVE_CLASS = "!font-semibold !text-forest bg-sage-light border-l-[3px] border-verdant";
const SELECT_ITEM_CLASS =
  "font-body text-[13px] font-normal text-charcoal py-2 px-4 focus:bg-cream-dark data-[state=checked]:bg-sage-light data-[state=checked]:text-forest data-[state=checked]:font-medium [&>span:first-child]:text-verdant";

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { accounts, selectedAccountId, setSelectedAccountId } = useAccountContext();
  const { role, isClient, isBuilder, signOut } = useAuth();
  const { isClientPreview, isEmployeePreview, previewRole, setPreviewRole } = useClientPreview();
  const navigate = useNavigate();
  const prefix = useRolePrefix();

  const effectiveClient = isClient || isClientPreview;
  const effectiveEmployee = isEmployeePreview;

  // Client view only: a client with several accounts picks one here. Staff pick a client in
  // the switcher at the top of the app instead.
  const showAccountSelect = effectiveClient && accounts.length > 1;

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

  // Work is a tab under Home, so Home stays lit on it.
  const onWork = /^\/(builder|employee)\/work\/?$/.test(useLocation().pathname);
  const navItems = useMemo<NavItem[]>(() => (effectiveClient ? clientNavItems : staffNavItems), [effectiveClient]);

  return (
    <aside className="flex h-screen w-56 flex-col bg-sidebar border-r border-border">
      {/* Name mark */}
      <div className="flex items-center px-5 py-5 border-b border-border">
        <GoodoOsMark />
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
                    : "text-muted-foreground hover:text-foreground cursor-pointer"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-3" aria-label="Main">
        {effectiveClient && (
          <div className="space-y-1.5 pb-1">
            {showAccountSelect && (
              <Select value={selectedAccountId || ""} onValueChange={(v) => setSelectedAccountId(v)}>
                <SelectTrigger className="w-full h-9 font-body text-[13px] font-medium text-charcoal border border-input bg-background rounded-md [&>svg]:text-sage">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent className="bg-white border border-border-light rounded-[8px] shadow-modal">
                  {[...accounts].sort((a, b) => a.name.localeCompare(b.name)).map((acc) => (
                    <SelectItem key={acc.id} value={acc.id} className={SELECT_ITEM_CLASS}>
                      {acc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {accounts.length === 1 && (
              <p className="font-body text-[13px] font-medium text-charcoal px-2 truncate">{accounts[0].name}</p>
            )}
          </div>
        )}
        <div className="space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.url}
              to={`${prefix}${item.url}`}
              end={item.url === "/"}
              className={item.url === "/" && !effectiveClient && onWork ? `${ITEM_CLASS} ${ACTIVE_CLASS}` : ITEM_CLASS}
              activeClassName={ACTIVE_CLASS}
              onClick={onNavigate}
              onMouseEnter={() => prefetchRoute(item.url)}
              onFocus={() => prefetchRoute(item.url)}
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {item.title}
            </NavLink>
          ))}
        </div>
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
      {/* Other apps (staff only), Settings and sign out */}
      <div className="px-3 pb-4 pt-1">
        {!effectiveClient && (
          <div className="pb-1">
            {[
              { title: "Goodo Time", href: GOODO_TIME_URL },
              { title: "Attio", href: ATTIO_URL },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-md px-3 py-2 font-body text-[13px] font-medium text-slate hover:text-forest hover:bg-accent"
              >
                <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
                {link.title}
              </a>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between">
          <NavLink
            to={`${prefix}/settings`}
            className={`${ITEM_CLASS} flex-1`}
            activeClassName={ACTIVE_CLASS}
            onClick={onNavigate}
            onMouseEnter={() => prefetchRoute("/settings")}
            onFocus={() => prefetchRoute("/settings")}
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
            aria-label="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
