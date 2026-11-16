import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Star, Trash2, Vault, Search, X } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, LoadingState, PageHeader, PageShell } from "@/components/page-kit";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { InspirationCard } from "./components/InspirationCard";
import { CaptureModal } from "./components/CaptureModal";
import {
  FilterToolbar,
  type VaultMediaTypeFilter,
  type VaultSort,
  type VaultStatusFilter,
} from "./components/FilterToolbar";
import { useItemStatus } from "./hooks/useItemStatus";
import { deleteVaultItems, vaultDeleteMessage, type VaultDeleteResult } from "./deleteVaultItems";
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
import {
  isImageFilePath,
  vaultListPollInterval,
  VAULT_PAGE_SIZE,
  VAULT_CARD_COLUMNS,
  type LibraryItem,
} from "./types/vault";
import { buildSignedUrlMap, collectVaultStoragePaths, resolveProvidedSignedUrl } from "./utils/signedUrls";
import { fillVaultPage, type VaultPage } from "./utils/pagination";

const VAULT_STATUSES: VaultStatusFilter[] = ["all", "pending", "ready", "error"];
const VAULT_SORTS: VaultSort[] = ["newest", "oldest"];
const VAULT_MEDIA_TYPES: VaultMediaTypeFilter[] = ["all", "video", "static"];

/** Mounts a `useItemStatus` poller for one in-flight item; renders nothing.
 *
 * `onDone` is called when the item reaches a terminal status so the parent
 * can remove the id from `pollingIds` and unmount this component.
 */
function ActiveItemPoller({ itemId, onDone }: { itemId: string; onDone: (id: string) => void }) {
  useItemStatus(itemId, onDone);
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
  const [searchParams, setSearchParams] = useSearchParams();

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pollingIds, setPollingIds] = useState<string[]>([]);

  // Filters/search/sort live in the URL (not plain useState) so they survive
  // this page unmounting when a card is opened (route change to
  // /ad-library/:id) and remounting on the way back — otherwise every trip
  // into a card silently reset every filter, which read as "the page
  // refreshed". Mirrors the pattern in useCreativesPageState.ts.
  const [status, setStatusState] = useState<VaultStatusFilter>(() => {
    const s = searchParams.get("status");
    return VAULT_STATUSES.includes(s as VaultStatusFilter) ? (s as VaultStatusFilter) : "all";
  });
  const [sort, setSortState] = useState<VaultSort>(() => {
    const s = searchParams.get("sort");
    return VAULT_SORTS.includes(s as VaultSort) ? (s as VaultSort) : "newest";
  });
  const [mediaType, setMediaTypeState] = useState<VaultMediaTypeFilter>(() => {
    const m = searchParams.get("media");
    return VAULT_MEDIA_TYPES.includes(m as VaultMediaTypeFilter) ? (m as VaultMediaTypeFilter) : "all";
  });
  const [activeTag, setActiveTagState] = useState<string | null>(() => searchParams.get("tag"));
  const [searchInput, setSearchInputState] = useState(() => searchParams.get("q") ?? "");
  const [searchQuery, setSearchQueryState] = useState(() => searchParams.get("q") ?? "");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (sort !== "newest") params.set("sort", sort);
    if (mediaType !== "all") params.set("media", mediaType);
    if (activeTag) params.set("tag", activeTag);
    if (searchQuery) params.set("q", searchQuery);
    setSearchParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, sort, mediaType, activeTag, searchQuery]);

  // Keep old setter names below so the rest of the component (and
  // FilterToolbar's prop wiring) doesn't need to change.
  const setStatus = setStatusState;
  const setSort = setSortState;
  const setMediaType = setMediaTypeState;
  const setActiveTag = setActiveTagState;
  const setSearchInput = setSearchInputState;
  const setSearchQuery = setSearchQueryState;

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

  const afterDelete = (result: VaultDeleteResult) => {
    queryClient.invalidateQueries({ queryKey: ["vault-items"] });
    queryClient.invalidateQueries({ queryKey: ["vault-featured"] });
    queryClient.invalidateQueries({ queryKey: ["vault-tags"] });
    const message = vaultDeleteMessage(result);
    if (message.ok) toast.success(message.text);
    else toast.error(message.text);
  };

  const { mutate: bulkDelete, isPending: isDeleting } = useMutation({
    mutationFn: (ids: string[]) => deleteVaultItems(ids),
    onSuccess: (result) => {
      clearSelection();
      afterDelete(result);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Delete failed"),
  });

  // Single delete from a card's menu asks first, like bulk delete (audit 4.6).
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const { mutate: deleteOne, isPending: isDeletingOne } = useMutation({
    mutationFn: (id: string) => deleteVaultItems([id]),
    onSuccess: (result) => {
      setPendingDeleteId(null);
      afterDelete(result);
    },
    onError: (err) => {
      setPendingDeleteId(null);
      toast.error(err instanceof Error ? err.message : "Delete failed");
    },
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
      queryClient.invalidateQueries({ queryKey: ["vault-featured"] });
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

  // Video/static isn't a DB column — it's derived from file_path's extension
  // (same signal InspirationCard uses to decide <img> vs <video>), so it can
  // only be applied after rows come back. fillVaultPage below keeps that from
  // producing half-empty pages.
  const matchesMediaType = useCallback(
    (item: Pick<LibraryItem, "file_path">) => {
      if (mediaType === "all") return true;
      const isStatic = isImageFilePath(item.file_path);
      return mediaType === "static" ? isStatic : !isStatic;
    },
    [mediaType],
  );

  // One shared row-fetcher for both the paged grid and the featured rail.
  const selectItems = useCallback(
    (tag: string | null) => {
      // Explicit column list, not `*`. inspiration_items carries the two AI
      // analysis blobs (script_analysis, visual_analysis) plus ad_body_text,
      // and none of them are rendered on a card — `*` was pulling all of it for
      // every item in the library on each load. The detail page still selects
      // `*` for the single item it shows.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // Tag filtering is an embedded inner join on inspiration_tags (FK item_id -> id),
      // evaluated server-side. The old approach fetched every matching item id first and
      // sent them all in an `in (...)` URL, which hit the 1000-row cap and URL length limits.
      const tagEmbed = tag ? ",\n           inspiration_tags!inner(tag)" : "";
      let q = supabase
        .from("inspiration_items")
        .select(
          `${VAULT_CARD_COLUMNS},
           inspiration_transcripts(cleaned_script),
           inspiration_frameworks(hook_verbal, hook_text, copywriting_framework)${tagEmbed}`,
        )
        .eq("user_id", user!.id)
        .order("created_at", { ascending: sort === "oldest" });

      if (status === "pending") q = q.in("status", ["pending", "extracting", "transcribing", "analyzing"]);
      else if (status === "ready") q = q.eq("status", "ready");
      else if (status === "error") q = q.eq("status", "error");
      if (tag) q = q.eq("inspiration_tags.tag", tag);
      return q;
    },
    [user, sort, status],
  );

  // Paged, not "every row the user has ever saved". A large library used to
  // fetch and mount its entire contents on load; the grid now pulls
  // VAULT_PAGE_SIZE at a time and appends on demand.
  const {
    data: pages,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["vault-items", user?.id, status, sort, activeTag, mediaType],
    enabled: !!user,
    initialPageParam: 0,
    getNextPageParam: (last: VaultPage<LibraryItem>) => last.nextOffset ?? undefined,
    queryFn: async ({ pageParam }) => {
      return fillVaultPage<LibraryItem>({
        startOffset: pageParam as number,
        pageSize: VAULT_PAGE_SIZE,
        matches: matchesMediaType,
        fetchRange: async (from, to) => {
          const { data, error } = await selectItems(activeTag).range(from, to);
          if (error) throw error;
          return (data ?? []) as unknown as LibraryItem[];
        },
      });
    },
    // Was an unconditional 5s poll for as long as the page stayed open —
    // re-downloading the whole filtered list (plus its two joins) even when
    // nothing was processing. Now only polls while something already loaded
    // hasn't reached ready/error yet.
    refetchInterval: (query) =>
      vaultListPollInterval(
        (query.state.data as { pages: VaultPage<LibraryItem>[] } | undefined)?.pages.flatMap(
          (p) => p.items,
        ),
      ),
  });

  const items = useMemo(() => pages?.pages.flatMap((p) => p.items) ?? [], [pages]);

  // Featured is its own query rather than a filter over the grid. Once the grid
  // is paged, a starred item on page 4 would otherwise vanish from the rail
  // until the user happened to scroll far enough to load it.
  const { data: featuredAll = [] } = useQuery<LibraryItem[]>({
    queryKey: ["vault-featured", user?.id, status, sort, activeTag],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await selectItems(activeTag).eq("is_featured", true);
      if (error) throw error;
      return (data ?? []) as unknown as LibraryItem[];
    },
  });

  // Batch-sign every visible item's thumbnail/file storage paths in ONE
  // request instead of letting each InspirationCard mint its own signed URL
  // on mount (previously up to 2 requests per card, fired immediately on
  // page load). staleTime is set just under the 1h signed-URL expiry so the
  // map is refreshed before its links go stale, without re-signing on every
  // render in between.
  //
  // Incident follow-up (2026-08-04): the first version of this had NO
  // fallback — if the single batched call failed for any reason, every card
  // in the grid lost its thumbnail at once (worse than the old per-card
  // calls, where one bad path never affected its neighbors). `retry: false`
  // fails fast instead of spending several seconds retrying before cards can
  // fall back; `signedUrlsSettled` + `resolveProvidedSignedUrl` (below) let
  // each card self-sign as a fallback once the batch call has settled with
  // nothing for its specific path — see signedUrls.ts for the 3-state
  // contract this feeds into InspirationCard's `signed*Url` props.
  const storagePaths = useMemo(
    () => collectVaultStoragePaths([...featuredAll, ...items]),
    [featuredAll, items],
  );
  const {
    data: signedUrlMap,
    status: signedUrlsStatus,
    isPlaceholderData: signedUrlsArePlaceholder,
  } = useQuery({
    queryKey: ["vault-signed-urls", storagePaths],
    enabled: storagePaths.length > 0,
    // The key changes every time infinite scroll appends a page. Without this the map goes
    // undefined while the new batch signs, and every already-loaded thumbnail flickers.
    // Keep the previous map on screen; the fresh one replaces it when it lands.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("inspiration-media")
        .createSignedUrls(storagePaths, 3600);
      if (error) throw error;
      return buildSignedUrlMap(data);
    },
    staleTime: 55 * 60 * 1000,
    retry: false,
  });
  // While the previous map is only a placeholder, cards missing from it must wait for the
  // real batch rather than self-signing one by one.
  const signedUrlsSettled = signedUrlsStatus !== "pending" && !signedUrlsArePlaceholder;

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
  // Grid items are already media-filtered by fillVaultPage; semantic results
  // come straight from the edge function, so they still need the filter here.
  const displayItems = isSemanticMode ? (searchResults ?? []).filter(matchesMediaType) : items;
  const displayLoading = isSemanticMode ? isSearching : isLoading;
  const featuredItems = isSemanticMode ? [] : featuredAll.filter(matchesMediaType);
  // Paging is a grid concern; semantic search returns its whole result set.
  const canLoadMore = !isSemanticMode && hasNextPage;

  // Restore scroll position once real content has rendered — restoring
  // against the loading placeholder would scroll to the wrong offset.
  useScrollRestoration("vault-library", !displayLoading);

  // Infinite scroll: pull the next page as the sentinel below the grid comes
  // into view, so the button is a fallback rather than the only way through.
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !canLoadMore || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [canLoadMore, isFetchingNextPage, fetchNextPage]);

  const handleItemCreated = (itemId: string) => {
    setPollingIds((prev) => [...prev, itemId]);
  };

  const handlePollingDone = (itemId: string) => {
    setPollingIds((prev) => prev.filter((x) => x !== itemId));
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
        onDelete={(id) => setPendingDeleteId(id)}
        useProvidedSignedUrls
        // A path already in the (possibly placeholder) map keeps its URL even while the next
        // batch is signing; only paths with no URL yet wait or fall back.
        signedThumbnailUrl={
          (item.thumbnail_path && signedUrlMap?.[item.thumbnail_path]) ||
          resolveProvidedSignedUrl(item.thumbnail_path, signedUrlMap, signedUrlsSettled)
        }
        signedFileUrl={
          (item.file_path && signedUrlMap?.[item.file_path]) ||
          resolveProvidedSignedUrl(item.file_path, signedUrlMap, signedUrlsSettled)
        }
      />
    );
  };

  return (
    <>
      <PageShell wide>
        <PageHeader
          title="Library"
          description="Your saved ads, videos, and inspiration, automatically transcribed and analyzed."
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
          mediaType={mediaType}
          onMediaTypeChange={setMediaType}
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
              <span className="text-xs text-muted-foreground">Formats to work from this week</span>
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
            <LoadingState label={isSemanticMode ? "Searching the library" : "Loading the library"} variant="cards" count={4} />
          ) : displayItems.length === 0 ? (
            isSemanticMode ? (
            <EmptyState
              icon={<Search className="w-10 h-10" />}
              title={`No results for "${searchQuery}".`}
              action={<Button type="button" variant="link" size="sm" onClick={clearSearch}>Clear search</Button>}
            />
          ) : (
            <EmptyState
              icon={<Vault className="w-10 h-10" />}
              title="No inspiration saved yet."
              action={<Button type="button" variant="link" size="sm" onClick={() => setModalOpen(true)}>Add your first item</Button>}
            />
          )
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {displayItems.map(renderCard)}
              </div>

              {canLoadMore && (
                // The sentinel auto-loads on scroll; the button is the same
                // action for anyone who never reaches it that way (keyboard,
                // reduced motion, no IntersectionObserver).
                <div ref={loadMoreRef} className="flex justify-center pt-8 pb-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                  >
                    {isFetchingNextPage && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                    {isFetchingNextPage ? "Loading…" : "Load more"}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </PageShell>

      {pollingIds.map((id) => (
        <ActiveItemPoller key={id} itemId={id} onDone={handlePollingDone} />
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
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="rounded-full"
                onClick={() => bulkDelete([...selectedIds])}
                disabled={isDeleting}
              >
                {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Yes, delete
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <span className="text-sm font-medium text-foreground">
                {selectedIds.size} selected
              </span>
              <div className="w-px h-4 bg-border" />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full border-destructive/50 text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={clearSelection} title="Deselect all" aria-label="Deselect all">
                <X className="w-4 h-4" />
              </Button>
            </>
          )}
        </div>
      )}

      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open && !isDeletingOne) setPendingDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this item permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              The saved ad, its transcript and its analysis are removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingOne}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeletingOne}
              onClick={(e) => {
                e.preventDefault();
                if (pendingDeleteId) deleteOne(pendingDeleteId);
              }}
            >
              {isDeletingOne && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Yes, delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
