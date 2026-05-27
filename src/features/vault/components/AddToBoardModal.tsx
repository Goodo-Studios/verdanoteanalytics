import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Loader2, Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { CreateBoardModal } from "./CreateBoardModal";

interface Board {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

interface Props {
  itemId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Modal to add an inspiration item to one or more boards.
 *
 * Toggling a row inserts/deletes a `board_items` row. Board membership is
 * derived from a separate query so the UI can show a checkmark for boards
 * the item is already in.
 */
export function AddToBoardModal({ itemId, open, onOpenChange }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const { data: boards = [] } = useQuery<Board[]>({
    queryKey: ["vault-boards", user?.id],
    enabled: !!user && open,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase
        .from("boards")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Board[];
    },
  });

  const { data: memberBoardIds = [] } = useQuery<string[]>({
    queryKey: ["vault-board-membership", itemId],
    enabled: !!itemId && open,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase
        .from("board_items")
        .select("board_id")
        .eq("item_id", itemId!);
      if (error) throw error;
      return (data ?? []).map((r: { board_id: string }) => r.board_id);
    },
  });

  const toggle = useMutation({
    mutationFn: async (boardId: string) => {
      if (!itemId) throw new Error("No item selected");
      const alreadyIn = memberBoardIds.includes(boardId);
      if (alreadyIn) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await supabase
          .from("board_items")
          .delete()
          .eq("board_id", boardId)
          .eq("item_id", itemId);
        if (error) throw error;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await supabase
          .from("board_items")
          .insert({ board_id: boardId, item_id: itemId });
        if (error) throw error;
      }
      return boardId;
    },
    onMutate: (boardId) => setTogglingId(boardId),
    onSuccess: (boardId) => {
      qc.invalidateQueries({ queryKey: ["vault-board-membership", itemId] });
      qc.invalidateQueries({ queryKey: ["vault-board-items", boardId] });
      setTogglingId(null);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed");
      setTogglingId(null);
    },
  });

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40 animate-in fade-in" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm bg-background rounded-xl shadow-2xl p-6 animate-in zoom-in-95">
            <div className="flex items-center justify-between mb-4">
              <Dialog.Title className="text-lg font-semibold">Add to Board</Dialog.Title>
              <Dialog.Close className="p-1 rounded hover:bg-muted transition-colors" aria-label="Close">
                <X className="w-4 h-4" />
              </Dialog.Close>
            </div>

            {boards.length === 0 ? (
              <div className="text-center py-6 space-y-3">
                <p className="text-sm text-muted-foreground">No boards yet.</p>
                <button
                  onClick={() => setCreateOpen(true)}
                  className="flex items-center gap-1.5 mx-auto text-sm text-primary font-medium hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" /> Create your first board
                </button>
              </div>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {boards.map((board) => {
                  const isMember = memberBoardIds.includes(board.id);
                  const isLoading = togglingId === board.id;
                  return (
                    <button
                      key={board.id}
                      onClick={() => toggle.mutate(board.id)}
                      disabled={isLoading}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-muted transition-colors text-left"
                    >
                      <span className="text-sm font-medium">{board.name}</span>
                      {isLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      ) : isMember ? (
                        <Check className="w-4 h-4 text-primary" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}

            <button
              onClick={() => setCreateOpen(true)}
              className="mt-3 w-full flex items-center justify-center gap-1.5 border border-dashed border-border rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> New board
            </button>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <CreateBoardModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ["vault-boards", user?.id] });
        }}
      />
    </>
  );
}
