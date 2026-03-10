import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRoleNavigate } from "@/hooks/useRolePath";
import {
  Search, FileText, FileEdit, RefreshCw, CalendarDays, Link2, ArrowRightLeft,
  Clock, Zap, Settings, BarChart3, Download, Heart, Terminal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useAccountContext } from "@/contexts/AccountContext";
import { useAuth } from "@/contexts/AuthContext";
import { useSync } from "@/hooks/useSyncApi";
import { toast } from "sonner";

import type { GroupedResults, CommandItem, SlashCommand, SearchResult } from "./command-bar/types";
import { getRecents, addRecent } from "./command-bar/recents";
import { performSearch } from "./command-bar/performSearch";
import { SectionHeader, CommandRow, EmptyState, FooterHint } from "./command-bar/CommandBarParts";
import { SearchResults } from "./command-bar/SearchResults";

/* ── Component ─────────────────────────────────────────── */

export function CommandBar() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<GroupedResults[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useRoleNavigate();
  const { selectedAccountId, accounts, setSelectedAccountId } = useAccountContext();
  const { isBuilder, isEmployee } = useAuth();
  const sync = useSync();
  const canEdit = isBuilder || isEmployee;

  const isCommandMode = query.startsWith("/");
  const isSearchMode = !isCommandMode && debouncedQuery.length >= 2;
  const isDefaultMode = !isCommandMode && !isSearchMode;

  // ── Slash commands ──
  const slashCommands = useMemo((): SlashCommand[] => {
    const currentAccountId = selectedAccountId && selectedAccountId !== "all" ? selectedAccountId : undefined;
    const cmds: SlashCommand[] = [];

    if (currentAccountId) {
      cmds.push({
        command: "/sync", label: "Trigger Sync", description: "Sync current account with Meta",
        icon: <RefreshCw className="h-4 w-4" />,
        execute: () => { setOpen(false); sync.mutate({ account_id: currentAccountId }); },
      });
    }
    cmds.push({ command: "/retro", label: "Weekly Retro", description: "Open weekly retro modal", icon: <CalendarDays className="h-4 w-4" />, execute: () => { setOpen(false); navigate("/settings"); } });
    cmds.push({ command: "/brief", label: "New Brief", description: "Create a new creative brief", icon: <FileEdit className="h-4 w-4" />, execute: () => { setOpen(false); navigate("/briefs"); } });
    cmds.push({ command: "/report", label: "New Report", description: "Create a new report", icon: <FileText className="h-4 w-4" />, execute: () => { setOpen(false); navigate("/reports"); } });
    cmds.push({ command: "/compare", label: "Compare View", description: "Open creative comparison", icon: <BarChart3 className="h-4 w-4" />, execute: () => { setOpen(false); navigate("/compare"); } });
    cmds.push({ command: "/export", label: "Export Center", description: "Open data export tools", icon: <Download className="h-4 w-4" />, execute: () => { setOpen(false); navigate("/settings"); } });
    cmds.push({ command: "/settings", label: "Settings", description: "Go to account settings", icon: <Settings className="h-4 w-4" />, execute: () => { setOpen(false); navigate("/settings"); } });
    cmds.push({ command: "/health", label: "Account Health", description: "Show client health score", icon: <Heart className="h-4 w-4" />, execute: () => { setOpen(false); navigate("/settings"); } });
    cmds.push({
      command: "/grade", label: "Filter by Grade", description: "Usage: /grade A — filter creatives by grade",
      icon: <Zap className="h-4 w-4" />,
      execute: (args) => {
        const grade = args.trim().toUpperCase();
        if (["A", "B", "C", "D", "F"].includes(grade)) { setOpen(false); navigate(`/creatives?grade=${grade}`); }
        else { toast.error("Invalid grade. Use A, B, C, D, or F"); }
      },
    });
    cmds.push({
      command: "/roas", label: "Filter by ROAS", description: "Usage: /roas >2.0 or /roas <1.0",
      icon: <BarChart3 className="h-4 w-4" />,
      execute: (args) => {
        const match = args.trim().match(/^([><])(\d+\.?\d*)$/);
        if (match) { setOpen(false); navigate(`/creatives?roas_op=${match[1] === ">" ? "gte" : "lte"}&roas_val=${match[2]}`); }
        else { toast.error("Usage: /roas >2.0 or /roas <1.0"); }
      },
    });
    return cmds;
  }, [selectedAccountId, navigate, sync]);

  const filteredCommands = useMemo(() => {
    if (!isCommandMode) return [];
    const typed = query.split(" ")[0].toLowerCase();
    return slashCommands.filter(c => c.command.startsWith(typed));
  }, [isCommandMode, query, slashCommands]);

  // ── Cmd+K listener ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setOpen(prev => !prev); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (open) { setTimeout(() => inputRef.current?.focus(), 50); setQuery(""); setDebouncedQuery(""); setResults([]); setActiveIndex(0); }
  }, [open]);

  useEffect(() => {
    if (isCommandMode) return;
    const t = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(t);
  }, [query, isCommandMode]);

  useEffect(() => {
    if (!isSearchMode) { setResults([]); return; }
    let cancelled = false;
    performSearch(debouncedQuery, selectedAccountId).then(res => {
      if (!cancelled) { setResults(res); setActiveIndex(0); setLoading(false); }
    });
    setLoading(true);
    return () => { cancelled = true; };
  }, [debouncedQuery, selectedAccountId, isSearchMode]);

  // ── Quick actions ──
  const quickActions = useMemo((): CommandItem[] => {
    if (!canEdit) return [];
    const items: CommandItem[] = [];
    const currentAccountId = selectedAccountId && selectedAccountId !== "all" ? selectedAccountId : undefined;

    items.push({ id: "new-brief", label: "New Brief", icon: <FileEdit className="h-4 w-4" />, action: () => { setOpen(false); navigate("/briefs"); }, group: "actions" });
    items.push({ id: "new-report", label: "New Report", icon: <FileText className="h-4 w-4" />, action: () => { setOpen(false); navigate("/reports"); }, group: "actions" });

    if (currentAccountId) {
      items.push({ id: "trigger-sync", label: "Trigger Sync", subtitle: "Current account", icon: <RefreshCw className="h-4 w-4" />, action: () => { setOpen(false); sync.mutate({ account_id: currentAccountId }); }, group: "actions" });
      items.push({ id: "weekly-retro", label: "Generate Weekly Retro", icon: <CalendarDays className="h-4 w-4" />, action: () => { setOpen(false); navigate("/settings"); }, group: "actions" });
      items.push({
        id: "copy-share-link", label: "Copy Share Link", subtitle: "Portfolio link", icon: <Link2 className="h-4 w-4" />,
        action: () => {
          const acc = accounts.find((a: any) => a.id === currentAccountId);
          if (acc?.portfolio_slug) { navigator.clipboard.writeText(`${window.location.origin}/portfolio/${acc.portfolio_slug}`); toast.success("Portfolio link copied"); }
          else { toast.info("No portfolio slug set"); }
          setOpen(false);
        }, group: "actions",
      });
    }

    if (accounts.length > 1 && currentAccountId) {
      const currentIdx = accounts.findIndex((a: any) => a.id === currentAccountId);
      const nextAcc = accounts[(currentIdx + 1) % accounts.length];
      if (nextAcc) {
        items.push({ id: "switch-account", label: `Switch to ${nextAcc.name}`, icon: <ArrowRightLeft className="h-4 w-4" />, action: () => { setOpen(false); setSelectedAccountId(nextAcc.id); toast.success(`Switched to ${nextAcc.name}`); }, group: "actions" });
      }
    }
    return items;
  }, [canEdit, selectedAccountId, accounts, navigate, sync, setSelectedAccountId]);

  const recentItems = useMemo((): CommandItem[] => {
    return getRecents().map(r => ({
      id: `recent-${r.id}`, label: r.label, subtitle: r.category,
      icon: <Clock className="h-4 w-4 opacity-40" />,
      action: () => { setOpen(false); navigate(r.navigateTo); },
      group: "recent" as const,
    }));
  }, [open, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  const flatSearchResults = useMemo(() => results.flatMap(g => g.results.slice(0, 3)), [results]);
  const defaultItems = useMemo(() => [...recentItems, ...quickActions], [recentItems, quickActions]);

  const totalItems = isCommandMode ? filteredCommands.length : isSearchMode ? flatSearchResults.length : defaultItems.length;

  const handleSelectResult = useCallback((result: SearchResult) => {
    setOpen(false);
    addRecent({ id: result.id, label: result.title, category: result.category, navigateTo: result.searchParams ? `${result.navigateTo}?${new URLSearchParams(result.searchParams).toString()}` : result.navigateTo });
    if (result.searchParams) { navigate(`${result.navigateTo}?${new URLSearchParams(result.searchParams).toString()}`); }
    else { navigate(result.navigateTo); }
  }, [navigate]);

  const executeCommand = useCallback((cmd: SlashCommand) => {
    const parts = query.split(" ");
    const args = parts.slice(1).join(" ");
    cmd.execute(args);
  }, [query]);

  // Keyboard nav
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, totalItems - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)); }
      if (e.key === "Enter") {
        e.preventDefault();
        if (isCommandMode && filteredCommands[activeIndex]) { executeCommand(filteredCommands[activeIndex]); }
        else if (isSearchMode && flatSearchResults[activeIndex]) { handleSelectResult(flatSearchResults[activeIndex]); }
        else if (isDefaultMode && defaultItems[activeIndex]) { defaultItems[activeIndex].action(); }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, totalItems, activeIndex, isCommandMode, isSearchMode, isDefaultMode, filteredCommands, flatSearchResults, defaultItems, handleSelectResult, executeCommand]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  let flatIndex = -1;
  const flatIndexRef = { current: -1 };

  return (
    <div className="fixed inset-0 z-[100] animate-fade-in" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[6px]" />
      <div className="relative mx-auto mt-[14vh] w-full max-w-[560px] px-4" onClick={e => e.stopPropagation()}>
        <div className="animate-scale-in rounded-2xl border border-white/[0.08] bg-[#1a1a1a] shadow-2xl overflow-hidden">
          {/* Input */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.06]">
            {isCommandMode ? (
              <Terminal className="h-4 w-4 text-emerald-400 flex-shrink-0" />
            ) : (
              <Search className="h-4 w-4 text-white/30 flex-shrink-0" />
            )}
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setActiveIndex(0); }}
              placeholder="Search, or type / for commands…"
              className="flex-1 bg-transparent text-[15px] text-white placeholder:text-white/25 outline-none font-body caret-emerald-400"
              autoComplete="off"
              spellCheck={false}
            />
            <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[10px] text-white/30 font-data">
              ESC
            </kbd>
          </div>

          {/* Content */}
          <div ref={listRef} className="max-h-[55vh] overflow-y-auto scrollbar-thin">
            {/* COMMAND MODE */}
            {isCommandMode && (
              <>
                <SectionHeader icon={<Terminal className="h-3.5 w-3.5" />} label="Commands" />
                {filteredCommands.length === 0 && <EmptyState text={`No command matching "${query}"`} />}
                {filteredCommands.map((cmd, i) => {
                  flatIndex++;
                  const idx = flatIndex;
                  return (
                    <CommandRow key={cmd.command} index={idx} active={idx === activeIndex}
                      icon={cmd.icon} label={cmd.command} subtitle={cmd.description}
                      onSelect={() => executeCommand(cmd)} onHover={() => setActiveIndex(idx)} />
                  );
                })}
              </>
            )}

            {/* DEFAULT MODE */}
            {isDefaultMode && (
              <>
                {recentItems.length > 0 && (
                  <>
                    <SectionHeader icon={<Clock className="h-3.5 w-3.5" />} label="Recent" />
                    {recentItems.map(item => {
                      flatIndex++;
                      const idx = flatIndex;
                      return <CommandRow key={item.id} index={idx} active={idx === activeIndex} icon={item.icon} label={item.label} subtitle={item.subtitle} onSelect={item.action} onHover={() => setActiveIndex(idx)} />;
                    })}
                  </>
                )}
                {quickActions.length > 0 && (
                  <>
                    <SectionHeader icon={<Zap className="h-3.5 w-3.5" />} label="Quick Actions" />
                    {quickActions.map(item => {
                      flatIndex++;
                      const idx = flatIndex;
                      return <CommandRow key={item.id} index={idx} active={idx === activeIndex} icon={item.icon} label={item.label} subtitle={item.subtitle} onSelect={item.action} onHover={() => setActiveIndex(idx)} />;
                    })}
                  </>
                )}
                {recentItems.length === 0 && quickActions.length === 0 && <EmptyState text="Start typing to search, or / for commands" />}
              </>
            )}

            {/* SEARCH MODE */}
            {isSearchMode && (
              <>
                {loading && <EmptyState text="Searching…" />}
                {!loading && flatSearchResults.length === 0 && <EmptyState text={`No results for "${debouncedQuery}"`} />}
                {!loading && (
                  <SearchResults
                    results={results}
                    debouncedQuery={debouncedQuery}
                    activeIndex={activeIndex}
                    flatIndexRef={flatIndexRef}
                    onSelectResult={handleSelectResult}
                    onHover={setActiveIndex}
                    onSeeAll={(category) => {
                      setOpen(false);
                      const navMap: Record<string, string> = { creatives: "/creatives", concepts: "/creatives", reports: "/reports", briefs: "/briefs", creators: "/creators", tests: "/tests" };
                      navigate(`${navMap[category] || "/creatives"}?q=${encodeURIComponent(debouncedQuery)}`);
                    }}
                  />
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-5 px-5 py-2.5 border-t border-white/[0.06] bg-white/[0.02]">
            <FooterHint keys={["↑", "↓"]} label="navigate" />
            <FooterHint keys={["↵"]} label="select" />
            <FooterHint keys={["/"]} label="commands" />
            <FooterHint keys={["esc"]} label="close" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Trigger button for header */
export function CommandBarTrigger() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => {
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
          }}
          className="flex items-center gap-2 h-8 px-3 rounded-lg border border-border-light bg-card hover:bg-accent/40 transition-colors text-muted-foreground"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden sm:inline font-body text-[12px]">Search…</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1 py-0.5 rounded border border-border-light bg-muted text-[9px] font-data">⌘K</kbd>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Command Bar <kbd className="ml-1 text-[10px] font-mono bg-muted px-1 rounded">⌘K</kbd>
      </TooltipContent>
    </Tooltip>
  );
}
