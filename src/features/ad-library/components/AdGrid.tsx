import { useEffect, useRef, useCallback, useState } from "react";
import type { AdLibrarySavedAd, AdLibraryBoard } from "@/features/ad-library/types/ad-library";
import { AdCard } from "./AdCard";
import { BulkActionBar } from "./BulkActionBar";
import { Library } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface AdGridProps {
  ads: AdLibrarySavedAd[];
  loading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  onViewDetails?: (ad: AdLibrarySavedAd) => void;
  onDelete?: (id: string) => void;
  onAddToBoard?: (adId: string, boardId: string) => void;
  onToggleTag?: (adId: string, tagId: string, remove: boolean) => void;
  onUpdateNotes?: (adId: string, notes: string) => void;
  boards?: AdLibraryBoard[];
  allTags?: { id: string; name: string; color: string }[];
  emptyAction?: React.ReactNode;
}

function SkeletonCard() {
  return (
    <div className="break-inside-avoid mb-4 rounded-card border border-border-light bg-card overflow-hidden animate-pulse">
      <div className="aspect-[4/3] bg-muted" />
      <div className="p-3 space-y-2.5">
        <div className="h-4 bg-muted rounded w-3/4" />
        <div className="flex gap-1.5">
          <div className="h-4 w-16 bg-muted rounded-full" />
          <div className="h-4 w-12 bg-muted rounded-full" />
        </div>
        <div className="h-3 bg-muted rounded w-full" />
        <div className="h-3 bg-muted rounded w-2/3" />
      </div>
    </div>
  );
}

export function AdGrid({
  ads,
  loading = false,
  hasMore = false,
  onLoadMore,
  onViewDetails,
  onDelete,
  onAddToBoard,
  onToggleTag,
  onUpdateNotes,
  boards,
  allTags,
  emptyAction,
}: AdGridProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const selectionMode = selected.size > 0;

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // Escape key clears selection
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectionMode) {
        clearSelection();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectionMode, clearSelection]);

  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0]?.isIntersecting && hasMore && !loading) {
        onLoadMore?.();
      }
    },
    [hasMore, loading, onLoadMore]
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !onLoadMore) return;

    const observer = new IntersectionObserver(handleIntersect, {
      rootMargin: "200px",
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [handleIntersect, onLoadMore]);

  const handleBulkDelete = () => {
    selected.forEach((id) => onDelete?.(id));
    clearSelection();
  };

  const handleBulkAddToBoard = (boardId: string) => {
    selected.forEach((id) => onAddToBoard?.(id, boardId));
    clearSelection();
  };

  const handleBulkAddTag = (tagId: string) => {
    selected.forEach((id) => onToggleTag?.(id, tagId, false));
  };

  if (!loading && ads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Library className="h-12 w-12 text-muted-foreground/20 mb-4" />
        <p className="font-heading text-base text-foreground mb-1">No ads found</p>
        <p className="font-body text-sm text-muted-foreground mb-4">
          Try adjusting your filters or save your first ad.
        </p>
        {emptyAction}
      </div>
    );
  }

  return (
    <div>
      <div
        className={cn(
          "columns-1 sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5",
          "gap-4"
        )}
      >
        {ads.map((ad) => (
          <AdCard
            key={ad.id}
            ad={ad}
            onViewDetails={selectionMode ? undefined : onViewDetails}
            onDelete={onDelete}
            onAddToBoard={onAddToBoard}
            onToggleTag={onToggleTag}
            onUpdateNotes={onUpdateNotes}
            boards={boards}
            allTags={allTags}
            selectable={selectionMode}
            selected={selected.has(ad.id)}
            onToggleSelect={toggleSelect}
          />
        ))}

        {/* Skeleton loaders while loading */}
        {loading &&
          Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={`skel-${i}`} />)}
      </div>

      {/* Sentinel for infinite scroll */}
      {hasMore && <div ref={sentinelRef} className="h-4" />}

      {/* Loading indicator for subsequent pages */}
      {loading && ads.length > 0 && (
        <div className="flex justify-center py-6">
          <div className="h-5 w-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {/* Bulk action bar */}
      <BulkActionBar
        count={selected.size}
        boards={boards || []}
        allTags={allTags || []}
        onAddToBoard={handleBulkAddToBoard}
        onAddTag={handleBulkAddTag}
        onDelete={handleBulkDelete}
        onClear={clearSelection}
      />
    </div>
  );
}
