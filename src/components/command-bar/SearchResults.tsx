import { cn } from "@/lib/utils";
import { GradeBadge } from "@/components/creatives/GradeBadge";
import { CATEGORY_CONFIG } from "./constants";
import { SectionHeader, HighlightMatch } from "./CommandBarParts";
import type { GroupedResults, SearchResult } from "./types";

interface SearchResultsProps {
  results: GroupedResults[];
  debouncedQuery: string;
  activeIndex: number;
  flatIndexRef: { current: number };
  onSelectResult: (result: SearchResult) => void;
  onHover: (idx: number) => void;
  onSeeAll: (category: string) => void;
}

export function SearchResults({
  results, debouncedQuery, activeIndex, flatIndexRef, onSelectResult, onHover, onSeeAll,
}: SearchResultsProps) {
  return (
    <>
      {results.map(group => {
        if (group.results.length === 0) return null;
        const shown = group.results.slice(0, 3);
        return (
          <div key={group.category}>
            <SectionHeader icon={group.icon} label={group.label} count={group.total > 3 ? group.total : undefined} />
            {shown.map(result => {
              flatIndexRef.current++;
              const idx = flatIndexRef.current;
              return (
                <button
                  key={result.id}
                  data-index={idx}
                  onClick={() => onSelectResult(result)}
                  onMouseEnter={() => onHover(idx)}
                  className={cn(
                    "w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors duration-75",
                    idx === activeIndex ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
                  )}
                >
                  {result.thumbnail ? (
                    <img src={result.thumbnail} alt="" className="h-8 w-8 rounded-md object-cover flex-shrink-0 border border-white/[0.06]" />
                  ) : (
                    <span className="text-white/20">{CATEGORY_CONFIG[result.category]?.icon}</span>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-body text-[13px] text-white/90 truncate">
                        <HighlightMatch text={result.title} query={debouncedQuery} />
                      </span>
                      {result.grade && <GradeBadge grade={result.grade} />}
                    </div>
                    {result.subtitle && (
                      <p className="font-body text-[11px] text-white/30 truncate">{result.subtitle}</p>
                    )}
                  </div>
                  {result.meta && (
                    <span className="font-data text-[11px] text-white/30 flex-shrink-0 tabular-nums">{result.meta}</span>
                  )}
                </button>
              );
            })}
            {group.total > 3 && (
              <button
                onClick={() => onSeeAll(group.category)}
                className="w-full px-5 py-1.5 text-left font-body text-[11px] text-emerald-400/70 hover:text-emerald-400 transition-colors"
              >
                See all {group.total} {group.label.toLowerCase()} →
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}
