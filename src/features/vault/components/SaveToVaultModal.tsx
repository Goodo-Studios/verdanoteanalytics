import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface Props {
  itemId: string | null;
  initialTags?: string[];
  initialNotes?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Lightweight modal for editing tags + notes on an existing inspiration item.
 *
 * Verdanote scopes vault items by user_id, so there's no workspace_id or
 * board selection in this base flow — that lives behind board UI ports.
 */
export function SaveToVaultModal({ itemId, initialTags = [], initialNotes = "", open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setTags(initialTags.join(", "));
    setNotes(initialNotes ?? "");
  }, [open, initialTags, initialNotes]);

  const save = useMutation({
    mutationFn: async () => {
      if (!itemId) throw new Error("No item selected");

      const parsedTags = tags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);

      // Replace tags: delete existing, insert new set (small N, simpler than diff).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from("inspiration_tags").delete().eq("item_id", itemId);

      if (parsedTags.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any)
          .from("inspiration_tags")
          .insert(parsedTags.map((tag) => ({ item_id: itemId, tag })));
        if (error) throw error;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: noteErr } = await (supabase as any)
        .from("inspiration_items")
        .update({ ad_body_text: notes.trim() || null })
        .eq("id", itemId);
      if (noteErr) throw noteErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vault-items"] });
      qc.invalidateQueries({ queryKey: ["vault-tags"] });
      toast.success("Saved");
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Save failed");
    },
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40 animate-in fade-in" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md bg-background rounded-xl shadow-2xl p-6 animate-in zoom-in-95",
          )}
        >
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold">Edit Tags & Notes</Dialog.Title>
            <Dialog.Close className="p-1 rounded hover:bg-muted transition-colors" aria-label="Close">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Tags</label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="comma, separated, tags"
                className="w-full border border-input rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Why is this inspiring? What would you steal?"
                rows={4}
                className="w-full border border-input rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
            </div>
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Save
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
