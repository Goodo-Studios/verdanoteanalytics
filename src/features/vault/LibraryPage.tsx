import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Star, Trash2, Vault, Search, X } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { InspirationCard } from "./components/InspirationCard";
import { CaptureModal } from "./components/CaptureModal";
import {
  FilterToolbar,
  type VaultSort,
  type VaultStatusFilter,
} from "./components/FilterToolbar";
import { useItemStatus } from "./hooks/useItemStatus";
import type { LibraryItem, VaultPlatformFilter } from "./types/vault";

/** Mounts a `useItemStatus` poller for one in-flight item; renders nothing. */
function ActiveItemPoller({ itemId }: { itemId: string }) {
  useItemStatus(itemId);
  return null;
}

/** Core Creative Vault library page (replaces Verdanote AdLibraryPage).
 *
 * Behaviour parity with `repos/private/creative-vault/src/pages/LibraryPage.tsx`
 * with these intentional differences:
 *   • Uses Verdanote `useAuth()` for the current user; no WorkspaceProvider.
 *   • inspiration_items rows are scoped by `user_id` rather than `workspace_id`.
 *   • Wrapped in Verdanote's `AppLayout` + `PageHeader` shells.
 *   • The "folders" tab from the old Ad Library is dropped per US-006 notes.
 */
export default function LibraryPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [platform, setPlatform] = useState<VaultPlatformFilter>("all");
  const [status, setStatus] = useState<VaultStatusFilter>("all");
  const [sort, setSort] = useState<VaultSort>("newest");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [pollingIds, setPollingIds] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setConfirmDelete(false);
  };

  const { mutate: bulkDelete, isPending: isDeleting } = useMutation({
    mutationFn: async (ids: string[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await supabase
        .from("inspiration_items")
        .delete()
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vault-items"] });
      queryClient.invalidateQueries({ queryKey: ["vault-tags"] });
      clearSelection();
      toast.success("Deleted");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Delete failed"),
  });

  const { mutate: deleteOne } = useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await supabase
        .from("inspiration_items")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vault-items"] });
      queryClient.invalidateQueries({ queryKey: ["vault-tags"] });
      toast.success("Deleted");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Delete failed"),
  });

  const { mutate: toggleFeatured } = useMutation({
    mutationFn: async ({ id, featured }: { id: string; featured: boolean }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await supabase
        .from("inspiration_items")
        .update({ is_featured: featured })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vault-items"] });
    },
  });

  const handleSearchChange = (val: string) => {
    setSearchInput(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearchQuery(val.trim()), 600);
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearchQuery("");
  };

  // All tags (for the chip rail), scoped to the user's items.
  const { data: allTags = [] } = useQuery({
    queryKey: ["vault-tags", user?.id],
    enabled: !!user,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase
        .from("inspiration_tags")
        .select("tag, inspiration_items!inner(user_id)")
        .eq("inspiration_items.user_id", user!.id);
      if (error) throw error;
      const unique = [...new Set((data ?? []).map((r: { tag: string }) => r.tag))].sort();
      return unique as string[];
    },
  });

  const { data: items = [], isLoading } = useQuery<LibraryItem[]>({
    queryKey: ["vault-items", user?.id, platform, status, sort, activeTag],
    enabled: !!user,
    queryFn: async () => {
      let tagItemIds: string[] | null = null;
      if (activeTag) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: tagRows, error: tagErr } = await supabase
          .from("inspiration_tags")
          .select("item_id")
          .eq("tag", activeTag);
        if (tagErr) throw tagErr;
        tagItemIds = (tagRows ?? []).map((r: { item_id: string }) => r.item_id);
        if (tagItemIds.length === 0) return [];
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = supabase
        .from("inspiration_items")
        .select(
          `*,
           inspiration_transcripts(cleaned_script),
           inspiration_frameworks(hook_verbal, hook_text, hook_formula, copywriting_framework)`,
        )
        .eq("user_id", user!.id)
        .order("created_at", { ascending: sort === "oldest" });

      if (platform !== "all") q = q.eq("platform", platform);
      if (status === "pending") q = q.in("status", ["pending", "extracting", "transcribing", "analyzing"]);
      else if (status === "ready") q = q.eq("status", "ready");
      else if (status === "error") q = q.eq("status", "error");
      if (tagItemIds) q = q.in("id", tagItemIds);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as LibraryItem[];
    },
    refetchInterval: 5000,
  });

  // Semantic search results from vault-search edge function.
  const { data: searchResults, isFetching: isSearching } = useQuery<LibraryItem[]>({
    queryKey: ["vault-search", searchQuery],
    enabled: searchQuery.length >= 3,
    queryFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/vault-search`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      return data.items as LibraryItem[];
    },
  });

  const isSemanticMode = searchQuery.length >= 3;
  const displayItems = isSemanticMode ? searchResults ?? [] : items;
  const displayLoading = isSemanticMode ? isSearching : isLoading;
  const featuredItems = isSemanticMode ? [] : items.filter((i) => i.is_featured);

  const handleItemCreated = (itemId: string) => {
    setPollingIds((prev) => [...prev, itemId]);
  };

  const renderCard = (item: LibraryItem) => {
    const hookPreview = item.inspiration_transcripts?.[0]?.cleaned_script?.split("\n")[0] ?? null;
    const fw = item.inspiration_frameworks?.[0];
    const hookVerbal = fw?.hook_verbal ?? hookPreview;
    const hookText = fw?.hook_text ?? null;
    const framework = fw?.copywriting_framework ?? null;
    return (
      <InspirationCard
        key={item.id}
        item={item}
        hookPreview={hookPreview}
        hookVerbal={hookVerbal}
        hookText={hookText}
        framework={framework}
        selected={selectedIds.has(item.id)}
        onSelect={toggleSelect}
        onToggleFeatured={(id, val) => toggleFeatured({ id, featured: val })}
        onDelete={(id) => deleteOne(id)}
      />
    );
  };

  return (
    <AppLayout>
      <div className="p-6 max-w-7xl mx-auto">
        <PageHeader
          title="Library"
          description="Your saved ads, videos, and inspiration — automatically transcribed and analyzed."
          actions={
            <Button onClick={() => setModalOpen(true)} size="sm">
              <Plus className="w-4 h-4 mr-1" />
              Add
            </Button>
          }
        />

        <FilterToolbar
          searchInput={searchInput}
          onSearchChange={handleSearchChange}
          onSearchClear={clearSearch}
          isSemanticMode={isSemanticMode}
          searchQuery={searchQuery}
          platform={platform}
          onPlatformChange={setPlatform}
          status={status}
          onStatusChange={setStatus}
          sort={sort}
          onSortChange={setSort}
          allTags={allTags}
          activeTag={activeTag}
          onTagToggle={(tag) => setActiveTag(activeTag === tag ? null : tag)}
        />

        {featuredItems.length > 0 && (
          <div className="space-y-2 mt-6">
            <div className="flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
              <h2 className="text-sm font-semibold">Featured</h2>
              <span className="text-xs text-muted-foreground">— formats to work from this week</span>
            </div>
            <div
              className="flex gap-3 overflow-x-auto pb-2"
              style={{ scrollbarWidth: "none" }}
            >
              {featuredItems.map((item) => (
                <div key={item.id} className="flex-none w-36">
                  {renderCard(item)}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6">
          {displayLoading ? (
            <div className="text-center py-20 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              {isSemanticMode ? "Searching…" : "Loading…"}
            </div>
          ) : displayItems.length === 0 ? (
            <div className="text-center py-20 space-y-3">
              {isSemanticMode ? (
                <>
                  <Search className="w-12 h-12 text-muted-foreground mx-auto" />
                  <p className="text-muted-foreground">No results for "{searchQuery}".</p>
                  <button
                    onClick={clearSearch}
                    className="text-primary text-sm font-medium hover:underline"
                  >
                    Clear search
                  </button>
                </>
              ) : (
                <>
                  <Vault className="w-12 h-12 text-muted-foreground mx-auto" />
                  <p className="text-muted-foreground">No inspiration saved yet.</p>
                  <button
                    onClick={() => setModalOpen(true)}
                    className="text-primary text-sm font-medium hover:underline"
                  >
                    Add your first item
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {displayItems.map(renderCard)}
            </div>
          )}
        </div>
      </div>

      {pollingIds.map((id) => (
        <ActiveItemPoller key={id} itemId={id} />
      ))}

      <CaptureModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onItemCreated={handleItemCreated}
      />

      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 bg-background border border-border rounded-full shadow-xl px-5 py-3 animate-in slide-in-from-bottom-4">
          {confirmDelete ? (
            <>
              <span className="text-sm font-medium text-destructive">
                Delete {selectedIds.size} item{selectedIds.size !== 1 ? "s" : ""} permanently?
              </span>
              <div className="w-px h-4 bg-border" />
              <button
                onClick={() => bulkDelete([...selectedIds])}
                disabled={isDeleting}
                className="flex items-center gap-1.5 bg-destructive text-destructive-foreground rounded-full px-4 py-1.5 text-sm font-medium hover:bg-destructive/90 transition-colors disabled:opacity-50"
              >
                {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Yes, delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <span className="text-sm font-medium text-foreground">
                {selectedIds.size} selected
              </span>
              <div className="w-px h-4 bg-border" />
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 border border-destructive/50 text-destructive rounded-full px-4 py-1.5 text-sm font-medium hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
              <button
                onClick={clearSelection}
                className="p-1 rounded-full text-muted-foreground hover:text-foreground transition-colors"
                title="Deselect all"
                aria-label="Deselect all"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      )}
    </AppLayout>
  );
}
