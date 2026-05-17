import { useState, useRef, useEffect, useCallback } from "react";
import { useAdLibraryAds } from "@/features/ad-library/hooks/useAdLibraryInfinite";
import type { AdLibrarySavedAd } from "@/features/ad-library/types/ad-library";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  onSelectAd: (ad: AdLibrarySavedAd) => void;
  className?: string;
}

export function AdLibrarySearch({ onSelectAd, className }: Props) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce 300ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const { data: resultsPages } = useAdLibraryAds(
    debouncedQuery.length >= 2 ? { search: debouncedQuery } : {}
  );
  const results = resultsPages?.pages.flat() ?? [];

  const showDropdown = focused && debouncedQuery.length >= 2 && results.length > 0;

  const handleSelect = (ad: AdLibrarySavedAd) => {
    onSelectAd(ad);
    setQuery("");
    setDebouncedQuery("");
    inputRef.current?.blur();
  };

  const highlightMatch = (text: string, q: string) => {
    if (!q || !text) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-primary/15 text-foreground rounded-sm px-0.5">{text.slice(idx, idx + q.length)}</mark>
        {text.slice(idx + q.length)}
      </>
    );
  };

  const getSnippet = (ad: AdLibrarySavedAd): string => {
    const q = debouncedQuery.toLowerCase();
    if (ad.body_text?.toLowerCase().includes(q)) return ad.body_text.slice(0, 80);
    if (ad.headline?.toLowerCase().includes(q)) return ad.headline;
    if (ad.notes?.toLowerCase().includes(q)) return ad.notes.slice(0, 80);
    return ad.body_text?.slice(0, 60) || ad.headline || "";
  };

  // Expose focus method via Cmd+K from parent
  const focus = useCallback(() => inputRef.current?.focus(), []);

  // Attach to window for parent access
  useEffect(() => {
    (window as any).__adLibrarySearchFocus = focus;
    return () => { delete (window as any).__adLibrarySearchFocus; };
  }, [focus]);

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 200)}
          placeholder="Search ads... (⌘K)"
          className={cn(
            "w-full h-9 pl-9 pr-8 text-[13px] rounded-md border border-input bg-background",
            "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
            "transition-shadow font-body"
          )}
        />
        {query && (
          <button
            onClick={() => { setQuery(""); setDebouncedQuery(""); }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Results dropdown */}
      {showDropdown && (
        <div className="absolute z-50 top-full mt-1 w-full bg-popover border border-border rounded-md shadow-lg max-h-72 overflow-y-auto">
          {results.slice(0, 8).map((ad) => (
            <button
              key={ad.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(ad)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-accent transition-colors border-b border-border/50 last:border-0"
            >
              <div className="h-10 w-10 rounded bg-muted overflow-hidden flex-shrink-0">
                {ad.thumbnail_url ? (
                  <img src={ad.thumbnail_url} className="h-full w-full object-cover" alt="" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground font-semibold">
                    {(ad.advertiser_name || "A")[0]}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {highlightMatch(ad.advertiser_name || "Unknown", debouncedQuery)}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {highlightMatch(getSnippet(ad), debouncedQuery)}
                </p>
              </div>
            </button>
          ))}
          {results.length > 8 && (
            <div className="px-3 py-2 text-xs text-muted-foreground text-center border-t border-border">
              {results.length - 8} more results
            </div>
          )}
        </div>
      )}

      {/* No results */}
      {focused && debouncedQuery.length >= 2 && results.length === 0 && (
        <div className="absolute z-50 top-full mt-1 w-full bg-popover border border-border rounded-md shadow-lg px-4 py-6 text-center">
          <p className="text-sm text-foreground font-medium mb-1">No ads match your search</p>
          <p className="text-xs text-muted-foreground">Try different keywords or adjust your filters.</p>
        </div>
      )}
    </div>
  );
}
