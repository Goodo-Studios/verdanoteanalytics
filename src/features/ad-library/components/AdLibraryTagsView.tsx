import { useState } from "react";
import { useAdLibraryTags } from "@/features/ad-library/hooks/useAdLibrary";
import { useAdLibraryAds } from "@/features/ad-library/hooks/useAdLibraryInfinite";
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
import { Tag, Trash2, Pencil, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface Props {
  onFilterByTag?: (tagId: string) => void;
}

const TAG_COLORS = [
  "hsl(250, 55%, 58%)", "hsl(200, 65%, 52%)", "hsl(150, 50%, 45%)",
  "hsl(35, 85%, 55%)", "hsl(0, 60%, 55%)", "hsl(280, 50%, 55%)",
  "hsl(170, 55%, 42%)", "hsl(320, 50%, 52%)",
];

export function AdLibraryTagsView({ onFilterByTag }: Props) {
  const { data: tags = [], isLoading } = useAdLibraryTags();
  const { data: adsPages } = useAdLibraryAds();
  const allAds = adsPages?.pages.flat() ?? [];
  const qc = useQueryClient();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Count ads per tag
  const tagCounts: Record<string, number> = {};
  allAds.forEach((ad) => {
    (ad.tags || []).forEach((t) => {
      tagCounts[t.id] = (tagCounts[t.id] || 0) + 1;
    });
  });

  const startEdit = (tag: { id: string; name: string; color: string }) => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    const { error } = await supabase
      .from("ad_library_tags" as any)
      .update({ name: editName.trim(), color: editColor } as any)
      .eq("id", editingId);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["ad-library-tags"] });
    qc.invalidateQueries({ queryKey: ["ad-library-saved-ads"] });
    setEditingId(null);
    toast.success("Tag updated");
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    // Delete tag associations first, then tag
    await supabase.from("ad_library_ad_tags" as any).delete().eq("tag_id", deleteId);
    const { error } = await supabase.from("ad_library_tags" as any).delete().eq("id", deleteId);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["ad-library-tags"] });
    qc.invalidateQueries({ queryKey: ["ad-library-saved-ads"] });
    toast.success("Tag deleted");
    setDeleteId(null);
  };

  if (isLoading) {
    return (
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-9 w-24 bg-muted rounded-full animate-pulse" />
        ))}
      </div>
    );
  }

  if (tags.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Tag className="h-10 w-10 text-muted-foreground/20 mb-3" />
        <p className="font-body text-sm text-muted-foreground">No tags yet. Tags are created when you save or edit ads.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="font-heading text-lg text-foreground mb-4">Tags</h2>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => {
          const isEditing = editingId === tag.id;
          const count = tagCounts[tag.id] || 0;

          if (isEditing) {
            return (
              <div key={tag.id} className="flex items-center gap-1.5 bg-card border border-border rounded-full px-2 py-1">
                <div className="flex items-center gap-1">
                  {TAG_COLORS.map((c) => (
                    <button
                      key={c}
                      className={cn("h-3.5 w-3.5 rounded-full transition-transform", editColor === c && "ring-2 ring-offset-1 ring-primary scale-110")}
                      style={{ backgroundColor: c }}
                      onClick={() => setEditColor(c)}
                    />
                  ))}
                </div>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="h-6 w-24 text-xs px-1.5 border-0 focus-visible:ring-0"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingId(null); }}
                />
                <button onClick={saveEdit} className="text-primary hover:text-primary/80"><Check className="h-3.5 w-3.5" /></button>
                <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
              </div>
            );
          }

          return (
            <button
              key={tag.id}
              className={cn(
                "group inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-border",
                "bg-card hover:bg-accent transition-colors text-sm font-body"
              )}
              onClick={() => onFilterByTag?.(tag.id)}
            >
              <span className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
              <span className="text-foreground">{tag.name}</span>
              <span className="text-[10px] text-muted-foreground tabular-nums">{count}</span>
              <span className="hidden group-hover:flex items-center gap-1 ml-1">
                <span
                  onClick={(e) => { e.stopPropagation(); startEdit(tag); }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" />
                </span>
                <span
                  onClick={(e) => { e.stopPropagation(); setDeleteId(tag.id); }}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading">Delete Tag?</AlertDialogTitle>
            <AlertDialogDescription>This will remove the tag from all ads. Ads themselves won't be deleted.</AlertDialogDescription>
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
