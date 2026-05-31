import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAllCreatives } from "@/hooks/useAllCreatives";
import { useAccounts } from "@/hooks/useAccountsApi";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Search, Check, Loader2, Vault, Images, LayoutGrid, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/** Unified shape persisted into brief.content.visual_inspiration. */
export interface VisualItem {
  ad_id: string;               // creatives.ad_id, or "vault:<uuid>" for vault items
  thumbnail_url: string | null;
  ad_name: string | null;
  unique_code: string | null;
  source: "creative" | "vault";
}

interface Props {
  open: boolean;
  onClose: () => void;
  briefAccountId: string;
  selectedIds: Set<string>;
  onToggle: (item: VisualItem) => void;
}

const VAULT_KEY = (id: string) => `vault:${id}`;

export function CreativePickerModal({ open, onClose, briefAccountId, selectedIds, onToggle }: Props) {
  const { user } = useAuth();
  const { data: accounts = [] } = useAccounts();
  const [tab, setTab] = useState<"vault" | "boards" | "creatives">("vault");
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [openBoardId, setOpenBoardId] = useState<string | null>(null);

  // --- Creatives (synced ad-account creatives) ---
  const { data: allCreatives = [], isLoading: creativesLoading } = useAllCreatives({});

  const creativeResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allCreatives
      .filter((c: any) => accountFilter === "all" || c.account_id === accountFilter)
      .filter((c: any) =>
        !q ||
        (c.ad_name || "").toLowerCase().includes(q) ||
        (c.unique_code || "").toLowerCase().includes(q) ||
        (c.product || "").toLowerCase().includes(q),
      )
      .sort((a: any, b: any) => {
        const am = a.account_id === briefAccountId ? 0 : 1;
        const bm = b.account_id === briefAccountId ? 0 : 1;
        return am - bm;
      })
      .slice(0, 200);
  }, [allCreatives, accountFilter, search, briefAccountId]);

  // --- Vault (curated inspiration_items, user-scoped, ready only) ---
  const { data: vaultItems = [], isLoading: vaultLoading } = useQuery<any[]>({
    queryKey: ["brief-picker-vault", user?.id],
    enabled: !!user && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inspiration_items")
        .select("id, title, brand_name, thumbnail_url, platform, ad_format, status")
        .eq("user_id", user!.id)
        .eq("status", "ready")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const vaultResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vaultItems;
    return vaultItems.filter((v: any) =>
      (v.title || "").toLowerCase().includes(q) ||
      (v.brand_name || "").toLowerCase().includes(q) ||
      (v.ad_format || "").toLowerCase().includes(q),
    );
  }, [vaultItems, search]);

  // --- Boards (user-scoped collections of vault items) ---
  const { data: boards = [], isLoading: boardsLoading } = useQuery<any[]>({
    queryKey: ["brief-picker-boards", user?.id],
    enabled: !!user && open && tab === "boards",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("boards")
        .select("id, name, description, board_items(item_id)")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((b: any) => ({ ...b, itemCount: b.board_items?.length ?? 0 }));
    },
    staleTime: 5 * 60 * 1000,
  });

  const boardResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return boards;
    return boards.filter((b: any) =>
      (b.name || "").toLowerCase().includes(q) ||
      (b.description || "").toLowerCase().includes(q),
    );
  }, [boards, search]);

  // Items inside the opened board (ready only — mirrors the Vault tab filter).
  const { data: boardItems = [], isLoading: boardItemsLoading } = useQuery<any[]>({
    queryKey: ["brief-picker-board-items", openBoardId],
    enabled: !!openBoardId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("board_items")
        .select("item_id, inspiration_items(id, title, brand_name, thumbnail_url, platform, ad_format, status)")
        .eq("board_id", openBoardId!)
        .order("added_at", { ascending: false });
      if (error) throw error;
      return (data ?? [])
        .map((row: any) => row.inspiration_items)
        .filter((v: any) => v && v.status === "ready");
    },
    staleTime: 5 * 60 * 1000,
  });

  const boardItemResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return boardItems;
    return boardItems.filter((v: any) =>
      (v.title || "").toLowerCase().includes(q) ||
      (v.brand_name || "").toLowerCase().includes(q) ||
      (v.ad_format || "").toLowerCase().includes(q),
    );
  }, [boardItems, search]);

  const openBoard = boards.find((b: any) => b.id === openBoardId);

  const accountName = (id: string) => accounts.find((a: any) => a.id === id)?.name || "";

  const Tile = ({
    id, thumb, title, subtitle,
  }: { id: string; thumb: string | null; title: string; subtitle?: string }) => {
    const isSelected = selectedIds.has(id);
    return (
      <button
        onClick={() => {
          if (tab === "creatives") {
            const c = allCreatives.find((x: any) => x.ad_id === id);
            onToggle({
              ad_id: id,
              thumbnail_url: c?.thumbnail_url ?? thumb,
              ad_name: c?.ad_name ?? title,
              unique_code: c?.unique_code ?? null,
              source: "creative",
            });
          } else {
            onToggle({
              ad_id: id, thumbnail_url: thumb, ad_name: title, unique_code: null, source: "vault",
            });
          }
        }}
        className={cn(
          "group relative rounded-lg border text-left overflow-hidden transition-colors",
          isSelected ? "border-verdant ring-2 ring-verdant/40" : "border-border-light hover:border-verdant/50",
        )}
      >
        <div className="aspect-[4/3] bg-muted">
          {thumb ? (
            <img src={thumb} alt={title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[10px] text-muted-foreground">No image</div>
          )}
        </div>
        {isSelected && (
          <div className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-verdant text-white flex items-center justify-center shadow">
            <Check className="h-3 w-3" />
          </div>
        )}
        <div className="p-1.5">
          <p className="font-body text-[11px] text-charcoal truncate">{title || "Untitled"}</p>
          {subtitle && <p className="font-body text-[9px] text-muted-foreground truncate">{subtitle}</p>}
        </div>
      </button>
    );
  };

  // In the boards tab we show either the board list or the opened board's items.
  const inBoardList = tab === "boards" && !openBoard;
  const loading =
    tab === "creatives" ? creativesLoading
      : tab === "boards" ? (openBoard ? boardItemsLoading : boardsLoading)
      : vaultLoading;
  const isEmpty =
    tab === "creatives" ? creativeResults.length === 0
      : tab === "boards" ? (openBoard ? boardItemResults.length === 0 : boardResults.length === 0)
      : vaultResults.length === 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-3 space-y-3">
          <div>
            <DialogTitle className="font-heading text-[18px] text-forest">Link reference creatives</DialogTitle>
            <DialogDescription className="font-body text-[12px] text-muted-foreground">
              Pick from your curated Vault or any synced ad-account creative. Click to select multiple.
            </DialogDescription>
          </div>

          <Tabs value={tab} onValueChange={(v) => { setTab(v as any); setSearch(""); setOpenBoardId(null); }}>
            <TabsList>
              <TabsTrigger value="vault" className="gap-1.5 text-[12px]"><Vault className="h-3.5 w-3.5" /> Vault</TabsTrigger>
              <TabsTrigger value="boards" className="gap-1.5 text-[12px]"><LayoutGrid className="h-3.5 w-3.5" /> Boards</TabsTrigger>
              <TabsTrigger value="creatives" className="gap-1.5 text-[12px]"><Images className="h-3.5 w-3.5" /> All Creatives</TabsTrigger>
            </TabsList>
          </Tabs>

          {tab === "boards" && openBoard && (
            <button
              onClick={() => { setOpenBoardId(null); setSearch(""); }}
              className="flex items-center gap-1 self-start font-body text-[12px] text-verdant hover:underline"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> All boards
            </button>
          )}

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  tab === "vault" ? "Search Vault…"
                    : tab === "boards" ? (openBoard ? `Search ${openBoard.name}…` : "Search boards…")
                    : "Search creatives…"
                }
                className="pl-8 h-9 font-body text-[12px]"
              />
            </div>
            {tab === "creatives" && (
              <Select value={accountFilter} onValueChange={setAccountFilter}>
                <SelectTrigger className="w-44 h-9 font-body text-[12px]">
                  <SelectValue placeholder="All accounts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All accounts</SelectItem>
                  {accounts.map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-[280px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p className="font-body text-[12px]">
                Loading {tab === "vault" ? "Vault" : tab === "boards" ? (openBoard ? openBoard.name : "boards") : "creatives"}…
              </p>
            </div>
          ) : isEmpty ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2 text-center">
              {tab === "vault" ? <Vault className="h-8 w-8" /> : tab === "boards" ? <LayoutGrid className="h-8 w-8" /> : <Images className="h-8 w-8" />}
              <p className="font-body text-[12px]">
                {tab === "vault"
                  ? (vaultItems.length === 0 ? "Your Vault is empty. Save creatives to the Vault from the Creatives page." : "No Vault matches.")
                  : tab === "boards"
                    ? (openBoard
                        ? (boardItems.length === 0 ? "This board has no ready creatives yet." : "No matches in this board.")
                        : (boards.length === 0 ? "No boards yet. Create boards from the Vault to organize creatives." : "No board matches."))
                    : (allCreatives.length === 0 ? "No creatives synced yet." : "No creative matches.")}
              </p>
            </div>
          ) : inBoardList ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {boardResults.map((b: any) => (
                <button
                  key={b.id}
                  onClick={() => { setOpenBoardId(b.id); setSearch(""); }}
                  className="rounded-lg border border-border-light hover:border-verdant/50 text-left overflow-hidden transition-colors"
                >
                  <div className="aspect-[4/3] bg-muted flex items-center justify-center">
                    <LayoutGrid className="h-7 w-7 text-muted-foreground/50" />
                  </div>
                  <div className="p-2">
                    <p className="font-body text-[12px] text-charcoal truncate">{b.name || "Untitled board"}</p>
                    <p className="font-body text-[10px] text-muted-foreground">{b.itemCount} {b.itemCount === 1 ? "item" : "items"}</p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {tab === "creatives"
                ? creativeResults.map((c: any) => (
                    <Tile
                      key={c.ad_id}
                      id={c.ad_id}
                      thumb={c.thumbnail_url}
                      title={c.ad_name || c.unique_code || "Untitled"}
                      subtitle={[c.unique_code, accountName(c.account_id)].filter(Boolean).join(" · ")}
                    />
                  ))
                : (tab === "boards" ? boardItemResults : vaultResults).map((v: any) => (
                    <Tile
                      key={v.id}
                      id={VAULT_KEY(v.id)}
                      thumb={v.thumbnail_url}
                      title={v.title || v.brand_name || "Untitled"}
                      subtitle={[v.brand_name, v.ad_format].filter(Boolean).join(" · ")}
                    />
                  ))}
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-3 border-t border-border-light">
          <span className="mr-auto self-center font-body text-[12px] text-muted-foreground">
            {selectedIds.size} selected
          </span>
          <Button size="sm" onClick={onClose} className="bg-verdant hover:bg-verdant/90 text-white font-body text-[12px]">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
