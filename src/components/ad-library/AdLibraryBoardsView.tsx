import { useState } from "react";
import { useAdLibraryBoards, useAdLibraryFolders, useDeleteSavedAd } from "@/hooks/useAdLibrary";
import { useSavedAds } from "@/hooks/useAdLibrary";
import type { AdLibraryBoard } from "@/types/ad-library";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Plus, LayoutGrid, MoreVertical, Calendar, Folder, Share2, Pencil, Trash2, FolderInput } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { NewBoardModal } from "./NewBoardModal";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface Props {
  onSelectBoard?: (boardId: string) => void;
}

function BoardCoverMosaic({ boardId }: { boardId: string }) {
  const { data: ads = [] } = useSavedAds({ board_id: boardId });
  const thumbs = ads.slice(0, 4).map((a) => a.thumbnail_url).filter(Boolean);

  if (thumbs.length === 0) {
    return (
      <div className="h-full w-full bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
        <LayoutGrid className="h-8 w-8 text-primary/20" />
      </div>
    );
  }

  if (thumbs.length === 1) {
    return <img src={thumbs[0]!} className="h-full w-full object-cover" alt="" />;
  }

  return (
    <div className="h-full w-full grid grid-cols-2 grid-rows-2 gap-px bg-border">
      {thumbs.map((url, i) => (
        <img key={i} src={url!} className="h-full w-full object-cover" alt="" />
      ))}
      {Array.from({ length: 4 - thumbs.length }).map((_, i) => (
        <div key={`empty-${i}`} className="bg-muted" />
      ))}
    </div>
  );
}

export function AdLibraryBoardsView({ onSelectBoard }: Props) {
  const { data: boards = [], isLoading } = useAdLibraryBoards();
  const { data: folders = [] } = useAdLibraryFolders();
  const [showNewBoard, setShowNewBoard] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const qc = useQueryClient();

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from("ad_library_boards" as any).delete().eq("id", deleteId);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["ad-library-boards"] });
    toast.success("Board deleted");
    setDeleteId(null);
  };

  const handleTogglePublic = async (board: AdLibraryBoard) => {
    const newPublic = !board.is_public;
    const token = newPublic ? crypto.randomUUID().replace(/-/g, "").slice(0, 12) : null;
    const { error } = await supabase
      .from("ad_library_boards" as any)
      .update({ is_public: newPublic, share_token: token } as any)
      .eq("id", board.id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["ad-library-boards"] });
    toast.success(newPublic ? "Board is now public" : "Board is now private");
  };

  const getFolderName = (folderId: string | null) => {
    if (!folderId) return null;
    return folders.find((f) => f.id === folderId)?.name || null;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-heading text-lg text-foreground">Boards</h2>
        <Button size="sm" className="gap-1.5" onClick={() => setShowNewBoard(true)}>
          <Plus className="h-3.5 w-3.5" /> New Board
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-card border border-border-light bg-card animate-pulse">
              <div className="aspect-[16/9] bg-muted" />
              <div className="p-3 space-y-2">
                <div className="h-4 bg-muted rounded w-2/3" />
                <div className="h-3 bg-muted rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : boards.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <LayoutGrid className="h-10 w-10 text-muted-foreground/20 mb-3" />
          <p className="font-heading text-base text-foreground mb-1">No boards yet</p>
          <p className="font-body text-sm text-muted-foreground mb-4">Create a board to organize your saved ads.</p>
          <Button size="sm" className="gap-1.5" onClick={() => setShowNewBoard(true)}>
            <Plus className="h-3.5 w-3.5" /> Create First Board
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {boards.map((board) => {
            const folderName = getFolderName(board.folder_id);
            return (
              <Card
                key={board.id}
                className={cn(
                  "group relative overflow-hidden cursor-pointer",
                  "transition-all duration-200 ease-out",
                  "hover:shadow-card-hover hover:scale-[1.02]",
                  "active:scale-[0.98]"
                )}
                onClick={() => onSelectBoard?.(board.id)}
              >
                <div className="relative aspect-[16/9] overflow-hidden">
                  <BoardCoverMosaic boardId={board.id} />
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="secondary" size="sm" className="h-7 w-7 p-0 rounded-md shadow-card bg-card/90 backdrop-blur-sm hover:bg-card">
                          <MoreVertical className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem onClick={() => onSelectBoard?.(board.id)}>
                          <Pencil className="h-3.5 w-3.5 mr-2" /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleTogglePublic(board)}>
                          <Share2 className="h-3.5 w-3.5 mr-2" /> {board.is_public ? "Make Private" : "Share"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteId(board.id)}>
                          <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {board.is_public && (
                    <Badge className="absolute bottom-2 left-2 text-[10px] bg-card/90 backdrop-blur-sm text-foreground border-border gap-1">
                      <Share2 className="h-2.5 w-2.5" /> Public
                    </Badge>
                  )}
                </div>
                <div className="p-3 space-y-1.5">
                  <p className="font-body text-sm font-semibold text-foreground truncate">{board.name}</p>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground font-label">
                    {folderName && (
                      <span className="flex items-center gap-1">
                        <Folder className="h-3 w-3" /> {folderName}
                      </span>
                    )}
                    <span className="tabular-nums">{board.ad_count ?? 0} ads</span>
                    <span className="flex items-center gap-1 ml-auto">
                      <Calendar className="h-3 w-3" />
                      {format(new Date(board.created_at), "MMM d")}
                    </span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <NewBoardModal isOpen={showNewBoard} onClose={() => setShowNewBoard(false)} />

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading">Delete Board?</AlertDialogTitle>
            <AlertDialogDescription>This will remove the board but not the ads inside it.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
