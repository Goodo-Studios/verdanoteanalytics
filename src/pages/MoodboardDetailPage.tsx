import { useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeft, Plus, Link2, Image as ImageIcon, Trash2, Loader2,
  Share2, Copy, Check, GripVertical, X, Zap, Radar,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useMoodboard, useMoodboardItems,
  useAddMoodboardItem, useRemoveMoodboardItem,
  useUpdateMoodboard, useUpdateMoodboardItem,
  useReorderMoodboardItems,
} from "@/hooks/useMoodboardsApi";
import { useCreatives } from "@/hooks/useCreatives";
import { useSavedAds } from "@/hooks/useCompetitorsApi";
import { useAccountContext } from "@/contexts/AccountContext";
import { toast } from "sonner";

export default function MoodboardDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { selectedAccountId, accounts } = useAccountContext();
  const { data: board } = useMoodboard(id);
  const { data: items = [], isLoading } = useMoodboardItems(id);
  const addItem = useAddMoodboardItem();
  const removeItem = useRemoveMoodboardItem();
  const updateBoard = useUpdateMoodboard();
  const updateItem = useUpdateMoodboardItem();
  const reorder = useReorderMoodboardItems();

  const [showAddCreative, setShowAddCreative] = useState(false);
  const [showAddUrl, setShowAddUrl] = useState(false);
  const [showAddCompetitor, setShowAddCompetitor] = useState(false);
  const [urlForm, setUrlForm] = useState({ url: "", caption: "" });
  const [creativeSearch, setCreativeSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const accountId = selectedAccountId && selectedAccountId !== "all" ? selectedAccountId : accounts[0]?.id;
  const { data: creativesData } = useCreatives(accountId ? { account_id: accountId } : {});
  const allCreatives = creativesData?.data || [];
  const filteredCreatives = creativeSearch
    ? allCreatives.filter((c: any) => c.ad_name?.toLowerCase().includes(creativeSearch.toLowerCase()) || c.unique_code?.toLowerCase().includes(creativeSearch.toLowerCase()))
    : allCreatives.slice(0, 20);

  const { data: savedAds = [] } = useSavedAds(null);

  if (!board) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  const handleAddCreative = (creative: any) => {
    addItem.mutate({
      moodboard_id: board.id,
      type: "creative",
      ad_id: creative.ad_id,
      thumbnail_url: creative.thumbnail_url || undefined,
      caption: creative.ad_name,
      position: items.length,
    });
    setShowAddCreative(false);
  };

  const handleAddUrl = () => {
    if (!urlForm.url) return;
    addItem.mutate({
      moodboard_id: board.id,
      type: urlForm.url.match(/\.(jpg|jpeg|png|gif|webp|svg)/i) ? "image_url" : "url",
      url: urlForm.url,
      thumbnail_url: urlForm.url.match(/\.(jpg|jpeg|png|gif|webp|svg)/i) ? urlForm.url : undefined,
      caption: urlForm.caption || undefined,
      position: items.length,
    });
    setShowAddUrl(false);
    setUrlForm({ url: "", caption: "" });
  };

  const handleAddCompetitorAd = (ad: any) => {
    addItem.mutate({
      moodboard_id: board.id,
      type: "competitor_ad",
      competitor_ad_id: ad.id,
      thumbnail_url: ad.thumbnail_url || undefined,
      caption: ad.ad_creative_body?.slice(0, 100) || "Competitor ad",
      position: items.length,
    });
    setShowAddCompetitor(false);
  };

  const handleShare = async () => {
    if (!board.is_shared) {
      await updateBoard.mutateAsync({ id: board.id, is_shared: true });
    }
    const url = `${window.location.origin}/moodboards/share/${board.share_token}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Share link copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
  };
  const handleDrop = (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) return;
    const reordered = [...items];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(targetIdx, 0, moved);
    reorder.mutate(reordered.map((item, i) => ({ id: item.id, position: i })));
    setDragIdx(null);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={() => navigate("/moodboards")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <h1 className="font-heading text-[24px] text-forest truncate">{board.name}</h1>
              {board.description && (
                <p className="font-body text-[13px] text-muted-foreground truncate">{board.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button size="sm" variant="outline" onClick={handleShare} className="font-body text-[12px] gap-1.5">
              {copied ? <Check className="h-3 w-3" /> : <Share2 className="h-3 w-3" />}
              {copied ? "Copied!" : "Share"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowAddCreative(true)} className="font-body text-[12px] gap-1.5">
              <Zap className="h-3 w-3" /> Add Creative
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowAddUrl(true)} className="font-body text-[12px] gap-1.5">
              <Link2 className="h-3 w-3" /> Add URL
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowAddCompetitor(true)} className="font-body text-[12px] gap-1.5">
              <Radar className="h-3 w-3" /> Add Competitor Ad
            </Button>
          </div>
        </div>

        {/* Masonry grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="glass-panel p-16 text-center">
            <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground/20 mb-4" />
            <h3 className="font-heading text-[18px] text-forest mb-2">Board is empty</h3>
            <p className="font-body text-[13px] text-muted-foreground">
              Add creatives, image URLs, or competitor ads to start building your mood board.
            </p>
          </div>
        ) : (
          <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-4 space-y-4">
            {items.map((item, idx) => (
              <div
                key={item.id}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDrop={() => handleDrop(idx)}
                className="group break-inside-avoid glass-panel overflow-hidden cursor-pointer hover:shadow-card-hover transition-shadow relative"
                onClick={() => setSelectedItem(item)}
              >
                {/* Drag handle */}
                <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <GripVertical className="h-4 w-4 text-muted-foreground/50" />
                </div>
                {/* Remove button */}
                <button
                  onClick={(e) => { e.stopPropagation(); removeItem.mutate(item.id); }}
                  className="absolute top-2 right-2 h-6 w-6 rounded-full bg-background/80 backdrop-blur flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                </button>

                {item.thumbnail_url ? (
                  <img src={item.thumbnail_url} alt="" className="w-full object-cover" loading="lazy" />
                ) : (
                  <div className="aspect-square bg-muted flex items-center justify-center">
                    {item.type === "url" ? (
                      <Link2 className="h-8 w-8 text-muted-foreground/30" />
                    ) : (
                      <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
                    )}
                  </div>
                )}
                {item.caption && (
                  <div className="p-2.5">
                    <p className="font-body text-[11px] text-slate line-clamp-2">{item.caption}</p>
                  </div>
                )}
                {/* Type badge */}
                <div className="absolute bottom-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Badge variant="secondary" className="text-[9px] px-1.5 py-0 capitalize bg-background/80 backdrop-blur">
                    {item.type === "creative" ? "Creative" : item.type === "competitor_ad" ? "Competitor" : "URL"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Creative Modal */}
      <Dialog open={showAddCreative} onOpenChange={setShowAddCreative}>
        <DialogContent className="max-w-lg bg-white rounded-[8px] shadow-modal p-6">
          <DialogHeader>
            <DialogTitle className="font-heading text-[18px] text-forest">Add Creative</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              className="bg-background font-body text-[13px]"
              placeholder="Search creatives by name or code..."
              value={creativeSearch}
              onChange={(e) => setCreativeSearch(e.target.value)}
            />
            <div className="max-h-[300px] overflow-y-auto space-y-1">
              {filteredCreatives.map((c: any) => (
                <button
                  key={c.ad_id}
                  onClick={() => handleAddCreative(c)}
                  className="w-full flex items-center gap-3 p-2 rounded-md hover:bg-accent/40 transition-colors text-left"
                >
                  {c.thumbnail_url ? (
                    <img src={c.thumbnail_url} alt="" className="h-10 w-10 rounded object-cover flex-shrink-0" />
                  ) : (
                    <div className="h-10 w-10 rounded bg-muted flex items-center justify-center flex-shrink-0">
                      <ImageIcon className="h-4 w-4 text-muted-foreground/30" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-body text-[13px] font-medium text-charcoal truncate">{c.ad_name}</p>
                    <p className="font-data text-[11px] text-muted-foreground">{c.unique_code || "No code"}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add URL Modal */}
      <Dialog open={showAddUrl} onOpenChange={setShowAddUrl}>
        <DialogContent className="max-w-md bg-white rounded-[8px] shadow-modal p-6">
          <DialogHeader>
            <DialogTitle className="font-heading text-[18px] text-forest">Add Image URL</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="font-body text-[13px] font-medium text-charcoal">Image URL</Label>
              <Input
                className="bg-background font-body text-[13px]"
                placeholder="https://example.com/image.jpg"
                value={urlForm.url}
                onChange={(e) => setUrlForm((p) => ({ ...p, url: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="font-body text-[13px] font-medium text-charcoal">Caption (optional)</Label>
              <Input
                className="bg-background font-body text-[13px]"
                placeholder="Describe this reference..."
                value={urlForm.caption}
                onChange={(e) => setUrlForm((p) => ({ ...p, caption: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddUrl(false)}>Cancel</Button>
            <Button onClick={handleAddUrl} disabled={!urlForm.url}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Competitor Ad Modal */}
      <Dialog open={showAddCompetitor} onOpenChange={setShowAddCompetitor}>
        <DialogContent className="max-w-lg bg-white rounded-[8px] shadow-modal p-6">
          <DialogHeader>
            <DialogTitle className="font-heading text-[18px] text-forest">Add Competitor Ad</DialogTitle>
          </DialogHeader>
          <div className="max-h-[300px] overflow-y-auto space-y-1">
            {savedAds.length === 0 ? (
              <p className="font-body text-[13px] text-muted-foreground text-center py-4">
                No saved competitor ads. Save ads from the Competitors page first.
              </p>
            ) : (
              savedAds.map((ad: any) => (
                <button
                  key={ad.id}
                  onClick={() => handleAddCompetitorAd(ad)}
                  className="w-full flex items-center gap-3 p-2 rounded-md hover:bg-accent/40 transition-colors text-left"
                >
                  <div className="h-10 w-10 rounded bg-muted flex items-center justify-center flex-shrink-0">
                    <Radar className="h-4 w-4 text-muted-foreground/30" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-body text-[13px] text-charcoal line-clamp-1">
                      {ad.ad_creative_body || `Ad ${ad.ad_archive_id}`}
                    </p>
                    <p className="font-data text-[11px] text-muted-foreground">
                      {ad.platforms?.join(", ") || "Unknown platform"}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Item Detail Modal */}
      <Dialog open={!!selectedItem} onOpenChange={() => setSelectedItem(null)}>
        <DialogContent className="max-w-2xl bg-white rounded-[8px] shadow-modal p-0 overflow-hidden">
          {selectedItem && (
            <>
              {selectedItem.thumbnail_url ? (
                <img src={selectedItem.thumbnail_url} alt="" className="w-full max-h-[60vh] object-contain bg-muted" />
              ) : selectedItem.url ? (
                <div className="p-8 text-center">
                  <a href={selectedItem.url} target="_blank" rel="noopener noreferrer" className="font-body text-[13px] text-primary hover:underline break-all">
                    {selectedItem.url}
                  </a>
                </div>
              ) : (
                <div className="h-[300px] bg-muted flex items-center justify-center">
                  <ImageIcon className="h-12 w-12 text-muted-foreground/20" />
                </div>
              )}
              <div className="p-5 space-y-3">
                <Textarea
                  className="bg-background font-body text-[13px] min-h-[60px]"
                  placeholder="Add a caption..."
                  defaultValue={selectedItem.caption || ""}
                  onBlur={(e) => {
                    if (e.target.value !== (selectedItem.caption || "")) {
                      updateItem.mutate({ id: selectedItem.id, caption: e.target.value });
                    }
                  }}
                />
                <div className="flex items-center justify-between">
                  <Badge variant="secondary" className="text-[10px] capitalize">
                    {selectedItem.type === "creative" ? "Creative" : selectedItem.type === "competitor_ad" ? "Competitor Ad" : "External URL"}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 font-body text-[12px]"
                    onClick={() => { removeItem.mutate(selectedItem.id); setSelectedItem(null); }}
                  >
                    <Trash2 className="h-3 w-3 mr-1" /> Remove
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
