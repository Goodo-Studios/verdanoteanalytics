import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  LayoutGrid,
  Trash2,
  Loader2,
  AlertCircle,
} from "lucide-react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRolePrefix } from "@/hooks/useRolePath";
import { InspirationCard } from "./components/InspirationCard";
import type { InspirationItem } from "./types/vault";

interface Board {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
}

type BoardItemWithInspiration = {
  id: string;
  board_id: string;
  item_id: string;
  note: string | null;
  added_at: string;
  inspiration_items: InspirationItem & {
    inspiration_transcripts: { cleaned_script: string | null }[];
    inspiration_frameworks: {
      hook_verbal: string | null;
      hook_text: string | null;
      hook_formula: string | null;
      copywriting_framework: string | null;
    }[];
  };
};

/** Board detail — grid of inspiration items inside one board.
 *
 * Removing an item only deletes the `board_items` join row; the underlying
 * inspiration item stays in the user's library.
 */
export default function BoardDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const prefix = useRolePrefix();
  const [deleting, setDeleting] = useState(false);

  const { data: board, isLoading: boardLoading } = useQuery<Board>({
    queryKey: ["vault-board", id],
    enabled: !!id && !!user,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("boards")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as Board;
    },
  });

  const { data: boardItems = [], isLoading: itemsLoading } = useQuery<
    BoardItemWithInspiration[]
  >({
    queryKey: ["vault-board-items", id],
    enabled: !!id && !!user,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("board_items")
        .select(
          `*,
           inspiration_items(
             *,
             inspiration_transcripts(cleaned_script),
             inspiration_frameworks(hook_verbal, hook_text, hook_formula, copywriting_framework)
           )`,
        )
        .eq("board_id", id!)
        .order("added_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as BoardItemWithInspiration[];
    },
  });

  const deleteBoard = useMutation({
    mutationFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("boards")
        .delete()
        .eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Board deleted");
      qc.invalidateQueries({ queryKey: ["vault-boards", user?.id] });
      navigate(`${prefix}/ad-library/boards`);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to delete"),
  });

  const removeItem = useMutation({
    mutationFn: async (boardItemId: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("board_items")
        .delete()
        .eq("id", boardItemId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vault-board-items", id] });
      toast.success("Removed from board");
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to remove"),
  });

  if (boardLoading || itemsLoading) {
    return (
      <AppLayout>
        <div className="min-h-[60vh] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!board) {
    return (
      <AppLayout>
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3">
          <AlertCircle className="w-8 h-8 text-destructive" />
          <p className="text-muted-foreground">Board not found</p>
          <Link
            to={`${prefix}/ad-library/boards`}
            className="text-primary text-sm hover:underline"
          >
            Back to boards
          </Link>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 max-w-7xl mx-auto">
        <div className="mb-2">
          <Link
            to={`${prefix}/ad-library/boards`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Boards
          </Link>
        </div>

        <PageHeader
          title={board.name}
          description={board.description ?? undefined}
          actions={
            <AlertDialog.Root>
              <AlertDialog.Trigger asChild>
                <button
                  className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                  title="Delete board"
                  aria-label="Delete board"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </AlertDialog.Trigger>
              <AlertDialog.Portal>
                <AlertDialog.Overlay className="fixed inset-0 bg-black/50 z-50 animate-in fade-in" />
                <AlertDialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm bg-background rounded-xl shadow-2xl p-6 animate-in zoom-in-95 space-y-4">
                  <AlertDialog.Title className="text-base font-semibold">
                    Delete &ldquo;{board.name}&rdquo;?
                  </AlertDialog.Title>
                  <AlertDialog.Description className="text-sm text-muted-foreground">
                    This removes the board and all its item links. The
                    inspiration items themselves are not deleted.
                  </AlertDialog.Description>
                  <div className="flex justify-end gap-2">
                    <AlertDialog.Cancel asChild>
                      <button className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors">
                        Cancel
                      </button>
                    </AlertDialog.Cancel>
                    <AlertDialog.Action asChild>
                      <button
                        onClick={() => {
                          setDeleting(true);
                          deleteBoard.mutate();
                        }}
                        disabled={deleting}
                        className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
                      >
                        {deleting && (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        )}
                        Delete
                      </button>
                    </AlertDialog.Action>
                  </div>
                </AlertDialog.Content>
              </AlertDialog.Portal>
            </AlertDialog.Root>
          }
        />

        {boardItems.length === 0 ? (
          <div className="text-center py-20 space-y-3">
            <LayoutGrid className="w-12 h-12 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground">No items in this board yet.</p>
            <Link
              to={`${prefix}/ad-library`}
              className="text-primary text-sm font-medium hover:underline"
            >
              Browse library to add items
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {boardItems.map((bi) => {
              const item = bi.inspiration_items;
              const hookPreview =
                item.inspiration_transcripts?.[0]?.cleaned_script?.split("\n")[0] ?? null;
              const fw = item.inspiration_frameworks?.[0];
              const hookVerbal = fw?.hook_verbal ?? hookPreview;
              const hookText = fw?.hook_text ?? null;
              const framework = fw?.copywriting_framework ?? null;
              return (
                <div key={bi.id} className="relative group">
                  <InspirationCard
                    item={item}
                    hookPreview={hookPreview}
                    hookVerbal={hookVerbal}
                    hookText={hookText}
                    framework={framework}
                  />
                  <button
                    onClick={() => removeItem.mutate(bi.id)}
                    className="absolute top-2 right-10 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive z-10"
                    title="Remove from board"
                    aria-label="Remove from board"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
