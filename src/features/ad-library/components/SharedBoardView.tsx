import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AdLibraryBoard, AdLibrarySavedAd } from "@/features/ad-library/types/ad-library";
import { AdGrid } from "./AdGrid";
import { LayoutGrid, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  shareToken: string;
}

export function SharedBoardView({ shareToken }: Props) {
  const [board, setBoard] = useState<AdLibraryBoard | null>(null);
  const [ads, setAds] = useState<AdLibrarySavedAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      // Fetch board by share token
      const { data: boardData, error: boardErr } = await supabase
        .from("ad_library_boards" as any)
        .select("*")
        .eq("share_token", shareToken)
        .eq("is_public", true)
        .single();

      if (boardErr || !boardData) {
        setError("Board not found or is no longer public.");
        setLoading(false);
        return;
      }

      const b = boardData as unknown as AdLibraryBoard;
      setBoard(b);

      // Fetch ads in this board
      const { data: boardAds } = await supabase
        .from("ad_library_board_ads" as any)
        .select("ad_id")
        .eq("board_id", b.id)
        .order("position", { ascending: true });

      const adIds = (boardAds || []).map((ba: any) => ba.ad_id);
      if (adIds.length === 0) {
        setAds([]);
        setLoading(false);
        return;
      }

      const { data: adsData } = await supabase
        .from("ad_library_saved_ads" as any)
        .select("*")
        .in("id", adIds);

      setAds((adsData || []) as unknown as AdLibrarySavedAd[]);
      setLoading(false);
    }
    load();
  }, [shareToken]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-6 w-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !board) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center px-6">
        <LayoutGrid className="h-12 w-12 text-muted-foreground/20 mb-4" />
        <p className="font-heading text-lg text-foreground mb-2">Board Not Found</p>
        <p className="font-body text-sm text-muted-foreground">{error || "This board doesn't exist or is no longer shared."}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Minimal header */}
      <div className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="font-heading text-lg text-foreground">{board.name}</h1>
            {board.description && (
              <p className="font-body text-sm text-muted-foreground mt-0.5">{board.description}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1 tabular-nums">{ads.length} ads</p>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="max-w-6xl mx-auto px-6 py-6">
        <AdGrid ads={ads} loading={false} />
      </div>

      {/* CTA */}
      <div className="border-t border-border bg-card/50">
        <div className="max-w-6xl mx-auto px-6 py-8 text-center">
          <p className="font-heading text-base text-foreground mb-2">Build your own ad library</p>
          <p className="font-body text-sm text-muted-foreground mb-4">Save, organize, and analyze ads from across the web.</p>
          <Button className="gap-2" onClick={() => window.location.href = "/"}>
            <ExternalLink className="h-4 w-4" /> Get Started
          </Button>
        </div>
      </div>
    </div>
  );
}
