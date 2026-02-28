import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search, FileText, Users, FlaskConical, Layers, LayoutGrid, X,
  FileEdit, RefreshCw, CalendarDays, Link2, ArrowRightLeft,
  Clock, Zap, Command,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAccountContext } from "@/contexts/AccountContext";
import { useAuth } from "@/contexts/AuthContext";
import { gradeCreatives, type Grade } from "@/lib/creativeGrading";
import { GradeBadge } from "@/components/creatives/GradeBadge";
import { useSync } from "@/hooks/useSyncApi";
import { toast } from "sonner";

/* ── Types ─────────────────────────────────────────────── */

interface SearchResult {
  id: string;
  category: "creatives" | "reports" | "briefs" | "creators" | "tests";
  title: string;
  subtitle?: string;
  meta?: string;
  thumbnail?: string | null;
  grade?: Grade;
  roas?: number;
  navigateTo: string;
  searchParams?: Record<string, string>;
}

interface GroupedResults {
  category: string;
  label: string;
  icon: React.ReactNode;
  results: SearchResult[];
  total: number;
}

interface CommandItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  subtitle?: string;
  action: () => void;
  group: "recent" | "actions";
}

const CATEGORY_CONFIG = {
  creatives: { label: "Creatives", icon: <LayoutGrid className="h-3.5 w-3.5" /> },
  reports: { label: "Reports", icon: <FileText className="h-3.5 w-3.5" /> },
  briefs: { label: "Briefs", icon: <FileText className="h-3.5 w-3.5" /> },
  creators: { label: "Creators", icon: <Users className="h-3.5 w-3.5" /> },
  tests: { label: "Tests", icon: <FlaskConical className="h-3.5 w-3.5" /> },
};

/* ── Recent items persistence ──────────────────────────── */

const RECENTS_KEY = "verdanote_cmd_recents";
const MAX_RECENTS = 5;

interface RecentItem {
  id: string;
  label: string;
  category: string;
  navigateTo: string;
  timestamp: number;
}

function getRecents(): RecentItem[] {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
  } catch { return []; }
}

function addRecent(item: Omit<RecentItem, "timestamp">) {
  const recents = getRecents().filter(r => r.id !== item.id);
  recents.unshift({ ...item, timestamp: Date.now() });
  localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, MAX_RECENTS)));
}

/* ── Component ─────────────────────────────────────────── */

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<GroupedResults[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { selectedAccountId, accounts, setSelectedAccountId } = useAccountContext();
  const { isBuilder, isEmployee } = useAuth();
  const sync = useSync();
  const canEdit = isBuilder || isEmployee;

  const isSearchMode = debouncedQuery.length >= 2;

  // ── Cmd+K listener ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery("");
      setDebouncedQuery("");
      setResults([]);
      setActiveIndex(0);
    }
  }, [open]);

  // Debounce
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  // Search
  useEffect(() => {
    if (!isSearchMode) { setResults([]); return; }
    let cancelled = false;
    performSearch(debouncedQuery, selectedAccountId).then(res => {
      if (!cancelled) { setResults(res); setActiveIndex(0); setLoading(false); }
    });
    setLoading(true);
    return () => { cancelled = true; };
  }, [debouncedQuery, selectedAccountId, isSearchMode]);

  // ── Quick actions (default state) ──
  const quickActions = useMemo((): CommandItem[] => {
    if (!canEdit) return [];
    const items: CommandItem[] = [];

    items.push({
      id: "new-brief",
      label: "New Brief",
      icon: <FileEdit className="h-4 w-4" />,
      action: () => { setOpen(false); navigate("/briefs"); },
      group: "actions",
    });
    items.push({
      id: "new-report",
      label: "New Report",
      icon: <FileText className="h-4 w-4" />,
      action: () => { setOpen(false); navigate("/reports"); },
      group: "actions",
    });

    const currentAccountId = selectedAccountId && selectedAccountId !== "all" ? selectedAccountId : undefined;
    if (currentAccountId) {
      items.push({
        id: "trigger-sync",
        label: "Trigger Sync",
        subtitle: "Sync current account",
        icon: <RefreshCw className="h-4 w-4" />,
        action: () => { setOpen(false); sync.mutate({ account_id: currentAccountId }); },
        group: "actions",
      });
      items.push({
        id: "weekly-retro",
        label: "Generate Weekly Retro",
        icon: <CalendarDays className="h-4 w-4" />,
        action: () => { setOpen(false); navigate("/settings"); },
        group: "actions",
      });
      items.push({
        id: "copy-share-link",
        label: "Copy Share Link",
        subtitle: "Portfolio link for current account",
        icon: <Link2 className="h-4 w-4" />,
        action: () => {
          const acc = accounts.find((a: any) => a.id === currentAccountId);
          if (acc?.portfolio_slug) {
            navigator.clipboard.writeText(`${window.location.origin}/portfolio/${acc.portfolio_slug}`);
            toast.success("Portfolio link copied");
          } else {
            toast.info("No portfolio slug set for this account");
          }
          setOpen(false);
        },
        group: "actions",
      });
    }

    // Switch account
    if (accounts.length > 1 && currentAccountId) {
      const currentIdx = accounts.findIndex((a: any) => a.id === currentAccountId);
      const nextIdx = (currentIdx + 1) % accounts.length;
      const nextAcc = accounts[nextIdx];
      if (nextAcc) {
        items.push({
          id: "switch-account",
          label: `Switch to ${nextAcc.name}`,
          icon: <ArrowRightLeft className="h-4 w-4" />,
          action: () => { setOpen(false); setSelectedAccountId(nextAcc.id); toast.success(`Switched to ${nextAcc.name}`); },
          group: "actions",
        });
      }
    }

    return items;
  }, [canEdit, selectedAccountId, accounts, navigate, sync, setSelectedAccountId]);

  // ── Recent items ──
  const recentItems = useMemo((): CommandItem[] => {
    const recents = getRecents();
    return recents.map(r => ({
      id: `recent-${r.id}`,
      label: r.label,
      subtitle: r.category,
      icon: <Clock className="h-4 w-4 text-muted-foreground" />,
      action: () => { setOpen(false); navigate(r.navigateTo); },
      group: "recent" as const,
    }));
  }, [open, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Combined flat list for keyboard nav ──
  const flatSearchResults = useMemo(
    () => results.flatMap(g => g.results.slice(0, 3)),
    [results]
  );

  const defaultItems = useMemo(
    () => [...recentItems, ...quickActions],
    [recentItems, quickActions]
  );

  const totalItems = isSearchMode ? flatSearchResults.length : defaultItems.length;

  const handleSelectResult = useCallback((result: SearchResult) => {
    setOpen(false);
    addRecent({
      id: result.id,
      label: result.title,
      category: result.category,
      navigateTo: result.searchParams
        ? `${result.navigateTo}?${new URLSearchParams(result.searchParams).toString()}`
        : result.navigateTo,
    });
    if (result.searchParams) {
      navigate(`${result.navigateTo}?${new URLSearchParams(result.searchParams).toString()}`);
    } else {
      navigate(result.navigateTo);
    }
  }, [navigate]);

  // Keyboard nav
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); return; }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex(i => Math.min(i + 1, totalItems - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex(i => Math.max(i - 1, 0));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (isSearchMode && flatSearchResults[activeIndex]) {
          handleSelectResult(flatSearchResults[activeIndex]);
        } else if (!isSearchMode && defaultItems[activeIndex]) {
          defaultItems[activeIndex].action();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, totalItems, activeIndex, isSearchMode, flatSearchResults, defaultItems, handleSelectResult]);

  // Scroll active into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  let flatIndex = -1;

  return (
    <div className="fixed inset-0 z-[100]" onClick={() => setOpen(false)}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative mx-auto mt-[12vh] w-full max-w-xl" onClick={e => e.stopPropagation()}>
        <div className="bg-card border border-border-light rounded-xl shadow-modal overflow-hidden">
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border-light">
            <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search or type a command…"
              className="flex-1 bg-transparent text-[15px] text-foreground placeholder:text-muted-foreground outline-none font-body"
            />
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-border-light bg-muted text-[10px] text-muted-foreground font-data">
              ESC
            </kbd>
          </div>

          {/* Content area */}
          <div ref={listRef} className="max-h-[60vh] overflow-y-auto">
            {/* ── DEFAULT STATE ── */}
            {!isSearchMode && (
              <>
                {/* Recent items */}
                {recentItems.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 px-4 pt-3 pb-1">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-label text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Recent
                      </span>
                    </div>
                    {recentItems.map((item, i) => {
                      flatIndex++;
                      const idx = flatIndex;
                      return (
                        <button
                          key={item.id}
                          data-index={idx}
                          onClick={item.action}
                          onMouseEnter={() => setActiveIndex(idx)}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                            idx === activeIndex ? "bg-accent/60" : "hover:bg-accent/30"
                          )}
                        >
                          {item.icon}
                          <div className="flex-1 min-w-0">
                            <span className="font-body text-[13px] text-foreground truncate block">{item.label}</span>
                            {item.subtitle && (
                              <span className="font-body text-[11px] text-muted-foreground capitalize">{item.subtitle}</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Quick actions */}
                {quickActions.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 px-4 pt-3 pb-1">
                      <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-label text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Quick Actions
                      </span>
                    </div>
                    {quickActions.map((item) => {
                      flatIndex++;
                      const idx = flatIndex;
                      return (
                        <button
                          key={item.id}
                          data-index={idx}
                          onClick={item.action}
                          onMouseEnter={() => setActiveIndex(idx)}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                            idx === activeIndex ? "bg-accent/60" : "hover:bg-accent/30"
                          )}
                        >
                          <span className="text-muted-foreground">{item.icon}</span>
                          <div className="flex-1 min-w-0">
                            <span className="font-body text-[13px] text-foreground">{item.label}</span>
                            {item.subtitle && (
                              <span className="font-body text-[11px] text-muted-foreground ml-2">{item.subtitle}</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Empty state if nothing */}
                {recentItems.length === 0 && quickActions.length === 0 && (
                  <div className="px-4 py-8 text-center text-muted-foreground text-sm font-body">
                    Start typing to search…
                  </div>
                )}
              </>
            )}

            {/* ── SEARCH STATE ── */}
            {isSearchMode && (
              <>
                {loading && (
                  <div className="px-4 py-8 text-center text-muted-foreground text-sm font-body">
                    Searching…
                  </div>
                )}

                {!loading && flatSearchResults.length === 0 && (
                  <div className="px-4 py-8 text-center text-muted-foreground text-sm font-body">
                    No results for "{debouncedQuery}"
                  </div>
                )}

                {!loading && results.map(group => {
                  if (group.results.length === 0) return null;
                  const shown = group.results.slice(0, 3);
                  return (
                    <div key={group.category}>
                      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
                        <span className="text-muted-foreground">{group.icon}</span>
                        <span className="font-label text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {group.label}
                        </span>
                        {group.total > 3 && (
                          <span className="font-data text-[11px] text-muted-foreground ml-auto">
                            {group.total} total
                          </span>
                        )}
                      </div>

                      {shown.map(result => {
                        flatIndex++;
                        const idx = flatIndex;
                        return (
                          <button
                            key={result.id}
                            data-index={idx}
                            onClick={() => handleSelectResult(result)}
                            onMouseEnter={() => setActiveIndex(idx)}
                            className={cn(
                              "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                              idx === activeIndex ? "bg-accent/60" : "hover:bg-accent/30"
                            )}
                          >
                            {result.thumbnail && (
                              <img src={result.thumbnail} alt="" className="h-8 w-8 rounded object-cover flex-shrink-0 border border-border-light" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-body text-[13px] text-foreground truncate">
                                  <HighlightMatch text={result.title} query={debouncedQuery} />
                                </span>
                                {result.grade && <GradeBadge grade={result.grade} />}
                              </div>
                              {result.subtitle && (
                                <p className="font-body text-[11px] text-muted-foreground truncate">{result.subtitle}</p>
                              )}
                            </div>
                            {result.meta && (
                              <span className="font-data text-[11px] text-muted-foreground flex-shrink-0 tabular-nums">{result.meta}</span>
                            )}
                          </button>
                        );
                      })}

                      {group.total > 3 && (
                        <button
                          onClick={() => {
                            setOpen(false);
                            const navMap: Record<string, string> = {
                              creatives: "/creatives", reports: "/reports", briefs: "/briefs",
                              creators: "/creators", tests: "/tests",
                            };
                            navigate(`${navMap[group.category]}?q=${encodeURIComponent(debouncedQuery)}`);
                          }}
                          className="w-full px-4 py-2 text-left font-body text-[12px] text-primary hover:underline"
                        >
                          See all {group.total} {group.label.toLowerCase()} →
                        </button>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-4 px-4 py-2 border-t border-border-light bg-muted/30">
            <span className="font-data text-[10px] text-muted-foreground flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded border border-border-light bg-muted text-[9px]">↑↓</kbd> navigate
            </span>
            <span className="font-data text-[10px] text-muted-foreground flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded border border-border-light bg-muted text-[9px]">↵</kbd> select
            </span>
            <span className="font-data text-[10px] text-muted-foreground flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded border border-border-light bg-muted text-[9px]">esc</kbd> close
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Trigger the search overlay from the header */
export function GlobalSearchTrigger() {
  return (
    <button
      onClick={() => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
      }}
      className="flex items-center gap-2 h-8 px-3 rounded-lg border border-border-light bg-card hover:bg-accent/40 transition-colors text-muted-foreground"
    >
      <Search className="h-3.5 w-3.5" />
      <span className="hidden sm:inline font-body text-[12px]">Search…</span>
      <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1 py-0.5 rounded border border-border-light bg-muted text-[9px] font-data">
        ⌘K
      </kbd>
    </button>
  );
}

/** Highlight matching text */
function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query || query.length < 2) return <>{text}</>;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-warning/30 text-foreground rounded-sm px-0.5">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

/** Perform parallel searches across all categories */
async function performSearch(query: string, accountId?: string): Promise<GroupedResults[]> {
  const ilike = `%${query}%`;
  const accountFilter = accountId && accountId !== "all" ? accountId : undefined;

  const [creativesRes, reportsRes, briefsRes, creatorsRes, testsRes] = await Promise.all([
    (() => {
      let q = supabase.from("creatives")
        .select("ad_id, ad_name, campaign_name, adset_name, account_id, roas, spend, ctr, thumbnail_url")
        .or(`ad_name.ilike.${ilike},campaign_name.ilike.${ilike},adset_name.ilike.${ilike}`)
        .order("spend", { ascending: false }).limit(20);
      if (accountFilter) q = q.eq("account_id", accountFilter);
      return q;
    })(),
    (() => {
      let q = supabase.from("reports")
        .select("id, report_name, account_id, created_at, is_public")
        .ilike("report_name", ilike).order("created_at", { ascending: false }).limit(20);
      if (accountFilter) q = q.eq("account_id", accountFilter);
      return q;
    })(),
    (() => {
      let q = supabase.from("briefs")
        .select("id, name, account_id, assignee_name, status")
        .ilike("name", ilike).order("created_at", { ascending: false }).limit(20);
      if (accountFilter) q = q.eq("account_id", accountFilter);
      return q;
    })(),
    (() => {
      let q = supabase.from("creators")
        .select("id, name, handle, type, account_id")
        .or(`name.ilike.${ilike},handle.ilike.${ilike}`).order("name").limit(20);
      if (accountFilter) q = q.eq("account_id", accountFilter);
      return q;
    })(),
    (() => {
      let q = supabase.from("split_tests")
        .select("id, name, hypothesis, status, variable_tested, account_id")
        .or(`name.ilike.${ilike},hypothesis.ilike.${ilike}`).order("created_at", { ascending: false }).limit(20);
      if (accountFilter) q = q.eq("account_id", accountFilter);
      return q;
    })(),
  ]);

  const creatives = creativesRes.data || [];
  const grades = gradeCreatives(creatives);

  const groups: GroupedResults[] = [
    {
      category: "creatives", ...CATEGORY_CONFIG.creatives, total: creatives.length,
      results: creatives.map(c => {
        const g = grades.get(c.ad_id);
        return {
          id: c.ad_id, category: "creatives" as const, title: c.ad_name,
          subtitle: [c.campaign_name, c.adset_name].filter(Boolean).join(" · "),
          meta: c.roas != null ? `${Number(c.roas).toFixed(2)}x` : undefined,
          thumbnail: c.thumbnail_url, grade: g?.grade, roas: Number(c.roas) || 0,
          navigateTo: "/creatives", searchParams: { q: c.ad_name },
        };
      }),
    },
    {
      category: "reports", ...CATEGORY_CONFIG.reports, total: (reportsRes.data || []).length,
      results: (reportsRes.data || []).map(r => ({
        id: r.id, category: "reports" as const, title: r.report_name,
        subtitle: r.account_id || undefined,
        meta: new Date(r.created_at).toLocaleDateString(), navigateTo: `/reports/${r.id}`,
      })),
    },
    {
      category: "briefs", ...CATEGORY_CONFIG.briefs, total: (briefsRes.data || []).length,
      results: (briefsRes.data || []).map(b => ({
        id: b.id, category: "briefs" as const, title: b.name,
        subtitle: [b.assignee_name, b.status].filter(Boolean).join(" · "),
        navigateTo: "/briefs", searchParams: { q: b.name },
      })),
    },
    {
      category: "creators", ...CATEGORY_CONFIG.creators, total: (creatorsRes.data || []).length,
      results: (creatorsRes.data || []).map(c => ({
        id: c.id, category: "creators" as const, title: c.name,
        subtitle: [c.handle, c.type].filter(Boolean).join(" · "),
        navigateTo: "/creators", searchParams: { q: c.name },
      })),
    },
    {
      category: "tests", ...CATEGORY_CONFIG.tests, total: (testsRes.data || []).length,
      results: (testsRes.data || []).map(t => ({
        id: t.id, category: "tests" as const, title: t.name,
        subtitle: [t.variable_tested, t.status].filter(Boolean).join(" · "),
        navigateTo: "/tests", searchParams: { q: t.name },
      })),
    },
  ];

  return groups.filter(g => g.results.length > 0);
}
