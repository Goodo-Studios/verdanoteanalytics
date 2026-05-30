import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Check, Copy, ExternalLink, Loader2, Search, Star, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRolePrefix } from "@/hooks/useRolePath";

/** A single starred hook entry — one item can produce up to three (verbal, text, visual). */
interface HookEntry {
  /** Unique key for React rendering: `{itemId}-{kind}` */
  key: string;
  itemId: string;
  kind: "verbal" | "text" | "visual";
  hookText: string;
  item: {
    id: string;
    title: string | null;
    brand_name: string | null;
    thumbnail_url: string | null;
    platform: string | null;
  };
  createdAt: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copied!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <button
      onClick={handleCopy}
      type="button"
      title="Copy hook text"
      aria-label="Copy hook text"
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 text-green-500" />
          Copied
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5" />
          Copy
        </>
      )}
    </button>
  );
}

/** Browse your curated Hook Library — only hooks you've starred in an item's
 * detail page appear here, so the list stays focused on your best-performing
 * formats rather than every extracted formula. */
export default function HooksPage() {
  const { user } = useAuth();
  const prefix = useRolePrefix();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "verbal" | "text" | "visual">("all");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: items = [], isLoading } = useQuery<any[]>({
    queryKey: ["vault-hooks", user?.id],
    enabled: !!user,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("inspiration_items")
        .select(
          `id, title, brand_name, thumbnail_url, platform, created_at,
           hook_verbal_saved, hook_text_saved, hook_visual_saved,
           inspiration_frameworks(id, hook_verbal, hook_text, hook_visual)`,
        )
        .eq("user_id", user!.id)
        .or("hook_verbal_saved.eq.true,hook_text_saved.eq.true,hook_visual_saved.eq.true")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Flatten items × kinds into individual hook entries for display.
  const allRows = useMemo<HookEntry[]>(() => {
    const entries: HookEntry[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const item of items as any[]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fw = Array.isArray(item.inspiration_frameworks) ? item.inspiration_frameworks[0] : null;
      const itemMeta = {
        id: item.id,
        title: item.title,
        brand_name: item.brand_name,
        thumbnail_url: item.thumbnail_url,
        platform: item.platform,
      };
      if (item.hook_verbal_saved && fw?.hook_verbal) {
        entries.push({
          key: `${item.id}-verbal`,
          itemId: item.id,
          kind: "verbal",
          hookText: fw.hook_verbal,
          item: itemMeta,
          createdAt: item.created_at,
        });
      }
      if (item.hook_text_saved && fw?.hook_text) {
        entries.push({
          key: `${item.id}-text`,
          itemId: item.id,
          kind: "text",
          hookText: fw.hook_text,
          item: itemMeta,
          createdAt: item.created_at,
        });
      }
      if (item.hook_visual_saved && fw?.hook_visual) {
        entries.push({
          key: `${item.id}-visual`,
          itemId: item.id,
          kind: "visual",
          hookText: fw.hook_visual,
          item: itemMeta,
          createdAt: item.created_at,
        });
      }
    }
    return entries;
  }, [items]);

  const { mutate: unstar } = useMutation({
    mutationFn: async ({
      itemId,
      field,
    }: {
      itemId: string;
      field: "hook_verbal_saved" | "hook_text_saved" | "hook_visual_saved";
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("inspiration_items")
        .update({ [field]: false })
        .eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vault-hooks"] });
      // Also refresh the item detail if it happens to be open in the background.
      queryClient.invalidateQueries({ queryKey: ["vault-item"] });
      toast.success("Removed from Hook Library");
    },
    onError: () => toast.error("Failed to remove hook"),
  });

  const filtered = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    let out = allRows;
    if (kindFilter !== "all") {
      out = out.filter((r) => r.kind === kindFilter);
    }
    if (q.length > 0) {
      out = out.filter((r) => {
        return (
          r.hookText.toLowerCase().includes(q) ||
          (r.item.title ?? "").toLowerCase().includes(q) ||
          (r.item.brand_name ?? "").toLowerCase().includes(q)
        );
      });
    }
    return out;
  }, [allRows, searchInput, kindFilter]);

  return (
    <>
      <div className="p-6 max-w-5xl mx-auto">
        <PageHeader
          title="Hooks"
          description="Your curated hook library — star hooks from any item detail page to save them here."
        />

        {/* Starred competitor-vault hooks */}
        <h2 className="text-lg font-semibold text-foreground mb-1">Starred Hooks</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Hooks you've starred from item detail pages.
        </p>

        {/* Filter / search toolbar */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search hooks…"
              className="pl-9 pr-9"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
                type="button"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <Select value={kindFilter} onValueChange={(v) => setKindFilter(v as "all" | "verbal" | "text" | "visual")}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="All kinds" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              <SelectItem value="verbal">Verbal</SelectItem>
              <SelectItem value="text">On-screen text</SelectItem>
              <SelectItem value="visual">Visual</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Results */}
        {isLoading ? (
          <div className="text-center py-20 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading hooks…
          </div>
        ) : allRows.length === 0 ? (
          <div className="text-center py-20 space-y-3">
            <Zap className="w-12 h-12 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground">Your hook library is empty.</p>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Open any item in your library, go to the Framework tab, and click
              the <Star className="inline w-3.5 h-3.5 mb-0.5" /> star next to a
              verbal, on-screen text, or visual hook to add it here.
            </p>
            <Link
              to={`${prefix}/ad-library`}
              className="inline-block text-primary text-sm font-medium hover:underline"
            >
              Open Library →
            </Link>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 space-y-2">
            <p className="text-muted-foreground">No hooks match your filters.</p>
            <button
              onClick={() => {
                setSearchInput("");
                setKindFilter("all");
              }}
              type="button"
              className="text-primary text-sm font-medium hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((row) => {
              const item = row.item;
              const starField =
                row.kind === "verbal"
                  ? "hook_verbal_saved"
                  : row.kind === "visual"
                    ? "hook_visual_saved"
                    : "hook_text_saved";

              return (
                <div
                  key={row.key}
                  className="flex items-start gap-4 p-4 rounded-xl border border-border bg-card hover:shadow-sm hover:border-primary/30 transition-all"
                >
                  {/* Thumbnail — links back to source item */}
                  <Link
                    to={`${prefix}/ad-library/${item.id}`}
                    className="flex-none w-16 h-24 rounded-lg overflow-hidden bg-muted relative group"
                    title={item.title ?? "View source item"}
                  >
                    {item.thumbnail_url ? (
                      <img
                        src={item.thumbnail_url}
                        alt={item.title ?? ""}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-[10px] text-center px-1">
                        No thumb
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                      <ExternalLink className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </Link>

                  {/* Hook content */}
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Hook kind badge */}
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                        {row.kind === "verbal" ? "Verbal" : row.kind === "visual" ? "Visual" : "On-screen Text"}
                      </span>
                      {item.brand_name && (
                        <span className="text-[10px] text-muted-foreground">
                          {item.brand_name}
                        </span>
                      )}
                      {item.title && (
                        <Link
                          to={`${prefix}/ad-library/${item.id}`}
                          className="text-[10px] text-muted-foreground hover:text-foreground hover:underline truncate max-w-[20rem]"
                        >
                          {item.title}
                        </Link>
                      )}
                    </div>

                    <p className="text-sm font-medium leading-relaxed text-foreground">
                      {row.hookText}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex-none flex flex-col items-end gap-2">
                    <button
                      type="button"
                      onClick={() => unstar({ itemId: row.itemId, field: starField })}
                      title="Remove from Hook Library"
                      className="p-1 rounded hover:bg-muted-foreground/10 transition-colors text-amber-500"
                    >
                      <Star className="w-4 h-4 fill-amber-500" />
                    </button>
                    <CopyButton text={row.hookText} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
