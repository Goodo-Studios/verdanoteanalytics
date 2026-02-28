import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Link2, Search, Trophy, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  creative: any;
  onCreativeClick?: (c: any) => void;
}

function useVersionChain(creative: any) {
  const rootId = creative?.parent_ad_id || creative?.ad_id;
  return useQuery({
    queryKey: ["version-chain", rootId],
    enabled: !!rootId,
    queryFn: async () => {
      // Find all creatives sharing the same root
      const { data, error } = await supabase
        .from("creatives")
        .select("ad_id, ad_name, thumbnail_url, created_at, spend, roas, version, parent_ad_id, ad_status")
        .or(`ad_id.eq.${rootId},parent_ad_id.eq.${rootId}`)
        .order("version", { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
    staleTime: 30_000,
  });
}

function useLinkVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ childAdId, parentAdId, newVersion }: { childAdId: string; parentAdId: string; newVersion: number }) => {
      const { error } = await supabase
        .from("creatives")
        .update({ parent_ad_id: parentAdId, version: newVersion } as any)
        .eq("ad_id", childAdId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["version-chain"] });
      queryClient.invalidateQueries({ queryKey: ["creatives"] });
      toast.success("Version linked successfully");
    },
    onError: (e: any) => toast.error("Failed to link version", { description: e.message }),
  });
}

function LinkVersionModal({ creative, open, onClose }: { creative: any; open: boolean; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const linkVersion = useLinkVersion();

  const { data: searchResults = [] } = useQuery({
    queryKey: ["version-search", creative?.account_id, search],
    enabled: open && search.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("creatives")
        .select("ad_id, ad_name, thumbnail_url, created_at, version, parent_ad_id")
        .eq("account_id", creative.account_id)
        .neq("ad_id", creative.ad_id)
        .ilike("ad_name", `%${search}%`)
        .limit(20);
      if (error) throw error;
      return (data || []) as any[];
    },
    staleTime: 10_000,
  });

  const handleLink = (target: any) => {
    // Determine which is the parent (older) and which is the child (newer)
    const creativeDate = new Date(creative.created_at).getTime();
    const targetDate = new Date(target.created_at).getTime();

    let parentAdId: string;
    let childAdId: string;

    if (target.parent_ad_id) {
      // Target already has a parent chain — link to that root
      parentAdId = target.parent_ad_id;
      childAdId = creative.ad_id;
    } else if (creative.parent_ad_id) {
      parentAdId = creative.parent_ad_id;
      childAdId = target.ad_id;
    } else if (creativeDate <= targetDate) {
      parentAdId = creative.ad_id;
      childAdId = target.ad_id;
    } else {
      parentAdId = target.ad_id;
      childAdId = creative.ad_id;
    }

    // Compute next version number
    const currentMax = Math.max(creative.version || 1, target.version || 1);
    const newVersion = childAdId === creative.ad_id ? currentMax + 1 : currentMax + 1;

    linkVersion.mutate(
      { childAdId, parentAdId, newVersion },
      { onSuccess: () => onClose() }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Link as Version</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground mb-3">
          Search for the creative this is a new version of (or vice versa).
        </p>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by creative name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>
        <div className="max-h-[300px] overflow-y-auto space-y-1 mt-2">
          {search.length < 2 && (
            <p className="text-xs text-muted-foreground text-center py-4">Type at least 2 characters to search</p>
          )}
          {searchResults.map((r) => (
            <div
              key={r.ad_id}
              className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
              onClick={() => handleLink(r)}
            >
              <div className="h-10 w-10 rounded bg-muted overflow-hidden shrink-0 flex items-center justify-center">
                {r.thumbnail_url ? (
                  <img src={r.thumbnail_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="text-[10px] text-muted-foreground">—</div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{r.ad_name}</p>
                <p className="text-xs text-muted-foreground">
                  v{r.version || 1} · {new Date(r.created_at).toLocaleDateString()}
                </p>
              </div>
              <Button size="sm" variant="outline" className="shrink-0 text-xs" disabled={linkVersion.isPending}>
                <Link2 className="h-3 w-3 mr-1" />Link
              </Button>
            </div>
          ))}
          {search.length >= 2 && searchResults.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">No matching creatives found</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CreativeVersions({ creative, onCreativeClick }: Props) {
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const { isBuilder, isEmployee } = useAuth();
  const canEdit = isBuilder || isEmployee;
  const { data: versions = [], isLoading } = useVersionChain(creative);

  const hasVersions = versions.length > 1;
  const isPartOfChain = !!creative.parent_ad_id || versions.some((v: any) => v.parent_ad_id === creative.ad_id);

  // Find best version
  const best = useMemo(() => {
    if (versions.length < 2) return null;
    return versions.reduce((a: any, b: any) =>
      (Number(b.roas) || 0) > (Number(a.roas) || 0) ? b : a
    );
  }, [versions]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-label text-[11px] font-semibold uppercase tracking-wider text-foreground">
          Versions
        </h4>
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => setLinkModalOpen(true)}
          >
            <Link2 className="h-3 w-3" />Link as Version
          </Button>
        )}
      </div>

      {isLoading && <p className="text-xs text-muted-foreground">Loading versions...</p>}

      {!isLoading && !hasVersions && (
        <p className="text-xs text-muted-foreground">
          No linked versions. {canEdit ? "Use \"Link as Version\" to connect related creatives." : ""}
        </p>
      )}

      {hasVersions && (
        <>
          {/* Horizontal timeline */}
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {versions.map((v: any, idx: number) => {
              const prevVersion = idx > 0 ? versions[idx - 1] : null;
              const roasDelta = prevVersion
                ? (Number(v.roas) || 0) - (Number(prevVersion.roas) || 0)
                : null;
              const spendDelta = prevVersion
                ? (Number(v.spend) || 0) - (Number(prevVersion.spend) || 0)
                : null;
              const isCurrent = v.ad_id === creative.ad_id;
              const isBest = best && v.ad_id === best.ad_id;

              return (
                <div key={v.ad_id} className="flex items-center gap-1 shrink-0">
                  {idx > 0 && <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                  <div
                    className={`relative p-2 rounded-md border cursor-pointer transition-colors min-w-[120px] ${
                      isCurrent
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50"
                    }`}
                    onClick={() => !isCurrent && onCreativeClick?.(v)}
                  >
                    {isBest && (
                      <div className="absolute -top-2 -right-2">
                        <Trophy className="h-4 w-4 text-amber-500" />
                      </div>
                    )}
                    <div className="h-12 w-full rounded bg-muted overflow-hidden mb-1.5">
                      {v.thumbnail_url ? (
                        <img src={v.thumbnail_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center text-[10px] text-muted-foreground">No img</div>
                      )}
                    </div>
                    <Badge variant="secondary" className="text-[10px] mb-1">
                      v{v.version || 1}
                    </Badge>
                    <div className="text-[11px] font-medium tabular-nums">
                      {(Number(v.roas) || 0).toFixed(2)}x · ${(Number(v.spend) || 0).toFixed(0)}
                    </div>
                    {roasDelta !== null && (
                      <div className={`text-[10px] tabular-nums ${roasDelta >= 0 ? "text-[hsl(var(--success))]" : "text-[hsl(var(--destructive))]"}`}>
                        {roasDelta >= 0 ? "+" : ""}{roasDelta.toFixed(1)}x ROAS
                        {spendDelta !== null && ` · ${spendDelta >= 0 ? "+" : ""}$${Math.abs(spendDelta).toFixed(0)}`}
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {new Date(v.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Best version callout */}
          {best && versions.length >= 2 && (
            <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50 border border-border">
              <Trophy className="h-4 w-4 text-amber-500 shrink-0" />
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Best version: v{best.version || 1}</span>
                {" "}({(Number(best.roas) || 0).toFixed(2)}x ROAS, ${(Number(best.spend) || 0).toFixed(0)} spend)
              </p>
            </div>
          )}
        </>
      )}

      <LinkVersionModal creative={creative} open={linkModalOpen} onClose={() => setLinkModalOpen(false)} />
    </div>
  );
}
