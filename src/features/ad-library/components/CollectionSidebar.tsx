import { useState } from "react";
import { useAdLibraryBoards, useAdLibraryFolders, useCreateBoard, useCreateFolder, useDeleteBoard, useDeleteFolder, useMoveBoard } from "@/features/ad-library/hooks/useAdLibrary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FolderPlus, Library, Folder, LayoutGrid, Plus, MoreHorizontal, Trash2, FolderInput, FolderOutput } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Props {
  selectedBoardId: string | null;
  onSelect: (id: string | null) => void;
}

export function CollectionSidebar({ selectedBoardId, onSelect }: Props) {
  const { data: folders = [] } = useAdLibraryFolders();
  const { data: boards = [] } = useAdLibraryBoards();
  const createBoard = useCreateBoard();
  const createFolder = useCreateFolder();
  const deleteBoard = useDeleteBoard();
  const deleteFolder = useDeleteFolder();
  const moveBoard = useMoveBoard();
  const [showNewBoard, setShowNewBoard] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newName, setNewName] = useState("");
  const [deletingBoard, setDeletingBoard] = useState<{ id: string; name: string; ad_count: number } | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<{ id: string; name: string; boardCount: number } | null>(null);

  const handleCreateBoard = () => {
    if (!newName.trim()) return;
    createBoard.mutate({ name: newName.trim() }, { onSuccess: () => { setNewName(""); setShowNewBoard(false); } });
  };

  const handleCreateFolder = () => {
    if (!newName.trim()) return;
    createFolder.mutate({ name: newName.trim() }, { onSuccess: () => { setNewName(""); setShowNewFolder(false); } });
  };

  const handleDeleteBoard = () => {
    if (!deletingBoard) return;
    const id = deletingBoard.id;
    deleteBoard.mutate(id, {
      onSuccess: () => {
        if (selectedBoardId === id) onSelect(null);
        setDeletingBoard(null);
      },
      onError: () => setDeletingBoard(null),
    });
  };

  const handleDeleteFolder = () => {
    if (!deletingFolder) return;
    const id = deletingFolder.id;
    const folderBoardIds = boards.filter(b => b.folder_id === id).map(b => b.id);
    deleteFolder.mutate(id, {
      onSuccess: () => {
        if (selectedBoardId && folderBoardIds.includes(selectedBoardId)) onSelect(null);
        setDeletingFolder(null);
      },
      onError: () => setDeletingFolder(null),
    });
  };

  const unfoldered = boards.filter((b) => !b.folder_id);

  return (
    <div className="w-52 flex-shrink-0 border-r border-border-light bg-background">
      <div className="p-3 space-y-1">
        <p className="font-label text-[9px] uppercase tracking-[0.1em] text-sage px-2 pb-1">Library</p>
        <button
          onClick={() => onSelect(null)}
          className={cn(
            "flex items-center gap-2.5 w-full rounded-md px-2.5 py-2 text-[13px] font-body font-medium transition-colors",
            selectedBoardId === null ? "bg-sage-light text-forest" : "text-slate hover:text-forest hover:bg-accent"
          )}
        >
          <Library className="h-4 w-4 flex-shrink-0" />
          All Saved Ads
        </button>

        {/* Folders */}
        <div className="pt-3 pb-1 flex items-center justify-between px-2">
          <p className="font-label text-[9px] uppercase tracking-[0.1em] text-sage">Folders</p>
          <button onClick={() => { setShowNewFolder(true); setShowNewBoard(false); }} className="text-sage hover:text-forest transition-colors">
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
        </div>

        {showNewFolder && (
          <div className="px-1 pb-1">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Folder name" className="h-8 text-[12px]" autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateFolder(); if (e.key === "Escape") setShowNewFolder(false); }} />
            <div className="flex gap-1 mt-1">
              <Button size="sm" className="h-6 text-[11px] px-2" onClick={handleCreateFolder}>Create</Button>
              <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2" onClick={() => setShowNewFolder(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {folders.map((folder) => {
          const folderBoards = boards.filter((b) => b.folder_id === folder.id);
          return (
            <div key={folder.id}>
              <div className="group flex items-center gap-2 px-2.5 py-1.5 text-[12px] font-label text-sage uppercase tracking-wider">
                <Folder className="h-3.5 w-3.5" />
                <span className="truncate flex-1">{folder.name}</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      onClick={(e) => e.stopPropagation()}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-accent"
                    >
                      <MoreHorizontal className="h-3 w-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-[140px]">
                    <DropdownMenuItem
                      onClick={() => setDeletingFolder({ id: folder.id, name: folder.name, boardCount: folderBoards.length })}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-2" />
                      Delete Folder
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {folderBoards.map((board) => (
                <div key={board.id} className="group relative flex items-center">
                  <button
                    onClick={() => onSelect(board.id)}
                    className={cn(
                      "flex items-center gap-2.5 w-full rounded-md px-2.5 py-2 pl-8 text-[13px] font-body font-medium transition-colors",
                      selectedBoardId === board.id ? "bg-sage-light text-forest" : "text-slate hover:text-forest hover:bg-accent"
                    )}
                  >
                    <LayoutGrid className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate flex-1 text-left">{board.name}</span>
                    {(board.ad_count ?? 0) > 0 && <span className="text-[10px] text-sage tabular-nums mr-5">{board.ad_count}</span>}
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        onClick={(e) => e.stopPropagation()}
                        className="absolute right-1.5 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-accent"
                      >
                        <MoreHorizontal className="h-3 w-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="min-w-[160px]">
                      {folders.length > 0 && (
                        <>
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                              <FolderInput className="h-3.5 w-3.5 mr-2" />
                              Move to Folder
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="min-w-[140px]">
                              {folders.filter(f => f.id !== board.folder_id).map(f => (
                                <DropdownMenuItem key={f.id} onClick={() => moveBoard.mutate({ boardId: board.id, folderId: f.id })}>
                                  <Folder className="h-3.5 w-3.5 mr-2" />
                                  {f.name}
                                </DropdownMenuItem>
                              ))}
                              {board.folder_id && (
                                <DropdownMenuItem onClick={() => moveBoard.mutate({ boardId: board.id, folderId: null })}>
                                  <FolderOutput className="h-3.5 w-3.5 mr-2" />
                                  Remove from Folder
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                          <DropdownMenuSeparator />
                        </>
                      )}
                      <DropdownMenuItem
                        onClick={() => setDeletingBoard({ id: board.id, name: board.name, ad_count: board.ad_count ?? 0 })}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-2" />
                        Delete Board
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          );
        })}

        {/* Boards without folder */}
        <div className="pt-2 pb-1 flex items-center justify-between px-2">
          <p className="font-label text-[9px] uppercase tracking-[0.1em] text-sage">Boards</p>
          <button onClick={() => { setShowNewBoard(true); setShowNewFolder(false); }} className="text-sage hover:text-forest transition-colors">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {showNewBoard && (
          <div className="px-1 pb-1">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Board name" className="h-8 text-[12px]" autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateBoard(); if (e.key === "Escape") setShowNewBoard(false); }} />
            <div className="flex gap-1 mt-1">
              <Button size="sm" className="h-6 text-[11px] px-2" onClick={handleCreateBoard}>Create</Button>
              <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2" onClick={() => setShowNewBoard(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {unfoldered.map((board) => (
          <div key={board.id} className="group relative flex items-center">
            <button
              onClick={() => onSelect(board.id)}
              className={cn(
                "flex items-center gap-2.5 w-full rounded-md px-2.5 py-2 text-[13px] font-body font-medium transition-colors",
                selectedBoardId === board.id ? "bg-sage-light text-forest" : "text-slate hover:text-forest hover:bg-accent"
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate flex-1 text-left">{board.name}</span>
              {(board.ad_count ?? 0) > 0 && <span className="text-[10px] text-sage tabular-nums mr-5">{board.ad_count}</span>}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-1.5 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-accent"
                >
                  <MoreHorizontal className="h-3 w-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[140px]">
                <DropdownMenuItem
                  onClick={() => setDeletingBoard({ id: board.id, name: board.name, ad_count: board.ad_count ?? 0 })}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                  Delete Board
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </div>

      {/* Delete Board Confirmation */}
      <AlertDialog open={!!deletingBoard} onOpenChange={(open) => { if (!open) setDeletingBoard(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deletingBoard?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the board. The {deletingBoard?.ad_count || 0} ad{deletingBoard?.ad_count !== 1 ? 's' : ''} in this board will NOT be deleted — they'll remain in your library under "All Saved Ads".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteBoard} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete Board
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Folder Confirmation */}
      <AlertDialog open={!!deletingFolder} onOpenChange={(open) => { if (!open) setDeletingFolder(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deletingFolder?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the folder and its {deletingFolder?.boardCount || 0} board{deletingFolder?.boardCount !== 1 ? 's' : ''}. All ads will remain in your library under "All Saved Ads".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteFolder} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete Folder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
