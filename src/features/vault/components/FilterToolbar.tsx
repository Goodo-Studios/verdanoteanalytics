import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PLATFORM_LABELS,
  VAULT_PLATFORMS,
  type VaultPlatformFilter,
} from "../types/vault";

export type VaultStatusFilter = "all" | "pending" | "ready" | "error";
export type VaultSort = "newest" | "oldest";

const STATUSES: VaultStatusFilter[] = ["all", "pending", "ready", "error"];
const STATUS_LABEL: Record<VaultStatusFilter, string> = {
  all: "All status",
  pending: "Processing",
  ready: "Ready",
  error: "Errored",
};

export interface FilterToolbarProps {
  searchInput: string;
  onSearchChange: (val: string) => void;
  onSearchClear: () => void;
  isSemanticMode: boolean;
  searchQuery: string;
  platform: VaultPlatformFilter;
  onPlatformChange: (p: VaultPlatformFilter) => void;
  status: VaultStatusFilter;
  onStatusChange: (s: VaultStatusFilter) => void;
  sort: VaultSort;
  onSortChange: (s: VaultSort) => void;
  allTags: string[];
  activeTag: string | null;
  onTagToggle: (tag: string) => void;
}

/** Filter + search toolbar for the vault library page. */
export function FilterToolbar({
  searchInput,
  onSearchChange,
  onSearchClear,
  isSemanticMode,
  searchQuery,
  platform,
  onPlatformChange,
  status,
  onStatusChange,
  sort,
  onSortChange,
  allTags,
  activeTag,
  onTagToggle,
}: FilterToolbarProps) {
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by concept, hook style, or script content…"
          className="w-full pl-9 pr-8 py-2 border border-input rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {searchInput && (
          <button
            onClick={onSearchClear}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Clear search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {!isSemanticMode && (
        <>
          <div className="flex gap-2 flex-wrap items-center">
            {VAULT_PLATFORMS.map((p) => (
              <button
                key={p}
                onClick={() => onPlatformChange(p)}
                className={cn(
                  "px-3 py-1 rounded-full text-sm font-medium transition-colors",
                  platform === p
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {p === "all" ? "All" : PLATFORM_LABELS[p]}
              </button>
            ))}

            <div className="w-px h-4 bg-border" />

            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => onStatusChange(s)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                  status === s
                    ? "bg-secondary text-secondary-foreground"
                    : "border border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}

            <div className="w-px h-4 bg-border" />

            <select
              value={sort}
              onChange={(e) => onSortChange(e.target.value as VaultSort)}
              className="border border-input rounded-full px-3 py-1 text-xs font-medium bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </div>

          {allTags.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => onTagToggle(tag)}
                  className={cn(
                    "px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors",
                    activeTag === tag
                      ? "bg-secondary text-secondary-foreground"
                      : "border border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {isSemanticMode && (
        <p className="text-xs text-muted-foreground">
          Semantic search — showing results most similar to "{searchQuery}"
        </p>
      )}
    </div>
  );
}
