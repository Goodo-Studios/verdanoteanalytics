import { useState } from "react";
import { useAdLibraryBoards, useAdLibraryFolders, useCreateBoard, useCreateFolder } from "@/features/ad-library/hooks/useAdLibrary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FolderPlus, Library, Folder, LayoutGrid, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  selectedBoardId: string | null;
  onSelect: (id: string | null) => void;
}

export function CollectionSidebar({ selectedBoardId, onSelect }: Props) {
  const { data: folders = [] } = useAdLibraryFolders();
  const { data: boards = [] } = useAdLibraryBoards();
  const createBoard = useCreateBoard();
  const createFolder = useCreateFolder();
  const [showNewBoard, setShowNewBoard] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newName, setNewName] = useState("");

  const handleCreateBoard = () => {
    if (!newName.trim()) return;
    createBoard.mutate({ name: newName.trim() }, { onSuccess: () => { setNewName(""); setShowNewBoard(false); } });
  };

  const handleCreateFolder = () => {
    if (!newName.trim()) return;
    createFolder.mutate({ name: newName.trim() }, { onSuccess: () => { setNewName(""); setShowNewFolder(false); } });
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
              <div className="flex items-center gap-2 px-2.5 py-1.5 text-[12px] font-label text-sage uppercase tracking-wider">
                <Folder className="h-3.5 w-3.5" />
                <span className="truncate">{folder.name}</span>
              </div>
              {folderBoards.map((board) => (
                <button
                  key={board.id}
                  onClick={() => onSelect(board.id)}
                  className={cn(
                    "flex items-center gap-2.5 w-full rounded-md px-2.5 py-2 pl-8 text-[13px] font-body font-medium transition-colors",
                    selectedBoardId === board.id ? "bg-sage-light text-forest" : "text-slate hover:text-forest hover:bg-accent"
                  )}
                >
                  <LayoutGrid className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="truncate flex-1 text-left">{board.name}</span>
                  {(board.ad_count ?? 0) > 0 && <span className="text-[10px] text-sage tabular-nums">{board.ad_count}</span>}
                </button>
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
          <button
            key={board.id}
            onClick={() => onSelect(board.id)}
            className={cn(
              "flex items-center gap-2.5 w-full rounded-md px-2.5 py-2 text-[13px] font-body font-medium transition-colors",
              selectedBoardId === board.id ? "bg-sage-light text-forest" : "text-slate hover:text-forest hover:bg-accent"
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate flex-1 text-left">{board.name}</span>
            {(board.ad_count ?? 0) > 0 && <span className="text-[10px] text-sage tabular-nums">{board.ad_count}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
