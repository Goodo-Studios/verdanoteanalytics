import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Check, Copy, ExternalLink, Loader2, Search, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
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

/** A row in inspiration_frameworks that has at least a hook_formula, with its
 * source inspiration_items joined for thumbnail + link-back display. */
interface HookFrameworkRow {
  id: string;
  item_id: string;
  hook_type: string | null;
  hook_formula: string | null;
  fill_in_blank_script: string | null;
  created_at: string;
  inspiration_items: {
    id: string;
    title: string | null;
    brand_name: string | null;
    thumbnail_url: string | null;
    platform: string | null;
  } | null;
}

const HOOK_TYPE_LABELS: Record<string, string> = {
  bold_claim: "Bold Claim",
  pattern_interrupt: "Pattern Interrupt",
  honest_admission: "Honest Admission",
  question: "Question",
  other: "Other",
};

const HOOK_TYPE_COLORS: Record<string, string> = {
  bold_claim: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  pattern_interrupt:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  honest_admission: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  question: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  other: "bg-muted text-muted-foreground",
};

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
      title="Copy fill-in-the-blank script"
      aria-label="Copy fill-in-the-blank script"
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

/** Browse extracted hook formulas across the user's vault.
 *
 * Reads from `inspiration_frameworks` joined to `inspiration_items` (filtered
 * by RLS to the current user). Surfaces hook_formula, fill_in_blank_script,
 * and the source item thumbnail with a deep-link back to ItemDetailPage. */
export default function HooksPage() {
  const { user } = useAuth();
  const prefix = useRolePrefix();
  const [searchInput, setSearchInput] = useState("");
  const [hookType, setHookType] = useState<string>("all");
  const [sort, setSort] = useState<"newest" | "type">("newest");

  const { data: rows = [], isLoading } = useQuery<HookFrameworkRow[]>({
    queryKey: ["vault-hooks", user?.id],
    enabled: !!user,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase
        .from("inspiration_frameworks")
        .select(
          `id, item_id, hook_type, hook_formula, fill_in_blank_script, created_at,
           inspiration_items!inner(id, user_id, title, brand_name, thumbnail_url, platform)`,
        )
        .eq("inspiration_items.user_id", user!.id)
        .not("hook_formula", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as HookFrameworkRow[];
    },
  });

  // Distinct hook_type values present in current data — drives the filter dropdown.
  const availableTypes = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      if (r.hook_type) set.add(r.hook_type);
    });
    return [...set].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    let out = rows;
    if (hookType !== "all") {
      out = out.filter((r) => (r.hook_type ?? "other") === hookType);
    }
    if (q.length > 0) {
      out = out.filter((r) => {
        return (
          (r.hook_formula ?? "").toLowerCase().includes(q) ||
          (r.fill_in_blank_script ?? "").toLowerCase().includes(q) ||
          (r.inspiration_items?.title ?? "").toLowerCase().includes(q) ||
          (r.inspiration_items?.brand_name ?? "").toLowerCase().includes(q)
        );
      });
    }
    if (sort === "type") {
      out = [...out].sort((a, b) => {
        const aType = a.hook_type ?? "zzz";
        const bType = b.hook_type ?? "zzz";
        if (aType !== bType) return aType.localeCompare(bType);
        return (b.created_at ?? "").localeCompare(a.created_at ?? "");
      });
    }
    return out;
  }, [rows, searchInput, hookType, sort]);

  return (
    <AppLayout>
      <div className="p-6 max-w-5xl mx-auto">
        <PageHeader
          title="Hooks"
          description="Extracted hook formulas from your vault — copy a fill-in-the-blank to start a new brief."
        />

        {/* Filter / search toolbar */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search hook text…"
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

          <Select value={hookType} onValueChange={setHookType}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {availableTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {HOOK_TYPE_LABELS[t] ?? t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sort} onValueChange={(v) => setSort(v as "newest" | "type")}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="type">By type</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Results */}
        {isLoading ? (
          <div className="text-center py-20 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading hooks…
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-20 space-y-3">
            <Zap className="w-12 h-12 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground">No hook formulas yet.</p>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Add items to your Library and let the analyzer run — extracted hook
              formulas will appear here.
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
                setHookType("all");
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
              const type = row.hook_type ?? "other";
              const typeColor = HOOK_TYPE_COLORS[type] ?? HOOK_TYPE_COLORS.other;
              const typeLabel = HOOK_TYPE_LABELS[type] ?? type;
              const item = row.inspiration_items;
              const copyText = row.fill_in_blank_script ?? row.hook_formula ?? "";

              return (
                <div
                  key={row.id}
                  className="flex items-start gap-4 p-4 rounded-xl border border-border bg-card hover:shadow-sm hover:border-primary/30 transition-all"
                >
                  {/* Thumbnail link back to source item */}
                  {item && (
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
                  )}

                  {/* Hook content */}
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${typeColor}`}
                      >
                        {typeLabel}
                      </span>
                      {item?.brand_name && (
                        <span className="text-[10px] text-muted-foreground">
                          {item.brand_name}
                        </span>
                      )}
                      {item?.title && (
                        <Link
                          to={`${prefix}/ad-library/${item.id}`}
                          className="text-[10px] text-muted-foreground hover:text-foreground hover:underline truncate max-w-[20rem]"
                        >
                          {item.title}
                        </Link>
                      )}
                    </div>

                    <p className="text-sm font-medium leading-relaxed text-foreground">
                      {row.hook_formula}
                    </p>

                    {row.fill_in_blank_script && (
                      <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap line-clamp-3">
                        {row.fill_in_blank_script}
                      </p>
                    )}
                  </div>

                  {/* Copy action */}
                  <div className="flex-none">
                    <CopyButton text={copyText} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
