import { useState, useCallback } from "react";
import { useAdLibraryBoards, useRemoveFromBoard, useAddToBoard, useDeleteSavedAd, useUpdateSavedAd, useAdLibraryTags, useToggleAdTag } from "@/features/ad-library/hooks/useAdLibrary";
import { useAdLibraryAds } from "@/features/ad-library/hooks/useAdLibraryInfinite";
import type { AdLibrarySavedAd } from "@/features/ad-library/types/ad-library";
import { AdGrid } from "./AdGrid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Plus, Share2, Copy, Check, Search, Trash2, Tag, FolderInput } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  boardId: string;
  onBack?: () => void;
  onViewAdDetails?: (ad: AdLibrarySavedAd) => void;
}

export function BoardDetailView({ boardId, onBack, onViewAdDetails }: Props) {
  const { data: boards = [] } = useAdLibraryBoards();
  const board = boards.find((b) => b.id === boardId);
  const { data: boardAdsPages, isLoading } = useAdLibraryAds({ board_id: boardId });
  const boardAds = boardAdsPages?.pages.flat() ?? [];
  const { data: allAdsPages } = useAdLibraryAds();
  const allAds = allAdsPages?.pages.flat() ?? [];
  const { data: allTags = [] } = useAdLibraryTags();
  const removeFromBoard = useRemoveFromBoard();
  const addToBoard = useAddToBoard();
  const deleteAd = useDeleteSavedAd();
  const updateAd = useUpdateSavedAd();
  const toggleTag = useToggleAdTag();
  const qc = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [showAddAds, setShowAddAds] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  const boardAdIds = new Set(boardAds.map((a) => a.id));
  const availableAds = allAds.filter(
    (a) => !boardAdIds.has(a.id) && (!addSearch || (a.advertiser_name || "").toLowerCase().includes(addSearch.toLowerCase()) || (a.body_text || "").toLowerCase().includes(addSearch.toLowerCase()))
  );

  const startEditing = () => {
    if (!board) return;
    setName(board.name);
    setEditing(true);
  };

  const saveName = async () => {
    if (!name.trim() || !board) return;
    await supabase.from("ad_library_boards" as any).update({ name: name.trim() } as any).eq("id", board.id);
    qc.invalidateQueries({ queryKey: ["ad-library-boards"] });
    setEditing(false);
    toast.success("Board renamed");
  };

  const handleCopyShareLink = () => {
    if (!board?.share_token) return;
    const url = `${window.location.origin}/shared/ad-board/${board.share_token}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Share link copied");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTogglePublic = async () => {
    if (!board) return;
    const newPublic = !board.is_public;
    const token = newPublic ? crypto.randomUUID().replace(/-/g, "").slice(0, 12) : null;
    await supabase.from("ad_library_boards" as any).update({ is_public: newPublic, share_token: token } as any).eq("id", board.id);
    qc.invalidateQueries({ queryKey: ["ad-library-boards"] });
    toast.success(newPublic ? "Board is now public" : "Board is now private");
  };

  const handleAddSelectedAds = () => {
    selected.forEach((adId) => {
      addToBoard.mutate({ board_id: boardId, ad_id: adId });
    });
    setSelected(new Set());
    setShowAddAds(false);
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };

  if (!board) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">Board not found</div>;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        {onBack && (
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 mt-0.5" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="flex items-center gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 text-sm font-semibold max-w-xs"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditing(false); }}
              />
              <Button size="sm" className="h-8" onClick={saveName}>Save</Button>
            </div>
          ) : (
            <h2
              className="font-heading text-lg text-foreground cursor-pointer hover:text-primary transition-colors"
              onClick={startEditing}
            >
              {board.name}
            </h2>
          )}
          {board.description && (
            <p className="font-body text-sm text-muted-foreground mt-0.5">{board.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleTogglePublic}>
            <Share2 className="h-3.5 w-3.5" />
            {board.is_public ? "Make Private" : "Share"}
          </Button>
          <Button size="sm" className="gap-1.5 text-xs" onClick={() => setShowAddAds(true)}>
            <Plus className="h-3.5 w-3.5" /> Add Ads
          </Button>
        </div>
      </div>

      {/* Public share banner */}
      {board.is_public && board.share_token && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-card bg-primary/5 border border-primary/10 mb-4">
          <Share2 className="h-4 w-4 text-primary flex-shrink-0" />
          <span className="text-xs font-body text-foreground flex-1 truncate">
            {window.location.origin}/shared/ad-board/{board.share_token}
          </span>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleCopyShareLink}>
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}

      {/* Ad grid */}
      <AdGrid
        ads={boardAds}
        loading={isLoading}
        boards={boards}
        allTags={allTags}
        onViewDetails={onViewAdDetails}
        onDelete={(id) => deleteAd.mutate(id)}
        onAddToBoard={(adId, bId) => addToBoard.mutate({ board_id: bId, ad_id: adId })}
        onToggleTag={(adId, tagId, remove) => toggleTag.mutate({ ad_id: adId, tag_id: tagId, remove })}
        onUpdateNotes={(adId, notes) => updateAd.mutate({ id: adId, notes })}
        emptyAction={
          <Button size="sm" className="gap-1.5" onClick={() => setShowAddAds(true)}>
            <Plus className="h-3.5 w-3.5" /> Add Ads to Board
          </Button>
        }
      />

      {/* Add ads dialog */}
      <Dialog open={showAddAds} onOpenChange={setShowAddAds}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-heading">Add Ads to Board</DialogTitle>
          </DialogHeader>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={addSearch} onChange={(e) => setAddSearch(e.target.value)} placeholder="Search your saved ads..." className="pl-9 h-9 text-sm" />
          </div>
          <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
            {availableAds.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No ads available to add</p>
            ) : (
              availableAds.map((ad) => (
                <button
                  key={ad.id}
                  onClick={() => toggleSelect(ad.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors",
                    selected.has(ad.id) ? "bg-primary/10 border border-primary/20" : "hover:bg-accent border border-transparent"
                  )}
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
                    <p className="text-sm font-medium text-foreground truncate">{ad.advertiser_name || "Unknown"}</p>
                    <p className="text-xs text-muted-foreground truncate">{ad.body_text?.slice(0, 60) || ad.headline || "No text"}</p>
                  </div>
                  {selected.has(ad.id) && <Check className="h-4 w-4 text-primary flex-shrink-0" />}
                </button>
              ))
            )}
          </div>
          {selected.size > 0 && (
            <div className="flex items-center justify-between pt-3 border-t border-border">
              <span className="text-xs text-muted-foreground">{selected.size} selected</span>
              <Button size="sm" onClick={handleAddSelectedAds}>Add to Board</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
