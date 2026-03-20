import { useState } from "react";
import { useAdLibraryFolders, useAdLibraryBoards, useCreateFolder } from "@/features/ad-library/hooks/useAdLibrary";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Plus, Folder, ChevronRight, LayoutGrid, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface Props {
  onSelectBoard?: (boardId: string) => void;
  onFilterFolder?: (folderId: string | null) => void;
}

const FOLDER_COLORS = [
  "hsl(250, 55%, 58%)", "hsl(200, 65%, 52%)", "hsl(150, 50%, 45%)",
  "hsl(35, 85%, 55%)", "hsl(0, 60%, 55%)", "hsl(280, 50%, 55%)",
];

export function AdLibraryFoldersView({ onSelectBoard, onFilterFolder }: Props) {
  const { data: folders = [], isLoading } = useAdLibraryFolders();
  const { data: boards = [] } = useAdLibraryBoards();
  const createFolder = useCreateFolder();
  const qc = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [selectedColor, setSelectedColor] = useState(FOLDER_COLORS[0]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleCreate = () => {
    if (!newName.trim()) return;
    createFolder.mutate(
      { name: newName.trim(), color: selectedColor },
      { onSuccess: () => { setNewName(""); setShowCreate(false); } }
    );
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from("ad_library_folders" as any).delete().eq("id", deleteId);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["ad-library-folders"] });
    qc.invalidateQueries({ queryKey: ["ad-library-boards"] });
    toast.success("Folder deleted");
    setDeleteId(null);
  };

  const getBoardCount = (folderId: string) => boards.filter((b) => b.folder_id === folderId).length;
  const getFolderBoards = (folderId: string) => boards.filter((b) => b.folder_id === folderId);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-heading text-lg text-foreground">Folders</h2>
        <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
          <Plus className="h-3.5 w-3.5" /> New Folder
        </Button>
      </div>

      {showCreate && (
        <Card className="p-4 mb-4 space-y-3">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Folder name"
            className="h-9 text-sm"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setShowCreate(false); }}
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-label">Color:</span>
            {FOLDER_COLORS.map((c) => (
              <button
                key={c}
                className={cn("h-5 w-5 rounded-full transition-transform", selectedColor === c && "ring-2 ring-offset-2 ring-primary scale-110")}
                style={{ backgroundColor: c }}
                onClick={() => setSelectedColor(c)}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleCreate} disabled={!newName.trim()}>Create</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 bg-muted rounded-card animate-pulse" />
          ))}
        </div>
      ) : folders.length === 0 && !showCreate ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Folder className="h-10 w-10 text-muted-foreground/20 mb-3" />
          <p className="font-body text-sm text-muted-foreground">No folders yet. Create one to organize your boards.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {folders.map((folder) => {
            const isExpanded = expanded.has(folder.id);
            const folderBoards = getFolderBoards(folder.id);
            const count = getBoardCount(folder.id);
            return (
              <div key={folder.id}>
                <button
                  onClick={() => toggleExpand(folder.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-3 rounded-card transition-colors",
                    "hover:bg-accent group"
                  )}
                >
                  <div className="h-4 w-4 rounded flex-shrink-0" style={{ backgroundColor: folder.color || FOLDER_COLORS[0] }} />
                  <span className="font-body text-sm font-medium text-foreground flex-1 text-left truncate">{folder.name}</span>
                  <span className="text-[11px] text-muted-foreground font-label tabular-nums">{count} boards</span>
                  <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", isExpanded && "rotate-90")} />
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteId(folder.id); }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </button>
                {isExpanded && (
                  <div className="pl-7 space-y-0.5 pb-1">
                    {folderBoards.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2 pl-3">No boards in this folder</p>
                    ) : (
                      folderBoards.map((board) => (
                        <button
                          key={board.id}
                          onClick={() => onSelectBoard?.(board.id)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left hover:bg-accent transition-colors"
                        >
                          <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm text-foreground truncate flex-1">{board.name}</span>
                          <span className="text-[10px] text-muted-foreground tabular-nums">{board.ad_count ?? 0}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading">Delete Folder?</AlertDialogTitle>
            <AlertDialogDescription>Boards inside will be moved to "No folder". No ads will be deleted.</AlertDialogDescription>
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
