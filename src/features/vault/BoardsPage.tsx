import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, LayoutGrid } from "lucide-react";
import { EmptyState, LoadingState, PageHeader, PageShell } from "@/components/page-kit";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRolePrefix } from "@/hooks/useRolePath";
import { CreateBoardModal } from "./components/CreateBoardModal";

interface Board {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
}

interface BoardWithCount extends Board {
  itemCount: number;
}

/** Boards index — list of all user-scoped boards.
 *
 * Verdanote scopes boards by `user_id` (no workspace). Each card links to
 * `${prefix}/ad-library/boards/:id` for the detail view.
 */
export default function BoardsPage() {
  const { user } = useAuth();
  const prefix = useRolePrefix();
  const [createOpen, setCreateOpen] = useState(false);

  const { data: boards = [], isLoading } = useQuery<BoardWithCount[]>({
    queryKey: ["vault-boards", user?.id],
    enabled: !!user,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase
        .from("boards")
        .select("*, board_items(item_id)")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(
        (b: Board & { board_items: { item_id: string }[] }) => ({
          ...b,
          itemCount: b.board_items?.length ?? 0,
        }),
      ) as BoardWithCount[];
    },
  });

  return (
    <>
      <PageShell wide>
        <PageHeader
          title="Boards"
          description="Organize saved inspiration into named collections."
          actions={
            <Button onClick={() => setCreateOpen(true)} size="sm">
              <Plus className="w-4 h-4 mr-1" />
              New Board
            </Button>
          }
        />

        {isLoading ? (
          <LoadingState label="Loading boards" variant="cards" count={4} />
        ) : boards.length === 0 ? (
          <EmptyState
            icon={<LayoutGrid className="w-10 h-10" />}
            title="No boards yet."
            action={
              <Button variant="link" size="sm" onClick={() => setCreateOpen(true)}>
                Create your first board
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {boards.map((board) => (
              <Link
                key={board.id}
                to={`${prefix}/ad-library/boards/${board.id}`}
                className="group block rounded-xl border border-border bg-card p-5 hover:shadow-md transition-shadow space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-base group-hover:text-primary transition-colors leading-snug line-clamp-2">
                    {board.name}
                  </h3>
                  <LayoutGrid className="w-4 h-4 shrink-0 text-muted-foreground" />
                </div>
                {board.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {board.description}
                  </p>
                )}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-muted-foreground">
                    {board.itemCount} {board.itemCount === 1 ? "item" : "items"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(board.created_at).toLocaleDateString()}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}

        <CreateBoardModal open={createOpen} onOpenChange={setCreateOpen} />
      </PageShell>
    </>
  );
}
