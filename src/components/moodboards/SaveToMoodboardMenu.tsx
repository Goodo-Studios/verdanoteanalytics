import { useState } from "react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Bookmark, Plus, Loader2 } from "lucide-react";
import { useMoodboardList, useAddMoodboardItem } from "@/hooks/useMoodboardsApi";
import { useNavigate } from "react-router-dom";

interface SaveToMoodboardMenuProps {
  adId: string;
  thumbnailUrl?: string | null;
  caption?: string;
  /** Render as a small icon button when true */
  compact?: boolean;
}

export function SaveToMoodboardMenu({ adId, thumbnailUrl, caption, compact }: SaveToMoodboardMenuProps) {
  const { data: boards = [], isLoading } = useMoodboardList();
  const addItem = useAddMoodboardItem();
  const navigate = useNavigate();

  const handleSave = (boardId: string) => {
    addItem.mutate({
      moodboard_id: boardId,
      type: "creative",
      ad_id: adId,
      thumbnail_url: thumbnailUrl || undefined,
      caption: caption || undefined,
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <button className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" title="Save to Mood Board">
            <Bookmark className="h-3.5 w-3.5" />
          </button>
        ) : (
          <Button variant="ghost" size="sm" className="gap-1.5 font-body text-[12px]">
            <Bookmark className="h-3.5 w-3.5" />
            Save to Board
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 bg-white border border-border-light rounded-[8px] shadow-modal">
        {isLoading ? (
          <div className="flex items-center justify-center py-3">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          </div>
        ) : boards.length === 0 ? (
          <div className="px-3 py-2 text-center">
            <p className="font-body text-[12px] text-muted-foreground mb-2">No mood boards yet</p>
            <Button size="sm" variant="outline" className="text-[11px] w-full" onClick={() => navigate("/moodboards")}>
              <Plus className="h-3 w-3 mr-1" /> Create one
            </Button>
          </div>
        ) : (
          <>
            {boards.map((board) => (
              <DropdownMenuItem
                key={board.id}
                onClick={() => handleSave(board.id)}
                className="font-body text-[13px] cursor-pointer"
              >
                {board.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => navigate("/moodboards")}
              className="font-body text-[12px] text-muted-foreground cursor-pointer"
            >
              <Plus className="h-3 w-3 mr-1.5" /> New Mood Board
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
