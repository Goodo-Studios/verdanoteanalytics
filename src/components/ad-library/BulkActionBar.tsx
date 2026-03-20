import { useState } from "react";
import type { AdLibraryBoard } from "@/types/ad-library";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { LayoutGrid, Tag, Trash2, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  count: number;
  boards: AdLibraryBoard[];
  allTags: { id: string; name: string; color: string }[];
  onAddToBoard: (boardId: string) => void;
  onAddTag: (tagId: string) => void;
  onDelete: () => void;
  onClear: () => void;
}

export function BulkActionBar({ count, boards, allTags, onAddToBoard, onAddTag, onDelete, onClear }: Props) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (count === 0) return null;

  return (
    <>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-foreground text-background shadow-lg border border-foreground/10 animate-in slide-in-from-bottom-4 duration-200">
        <span className="text-sm font-body font-medium tabular-nums mr-1">
          {count} ad{count !== 1 ? "s" : ""} selected
        </span>

        {/* Add to Board */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary" size="sm" className="h-8 gap-1.5 text-xs bg-background/10 text-background hover:bg-background/20 border-0">
              <LayoutGrid className="h-3.5 w-3.5" /> Board
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-2" side="top" align="center">
            <p className="font-label text-[10px] uppercase tracking-wider text-muted-foreground px-2 pb-1.5">Add to Board</p>
            {boards.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2 py-2">No boards</p>
            ) : (
              boards.map((b) => (
                <button
                  key={b.id}
                  onClick={() => onAddToBoard(b.id)}
                  className="w-full text-left text-sm px-2 py-1.5 rounded-md hover:bg-accent transition-colors truncate"
                >
                  {b.name}
                </button>
              ))
            )}
          </PopoverContent>
        </Popover>

        {/* Add Tags */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary" size="sm" className="h-8 gap-1.5 text-xs bg-background/10 text-background hover:bg-background/20 border-0">
              <Tag className="h-3.5 w-3.5" /> Tag
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-2" side="top" align="center">
            <p className="font-label text-[10px] uppercase tracking-wider text-muted-foreground px-2 pb-1.5">Add Tag</p>
            {allTags.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2 py-2">No tags</p>
            ) : (
              allTags.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onAddTag(t.id)}
                  className="w-full flex items-center gap-2 text-sm px-2 py-1.5 rounded-md hover:bg-accent transition-colors"
                >
                  <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                  <span className="truncate">{t.name}</span>
                </button>
              ))
            )}
          </PopoverContent>
        </Popover>

        {/* Delete */}
        <Button
          variant="secondary"
          size="sm"
          className="h-8 gap-1.5 text-xs bg-destructive/20 text-destructive-foreground hover:bg-destructive/40 border-0"
          onClick={() => setShowDeleteConfirm(true)}
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </Button>

        {/* Clear */}
        <button onClick={onClear} className="ml-1 text-background/60 hover:text-background transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading">Delete {count} ad{count !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove the selected ads from your library and all boards.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={onDelete}>Delete All</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
