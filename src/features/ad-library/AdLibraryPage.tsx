import { useState, useEffect, useCallback, useRef } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { useAdLibraryBoards, useAdLibraryTags, useDeleteSavedAd, useAddToBoard, useToggleAdTag, useUpdateSavedAd } from "@/features/ad-library/hooks/useAdLibrary";
import { useAdLibraryAds } from "@/features/ad-library/hooks/useAdLibraryInfinite";
import type { AdLibrarySavedAd } from "@/features/ad-library/types/ad-library";
import { CollectionSidebar } from "@/features/ad-library/components/CollectionSidebar";
import { SaveAdModal } from "@/features/ad-library/components/SaveAdModal";
import { AdDetailPanel } from "@/features/ad-library/components/AdDetailPanel";
import { AdGrid } from "@/features/ad-library/components/AdGrid";
import { BoardDetailView } from "@/features/ad-library/components/BoardDetailView";
import { AdLibraryBoardsView } from "@/features/ad-library/components/AdLibraryBoardsView";
import { AdLibraryFoldersView } from "@/features/ad-library/components/AdLibraryFoldersView";
import { AdLibraryTagsView } from "@/features/ad-library/components/AdLibraryTagsView";
import { AdDetailView } from "@/features/ad-library/components/AdDetailView";
import { BookmarkletSetup } from "@/features/ad-library/components/BookmarkletSetup";

import { FilterToolbar, DEFAULT_FILTERS } from "@/features/ad-library/components/FilterToolbar";
import type { AdLibraryFilters } from "@/features/ad-library/components/FilterToolbar";
import { Button } from "@/components/ui/button";
import { Plus, Download } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export default function AdLibraryPage() {
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [selectedAd, setSelectedAd] = useState<AdLibrarySavedAd | null>(null);
  const [viewingBoardId, setViewingBoardId] = useState<string | null>(null);
  const [viewingAdId, setViewingAdId] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "boards" | "folders" | "tags" | "setup">("all");
  

  // Persist sort preference
  const [filters, setFilters] = useState<AdLibraryFilters>(() => {
    const savedSort = localStorage.getItem("ad-library-sort");
    return {
      ...DEFAULT_FILTERS,
      sort: savedSort || "recent",
    };
  });

  useEffect(() => {
    localStorage.setItem("ad-library-sort", filters.sort);
  }, [filters.sort]);

  // Use infinite query with filters
  const {
    data: adsPages,
    isLoading,
    hasNextPage,
    fetchNextPage,
  } = useAdLibraryAds({
    board_id: selectedBoardId || undefined,
    search: filters.search || undefined,
    platform: filters.platform,
    format: filters.format,
    tag_ids: filters.tag_ids.length > 0 ? filters.tag_ids : undefined,
    sort: filters.sort,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    timeFilter: filters.timeFilter,
  });

  const ads = adsPages?.pages.flat() ?? [];

  const { data: boards = [] } = useAdLibraryBoards();
  const { data: tags = [] } = useAdLibraryTags();
  const deleteAd = useDeleteSavedAd();
  const addToBoard = useAddToBoard();
  const toggleTag = useToggleAdTag();
  const updateAd = useUpdateSavedAd();

  const handleViewDetails = useCallback((ad: AdLibrarySavedAd) => {
    setViewingAdId(ad.id);
    setSelectedAd(null);
  }, []);

  const handleExport = useCallback(async () => {
    try {
      const { data: allAds } = await supabase
        .from("ad_library_saved_ads" as any)
        .select("*")
        .order("created_at", { ascending: false });

      const { data: allTags } = await supabase
        .from("ad_library_ad_tags" as any)
        .select("ad_id, tag_id");

      const { data: tagList } = await supabase
        .from("ad_library_tags" as any)
        .select("*");

      const { data: boardAds } = await supabase
        .from("ad_library_board_ads" as any)
        .select("ad_id, board_id");

      const { data: boardList } = await supabase
        .from("ad_library_boards" as any)
        .select("id, name");

      const tagLookup: Record<string, string> = {};
      (tagList || []).forEach((t: any) => { tagLookup[t.id] = t.name; });
      const boardLookup: Record<string, string> = {};
      (boardList || []).forEach((b: any) => { boardLookup[b.id] = b.name; });

      const tagsByAd: Record<string, string[]> = {};
      (allTags || []).forEach((at: any) => {
        if (!tagsByAd[at.ad_id]) tagsByAd[at.ad_id] = [];
        if (tagLookup[at.tag_id]) tagsByAd[at.ad_id].push(tagLookup[at.tag_id]);
      });

      const boardsByAd: Record<string, string[]> = {};
      (boardAds || []).forEach((ba: any) => {
        if (!boardsByAd[ba.ad_id]) boardsByAd[ba.ad_id] = [];
        if (boardLookup[ba.board_id]) boardsByAd[ba.ad_id].push(boardLookup[ba.board_id]);
      });

      const exportData = (allAds || []).map((ad: any) => ({
        ...ad,
        tags: tagsByAd[ad.id] || [],
        boards: boardsByAd[ad.id] || [],
      }));

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ad-library-export-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${exportData.length} ads`);
    } catch (e: any) {
      toast.error("Export failed: " + e.message);
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (tab !== "all") setTab("all");
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "s" && !isInput) {
        e.preventDefault();
        setShowSaveModal(true);
        return;
      }

      if (e.key === "Escape") {
        if (showSaveModal) { setShowSaveModal(false); return; }
        if (viewingAdId) { setViewingAdId(null); return; }
        if (viewingBoardId) { setViewingBoardId(null); return; }
        if (selectedAd) { setSelectedAd(null); return; }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [tab, showSaveModal, viewingAdId, viewingBoardId, selectedAd]);

  // Full-page ad detail view
  if (viewingAdId) {
    return (
      <AppLayout>
        <div className="flex h-full">
          <CollectionSidebar selectedBoardId={null} onSelect={() => {}} />
          <div className="flex-1 overflow-y-auto px-6 py-6 min-w-0">
            <AdDetailView adId={viewingAdId} onBack={() => setViewingAdId(null)} />
          </div>
        </div>
        <SaveAdModal isOpen={showSaveModal} onClose={() => setShowSaveModal(false)} />
      </AppLayout>
    );
  }

  // Board detail view
  if (viewingBoardId) {
    return (
      <AppLayout>
        <div className="flex h-full">
          <CollectionSidebar selectedBoardId={viewingBoardId} onSelect={(id) => {
            if (id) setViewingBoardId(id);
            else { setViewingBoardId(null); setSelectedBoardId(null); }
          }} />
          <div className="flex-1 overflow-y-auto px-6 py-6 min-w-0">
            <BoardDetailView
              boardId={viewingBoardId}
              onBack={() => setViewingBoardId(null)}
              onViewAdDetails={handleViewDetails}
            />
          </div>
          {selectedAd && <AdDetailPanel ad={selectedAd} onClose={() => setSelectedAd(null)} />}
        </div>
        <SaveAdModal isOpen={showSaveModal} onClose={() => setShowSaveModal(false)} />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex h-full">
        <CollectionSidebar selectedBoardId={selectedBoardId} onSelect={(id) => {
          if (id) setViewingBoardId(id);
          else setSelectedBoardId(null);
        }} />

        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-6 pt-6 pb-4">
            <PageHeader
              title="Ad Library"
              description="Save, organize, and reference ads from across the web"
            />
            <div className="flex items-center gap-3 mt-4">
              <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="mr-auto">
                <TabsList className="h-8">
                  <TabsTrigger value="all" className="text-xs px-3 h-7">All Ads</TabsTrigger>
                  <TabsTrigger value="boards" className="text-xs px-3 h-7">Boards</TabsTrigger>
                  <TabsTrigger value="folders" className="text-xs px-3 h-7">Folders</TabsTrigger>
                  <TabsTrigger value="tags" className="text-xs px-3 h-7">Tags</TabsTrigger>
                  <TabsTrigger value="setup" className="text-xs px-3 h-7">Quick Save</TabsTrigger>
                </TabsList>
              </Tabs>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExport}>
                <Download className="h-3.5 w-3.5" /> Export
              </Button>
              <Button onClick={() => setShowSaveModal(true)} size="sm" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Save Ad
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 pb-6">
            {tab === "all" && (
              <div className="space-y-4">
                <FilterToolbar
                  filters={filters}
                  onFilterChange={setFilters}
                  availableTags={tags}
                  totalCount={ads.length}
                />
                <AdGrid
                  ads={ads}
                  loading={isLoading}
                  hasMore={!!hasNextPage}
                  onLoadMore={() => fetchNextPage()}
                  boards={boards}
                  allTags={tags}
                  onViewDetails={handleViewDetails}
                  onDelete={(id) => deleteAd.mutate(id)}
                  onAddToBoard={(adId, boardId) => addToBoard.mutate({ board_id: boardId, ad_id: adId })}
                  onToggleTag={(adId, tagId, remove) => toggleTag.mutate({ ad_id: adId, tag_id: tagId, remove })}
                  onUpdateNotes={(adId, notes) => updateAd.mutate({ id: adId, notes })}
                  emptyAction={
                    <Button onClick={() => setShowSaveModal(true)} size="sm" className="gap-1.5">
                      <Plus className="h-3.5 w-3.5" /> Save Your First Ad
                    </Button>
                  }
                />
              </div>
            )}
            {tab === "boards" && (
              <AdLibraryBoardsView onSelectBoard={setViewingBoardId} />
            )}
            {tab === "folders" && (
              <AdLibraryFoldersView onSelectBoard={setViewingBoardId} />
            )}
            {tab === "tags" && (
              <AdLibraryTagsView />
            )}
            {tab === "setup" && (
              <div className="max-w-xl">
                <BookmarkletSetup />
              </div>
            )}
          </div>
        </div>

        {selectedAd && <AdDetailPanel ad={selectedAd} onClose={() => setSelectedAd(null)} />}
      </div>

      <SaveAdModal isOpen={showSaveModal} onClose={() => setShowSaveModal(false)} />
      
    </AppLayout>
  );
}
