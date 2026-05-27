import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Flame,
  RefreshCw,
  Eye,
  Heart,
  Share2,
  BookmarkPlus,
  Check,
  ExternalLink,
  TrendingUp,
  Clock,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PLATFORM_LABELS } from "./types/vault";
import ViralDetailPanel, { type ViralDetailItem } from "./components/ViralDetailPanel";

/** A row from the global `viral_feed_items` table.
 *
 * Verdanote's viral feed is global (not workspace-scoped) — see
 * `supabase/migrations/20260527000001_vault_schema.sql` section 9.
 */
export type ViralFeedItem = {
  id: string;
  platform: string;
  source_url: string;
  search_query: string;
  title: string | null;
  description: string | null;
  thumbnail_url: string | null;
  creator_handle: string | null;
  view_count: number | null;
  like_count: number | null;
  share_count: number | null;
  fetched_at: string;
  first_seen_at: string;
  category: string | null;
  is_saved: boolean;
  saved_item_id: string | null;
};

type SortMode = "most_viral" | "trending_now" | "long_running";
const PLATFORMS = ["all", "tiktok"] as const;
type Platform = (typeof PLATFORMS)[number];

const SORT_OPTIONS: { value: SortMode; label: string; icon: typeof TrendingUp }[] = [
  { value: "most_viral", label: "Most Viral", icon: TrendingUp },
  { value: "trending_now", label: "Trending Now", icon: Zap },
  { value: "long_running", label: "Long Running", icon: Clock },
];

function formatCount(n: number | null): string | null {
  if (n == null) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function daysRunning(firstSeenAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(firstSeenAt).getTime()) / 86_400_000));
}

function ViralCard({
  item,
  isInVault,
  isSaving,
  onSave,
  onOpenDetail,
}: {
  item: ViralFeedItem;
  isInVault: boolean;
  isSaving: boolean;
  onSave: (item: ViralFeedItem) => void;
  onOpenDetail: (item: ViralFeedItem) => void;
}) {
  const views = formatCount(item.view_count);
  const likes = formatCount(item.like_count);
  const shares = formatCount(item.share_count);
  const days = daysRunning(item.first_seen_at);
  const isNew = days === 0;
  const saved = item.is_saved || isInVault;

  return (
    <div
      className="rounded-xl border bg-card overflow-hidden flex flex-col cursor-pointer transition-all border-border hover:border-primary/40"
      onClick={() => onOpenDetail(item)}
    >
      <div className="relative aspect-[9/16] bg-muted overflow-hidden">
        {item.thumbnail_url ? (
          <img
            src={item.thumbnail_url}
            alt={item.title ?? ""}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
            No preview
          </div>
        )}
        <span className="absolute top-2 left-2 bg-black/70 text-white text-[10px] font-medium px-2 py-0.5 rounded-full">
          {PLATFORM_LABELS[item.platform] ?? item.platform}
        </span>
        {isNew ? (
          <span className="absolute bottom-2 left-2 flex items-center gap-0.5 bg-orange-500/90 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
            <Flame className="w-2.5 h-2.5" /> New
          </span>
        ) : days <= 14 ? (
          <span className="absolute bottom-2 left-2 flex items-center gap-0.5 bg-blue-600/80 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
            <Clock className="w-2.5 h-2.5" /> {days}d
          </span>
        ) : null}
        <a
          href={item.source_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-full p-1 transition-colors"
          title="Open original"
        >
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      <div className="p-3 flex flex-col gap-2 flex-1">
        {item.creator_handle && (
          <p className="text-xs text-muted-foreground truncate">@{item.creator_handle}</p>
        )}
        {item.title && (
          <p className="text-xs leading-relaxed line-clamp-2 text-foreground">{item.title}</p>
        )}
        {item.category && (
          <span className="self-start bg-secondary text-secondary-foreground text-[10px] font-medium px-1.5 py-0.5 rounded-full">
            {item.category}
          </span>
        )}

        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          {views && (
            <span className="flex items-center gap-1">
              <Eye className="w-3 h-3" /> {views}
            </span>
          )}
          {likes && (
            <span className="flex items-center gap-1">
              <Heart className="w-3 h-3" /> {likes}
            </span>
          )}
          {shares && (
            <span className="flex items-center gap-1">
              <Share2 className="w-3 h-3" /> {shares}
            </span>
          )}
        </div>

        <div className="mt-auto pt-1">
          {saved ? (
            <div className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
              <Check className="w-3.5 h-3.5" /> In Vault
            </div>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSave(item);
              }}
              disabled={isSaving}
              className="flex items-center gap-1.5 w-full justify-center bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <BookmarkPlus className="w-3.5 h-3.5" />
              {isSaving ? "Saving…" : "Save to Vault"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Browse trending ads from the global viral feed (US-008).
 *
 * Differences from `repos/private/creative-vault/src/pages/ViralFeedPage.tsx`:
 *   • viral_feed_items has no workspace_id — feed is global. Reads are
 *     unscoped (RLS allows any authenticated user to select).
 *   • Save action inserts into Verdanote's `inspiration_items` keyed by
 *     `user_id` (Verdanote scopes vault items per-user, not per-workspace).
 *   • No WorkspaceProvider; auth comes from `useAuth()`.
 *   • Wrapped in `AppLayout` + `PageHeader` for sidebar parity.
 *   • Batch select + Send-to-Coda dropped (out of scope for US-008).
 */
export default function ViralFeedPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [platform, setPlatform] = useState<Platform>("all");
  const [sortMode, setSortMode] = useState<SortMode>("most_viral");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pendingFetchSince, setPendingFetchSince] = useState<Date | null>(null);
  const [detailItem, setDetailItem] = useState<ViralDetailItem | null>(null);

  const prevCountRef = useRef(0);

  const sortOrder: { column: string; ascending: boolean } = {
    most_viral: { column: "view_count", ascending: false },
    trending_now: { column: "fetched_at", ascending: false },
    long_running: { column: "first_seen_at", ascending: true },
  }[sortMode];

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["viral-feed", platform, sortMode],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = (supabase as any)
        .from("viral_feed_items")
        .select("*")
        .order(sortOrder.column, { ascending: sortOrder.ascending, nullsFirst: false });

      if (platform !== "all") q = q.eq("platform", platform);

      const { data, error } = await q;
      if (error) throw error;

      const raw = (data ?? []) as ViralFeedItem[];

      // Deduplicate by source_url, keeping the highest-view-count row — the
      // same video scraped across multiple cron runs would otherwise duplicate.
      const best = new Map<string, ViralFeedItem>();
      for (const item of raw) {
        const existing = best.get(item.source_url);
        if (!existing || (item.view_count ?? 0) > (existing.view_count ?? 0)) {
          best.set(item.source_url, item);
        }
      }
      return Array.from(best.values());
    },
    refetchInterval: 10_000,
  });

  // Cross-reference saved URLs in this user's vault. Powers the "In Vault"
  // chip even when viral_feed_items.is_saved hasn't been backfilled.
  const { data: vaultUrlSet = new Set<string>() } = useQuery({
    queryKey: ["vault-urls", user?.id],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("inspiration_items")
        .select("source_url")
        .eq("user_id", user!.id);
      return new Set<string>(
        (data ?? [])
          .map((d: { source_url: string | null }) => d.source_url)
          .filter((u: string | null): u is string => !!u),
      );
    },
  });

  // Toast when polling surfaces new items; clear pending state when results land.
  useEffect(() => {
    if (items.length > prevCountRef.current) {
      if (prevCountRef.current > 0) {
        const n = items.length - prevCountRef.current;
        toast.success(`+${n} new item${n > 1 ? "s" : ""} arrived`);
      }
      if (pendingFetchSince) setPendingFetchSince(null);
    }
    prevCountRef.current = items.length;
  }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    items.forEach((i) => {
      if (i.category) cats.add(i.category);
    });
    return Array.from(cats).sort();
  }, [items]);

  const displayItems = categoryFilter
    ? items.filter((i) => i.category === categoryFilter)
    : items;

  // "Last refreshed" sourced from the most recent fetched_at across the feed.
  const lastRefreshedAt = useMemo(
    () =>
      items.reduce<Date | null>((max, item) => {
        const d = new Date(item.fetched_at);
        return !max || d > max ? d : max;
      }, null),
    [items],
  );

  const counts = {
    all: displayItems.length,
    tiktok: displayItems.filter((i) => i.platform === "tiktok").length,
  };

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not authenticated");
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/vault-viral-refresh`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: platform !== "all" ? platform : undefined,
          max_items: 400,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Refresh failed");
      }
      setPendingFetchSince(new Date());
    } catch (err) {
      console.error("Refresh error:", err);
      toast.error(err instanceof Error ? err.message : "Refresh failed — please try again");
    } finally {
      setIsRefreshing(false);
    }
  };

  // Save a viral item to the user's vault — inserts a pending inspiration_items
  // row, kicks vault-extract to enrich it, and flips viral_feed_items.is_saved
  // so the card flips to "In Vault" without waiting for the next poll.
  const { mutate: saveToVault } = useMutation({
    mutationFn: async (item: ViralFeedItem) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      const token = session?.access_token;
      if (!userId || !token) throw new Error("Not authenticated");

      setSavingIds((prev) => new Set(prev).add(item.id));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: inserted, error: insertErr } = await (supabase as any)
        .from("inspiration_items")
        .insert({
          user_id: userId,
          source_url: item.source_url,
          platform: item.platform,
          title: item.title,
          thumbnail_url: item.thumbnail_url,
          creator_handle: item.creator_handle,
          status: "pending",
        })
        .select("id")
        .single();

      if (insertErr) throw insertErr;
      const newItemId = inserted.id;

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      void fetch(`${supabaseUrl}/functions/v1/vault-extract`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: newItemId }),
      }).catch(console.error);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("viral_feed_items")
        .update({ is_saved: true, saved_item_id: newItemId })
        .eq("id", item.id);

      return { itemId: newItemId };
    },
    onSuccess: (_data, item) => {
      toast.success("Saved to Vault");
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["viral-feed"] });
      queryClient.invalidateQueries({ queryKey: ["vault-urls"] });
      queryClient.invalidateQueries({ queryKey: ["vault-items"] });
    },
    onError: (err, item) => {
      toast.error(err instanceof Error ? err.message : "Save failed");
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    },
  });

  const handleSaveClick = (item: ViralFeedItem) => saveToVault(item);
  const handleOpenDetail = (item: ViralFeedItem) => {
    setDetailItem(item as ViralDetailItem);
  };

  return (
    <AppLayout>
      <div className="p-6 max-w-7xl mx-auto">
        <PageHeader
          title="Viral Feed"
          description={
            lastRefreshedAt
              ? `Trending ads from across the internet — save any to your vault for analysis. · Last refreshed ${formatTimeAgo(lastRefreshedAt)}`
              : "Trending ads from across the internet — save any to your vault for analysis."
          }
          actions={
            <Button onClick={handleRefresh} disabled={isRefreshing} size="sm">
              <RefreshCw className={`w-4 h-4 mr-1 ${isRefreshing ? "animate-spin" : ""}`} />
              {isRefreshing ? "Fetching…" : "Refresh Feed"}
            </Button>
          }
        />

        <div className="mt-6 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground font-medium mr-1">Sort:</span>
            {SORT_OPTIONS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setSortMode(value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                  sortMode === value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <Icon className="w-3 h-3" />
                {label}
              </button>
            ))}
          </div>

          <div className="flex gap-2 flex-wrap">
            {PLATFORMS.map((p) => (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  platform === p
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {p === "all" ? "All" : PLATFORM_LABELS[p] ?? p}
                <span
                  className={`text-xs ${
                    platform === p ? "text-primary-foreground/70" : "text-muted-foreground"
                  }`}
                >
                  {counts[p]}
                </span>
              </button>
            ))}
          </div>

          {availableCategories.length > 0 && (
            <div className="flex gap-2 flex-wrap items-center">
              <span className="text-xs text-muted-foreground font-medium mr-1">Category:</span>
              <button
                onClick={() => setCategoryFilter(null)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  categoryFilter === null
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                All
              </button>
              {availableCategories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat === categoryFilter ? null : cat)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    categoryFilter === cat
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          {isLoading ? (
            <div className="text-center py-20 text-muted-foreground">Loading…</div>
          ) : displayItems.length === 0 ? (
            <div className="text-center py-20 space-y-3">
              <Flame className="w-12 h-12 text-muted-foreground mx-auto" />
              {pendingFetchSince ? (
                <>
                  <p className="text-muted-foreground">Fetching trending ads…</p>
                  <p className="text-sm text-muted-foreground">
                    Results appear here automatically — usually within a minute.
                  </p>
                </>
              ) : categoryFilter ? (
                <p className="text-muted-foreground">
                  No {categoryFilter} videos in this feed.{" "}
                  <button
                    onClick={() => setCategoryFilter(null)}
                    className="text-primary hover:underline"
                  >
                    Clear filter
                  </button>
                </p>
              ) : (
                <>
                  <p className="text-muted-foreground">Your trending library is on its way.</p>
                  <p className="text-sm text-muted-foreground">
                    The feed is refreshed weekly. Hit{" "}
                    <button
                      onClick={handleRefresh}
                      disabled={isRefreshing}
                      className="text-primary hover:underline disabled:opacity-50"
                    >
                      Refresh Feed
                    </button>{" "}
                    to pull the latest now.
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 pb-12">
              {displayItems.map((item) => (
                <ViralCard
                  key={item.id}
                  item={item}
                  isInVault={vaultUrlSet.has(item.source_url)}
                  isSaving={savingIds.has(item.id)}
                  onSave={handleSaveClick}
                  onOpenDetail={handleOpenDetail}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <ViralDetailPanel
        item={detailItem}
        onClose={() => setDetailItem(null)}
        onSave={(item) => {
          setDetailItem(null);
          handleSaveClick(item as ViralFeedItem);
        }}
      />
    </AppLayout>
  );
}
