import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  LayoutGrid, Plus, Trash2, Loader2, Image as ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAccountContext } from "@/contexts/AccountContext";
import { useAuth } from "@/contexts/AuthContext";
import { useMoodboards, useCreateMoodboard, useDeleteMoodboard } from "@/hooks/useMoodboardsApi";
import { useNavigate } from "react-router-dom";

export default function MoodboardsPage() {
  const navigate = useNavigate();
  const { selectedAccountId, accounts } = useAccountContext();
  const { user } = useAuth();
  const { data: boards = [], isLoading } = useMoodboards(selectedAccountId);
  const createBoard = useCreateMoodboard();
  const deleteBoard = useDeleteMoodboard();

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });

  const handleCreate = async () => {
    if (!form.name || !user) return;
    const acctId = selectedAccountId && selectedAccountId !== "all" ? selectedAccountId : accounts[0]?.id;
    await createBoard.mutateAsync({
      name: form.name,
      description: form.description || undefined,
      account_id: acctId || undefined,
      created_by: user.id,
    });
    setShowCreate(false);
    setForm({ name: "", description: "" });
  };

  return (
    <AppLayout>
      <PageHeader
        title="Mood Boards"
        description="Collect visual inspiration and creative references"
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)} className="bg-primary text-primary-foreground hover:bg-primary/90 font-body text-[13px] font-semibold rounded-button">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Mood Board
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : boards.length === 0 ? (
        <div className="glass-panel p-16 text-center">
          <LayoutGrid className="h-12 w-12 mx-auto text-muted-foreground/20 mb-4" />
          <h3 className="font-heading text-[18px] text-forest mb-2">No mood boards yet</h3>
          <p className="font-body text-[13px] text-muted-foreground max-w-md mx-auto mb-4">
            Create a mood board to collect creative inspiration from your ads, competitor ads, or any image URL.
          </p>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-3 w-3 mr-1" /> Create your first board
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {boards.map((board: any) => (
            <div
              key={board.id}
              className="group glass-panel overflow-hidden cursor-pointer hover:shadow-card-hover transition-shadow"
              onClick={() => navigate(`/moodboards/${board.id}`)}
            >
              {/* Preview grid */}
              <div className="aspect-[4/3] bg-muted grid grid-cols-2 grid-rows-2 gap-px">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="bg-cream-dark flex items-center justify-center overflow-hidden">
                    {board.preview_thumbnails?.[i] ? (
                      <img
                        src={board.preview_thumbnails[i]}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ImageIcon className="h-5 w-5 text-muted-foreground/20" />
                    )}
                  </div>
                ))}
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-heading text-[15px] text-forest truncate flex-1">{board.name}</h3>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteBoard.mutate(board.id); }}
                    className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground/30 opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-all flex-shrink-0"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                <p className="font-body text-[12px] text-muted-foreground mt-0.5">
                  {board.item_count || 0} item{board.item_count !== 1 ? "s" : ""}
                  {board.is_shared && " · Shared"}
                </p>
                {board.description && (
                  <p className="font-body text-[11px] text-slate mt-1 line-clamp-2">{board.description}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md bg-white rounded-[8px] shadow-modal p-6">
          <DialogHeader>
            <DialogTitle className="font-heading text-[18px] text-forest flex items-center gap-2">
              <LayoutGrid className="h-4 w-4 text-sage" />
              New Mood Board
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="font-body text-[13px] font-medium text-charcoal">Name</Label>
              <Input
                className="bg-background font-body text-[13px]"
                placeholder="e.g. Q1 UGC Inspiration"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="font-body text-[13px] font-medium text-charcoal">Description (optional)</Label>
              <Textarea
                className="bg-background font-body text-[13px] min-h-[60px]"
                placeholder="What is this board for?"
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.name || createBoard.isPending}>
              {createBoard.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
