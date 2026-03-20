import { useState, useCallback, useEffect } from "react";
import { useSavedAds, useUpdateSavedAd, useDeleteSavedAd, useAdLibraryBoards, useAddToBoard, useRemoveFromBoard, useAdLibraryTags, useToggleAdTag } from "@/features/ad-library/hooks/useAdLibrary";
import type { AdLibrarySavedAd } from "@/features/ad-library/types/ad-library";
import { TagEditor } from "./TagEditor";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft, ExternalLink, Copy, Trash2, Calendar, Globe, Image, Video, Layers,
  Facebook, Instagram, ChevronLeft, ChevronRight, LayoutGrid, X, ZoomIn,
  Loader2, RefreshCw, Captions,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  adId: string;
  onBack?: () => void;
}

const platformIcon: Record<string, typeof Facebook> = { facebook: Facebook, instagram: Instagram };

const isVideoUrl = (url: string) => /\.(mp4|webm|mov|m3u8|avi)(\?|$)/i.test(url);
const isFakeSourceUrl = (url: string) => /^https:\/\/tryatria\.com\/saved\//i.test(url);

export function AdDetailView({ adId, onBack }: Props) {
  const { data: allAds = [] } = useSavedAds();
  const ad = allAds.find((a) => a.id === adId);
  const updateAd = useUpdateSavedAd();
  const deleteAd = useDeleteSavedAd();
  const { data: boards = [] } = useAdLibraryBoards();
  const addToBoard = useAddToBoard();
  const removeFromBoard = useRemoveFromBoard();
  const { data: allTags = [] } = useAdLibraryTags();
  const toggleTag = useToggleAdTag();
  const qc = useQueryClient();

  // Editable fields
  const [headline, setHeadline] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [notes, setNotes] = useState("");
  const [transcript, setTranscript] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);

  // Sync state when ad changes
  useEffect(() => {
    if (ad) {
      setHeadline(ad.headline || "");
      setBodyText(ad.body_text || "");
      setNotes(ad.notes || "");
      setTranscript((ad as any).transcript || "");
    }
  }, [ad?.id]);

  const saveField = useCallback((field: string, value: string) => {
    if (!ad) return;
    updateAd.mutate({ id: ad.id, [field]: value } as any);
  }, [ad, updateAd]);

  const triggerTranscription = useCallback(async () => {
    if (!ad) return;
    const videoUrl = ad.media_urls?.find((u) => u.match(/\.(mp4|webm|mov)/i)) || ad.media_urls?.[0] || ad.thumbnail_url;
    if (!videoUrl) {
      toast.error("No video URL available");
      return;
    }
    setIsTranscribing(true);
    try {
      const { data, error } = await supabase.functions.invoke("transcribe-ad", {
        body: { ad_id: ad.id, video_url: videoUrl },
      });
      if (error) throw error;
      if (data?.success) {
        setTranscript(data.transcript);
        qc.invalidateQueries({ queryKey: ["ad-library-saved-ads"] });
        toast.success("Transcription complete");
      } else {
        toast.error(data?.error || "Transcription failed");
      }
    } catch (e: any) {
      toast.error("Transcription failed: " + e.message);
    } finally {
      setIsTranscribing(false);
    }
  }, [ad, qc]);

  if (!ad) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground text-sm">Ad not found</p>
        {onBack && <Button variant="ghost" size="sm" onClick={onBack} className="mt-2">Go back</Button>}
      </div>
    );
  }

  const PlatformIcon = platformIcon[ad.platform || ""] || Facebook;
  const mediaUrls = ad.media_urls?.length ? ad.media_urls : ad.thumbnail_url ? [ad.thumbnail_url] : [];
  const isVideo = ad.ad_format === "video";
  const isCarousel = ad.ad_format === "carousel" || mediaUrls.length > 1;
  const adTagIds = (ad.tags || []).map((t) => t.id);

  // Find boards this ad is in
  const adBoardIds: string[] = []; // We'd need board_ads query; for now derive from boards hook
  // Simple approach: we don't have a direct query, so we'll show "Add to Board" only

  const handleTagChange = (newTagIds: string[]) => {
    const currentIds = new Set(adTagIds);
    const newSet = new Set(newTagIds);
    // Added
    newTagIds.filter((id) => !currentIds.has(id)).forEach((tagId) => {
      toggleTag.mutate({ ad_id: ad.id, tag_id: tagId });
    });
    // Removed
    adTagIds.filter((id) => !newSet.has(id)).forEach((tagId) => {
      toggleTag.mutate({ ad_id: ad.id, tag_id: tagId, remove: true });
    });
  };

  const handleCopyLandingPage = () => {
    if (ad.landing_page_url) {
      navigator.clipboard.writeText(ad.landing_page_url);
      toast.success("URL copied");
    }
  };

  const handleDeleteConfirm = () => {
    deleteAd.mutate(ad.id, { onSuccess: () => onBack?.() });
    setShowDelete(false);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        {onBack && (
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="flex-1 min-w-0">
          <h2 className="font-heading text-lg text-foreground truncate">{ad.advertiser_name || "Ad Detail"}</h2>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => window.open(ad.source_url, "_blank")}>
          <ExternalLink className="h-3.5 w-3.5" /> View Original
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left column — media */}
        <div className="lg:col-span-3 space-y-4">
          {/* Media preview */}
          <div className="relative rounded-card overflow-hidden border border-border bg-muted">
            {isCarousel && mediaUrls.length > 1 ? (
              <div className="relative">
                <div className="aspect-[4/3] overflow-hidden cursor-pointer" onClick={() => { setLightboxIdx(0); setLightboxOpen(true); }}>
                  <img src={mediaUrls[lightboxIdx] || mediaUrls[0]} className="h-full w-full object-contain" alt="" />
                </div>
                {/* Carousel dots */}
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                  {mediaUrls.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setLightboxIdx(i)}
                      className={cn(
                        "h-2 w-2 rounded-full transition-colors",
                        i === lightboxIdx ? "bg-primary" : "bg-foreground/20"
                      )}
                    />
                  ))}
                </div>
                {/* Nav arrows */}
                {lightboxIdx > 0 && (
                  <button onClick={() => setLightboxIdx((i) => i - 1)} className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-card/80 backdrop-blur-sm flex items-center justify-center hover:bg-card transition-colors">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                )}
                {lightboxIdx < mediaUrls.length - 1 && (
                  <button onClick={() => setLightboxIdx((i) => i + 1)} className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-card/80 backdrop-blur-sm flex items-center justify-center hover:bg-card transition-colors">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                )}
              </div>
            ) : mediaUrls.length > 0 ? (
              <div
                className="aspect-[4/3] overflow-hidden cursor-pointer group"
                onClick={() => { setLightboxIdx(0); setLightboxOpen(true); }}
              >
                <img src={mediaUrls[0]} className="h-full w-full object-contain" alt="" />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-foreground/5">
                  <ZoomIn className="h-6 w-6 text-foreground/60" />
                </div>
              </div>
            ) : (
              <div className="aspect-[4/3] flex items-center justify-center">
                <Image className="h-16 w-16 text-muted-foreground/20" />
              </div>
            )}
          </div>

          {/* CTA preview */}
          {ad.cta_text && (
            <div className="flex items-center gap-3">
              <Button variant="default" size="sm" className="pointer-events-none text-xs">{ad.cta_text}</Button>
              <span className="text-[11px] text-muted-foreground">CTA Preview</span>
            </div>
          )}
        </div>

        {/* Right column — details */}
        <div className="lg:col-span-2 space-y-5">
          {/* Badges */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {ad.platform && (
              <Badge variant="outline" className="text-[10px] gap-1 uppercase font-label">
                <PlatformIcon className="h-2.5 w-2.5" /> {ad.platform}
              </Badge>
            )}
            {ad.ad_format && (
              <Badge variant="outline" className="text-[10px] capitalize font-label">{ad.ad_format}</Badge>
            )}
            {ad.ad_status && (
              <Badge variant={ad.ad_status === "active" ? "default" : "secondary"} className="text-[10px] capitalize font-label">
                {ad.ad_status}
              </Badge>
            )}
          </div>

          {/* Dates & targeting */}
          <div className="space-y-2 text-xs text-muted-foreground">
            {ad.started_running && (
              <div className="flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5" />
                <span>Started {format(new Date(ad.started_running), "MMM d, yyyy")}</span>
              </div>
            )}
            {ad.country_targeting && ad.country_targeting.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <Globe className="h-3.5 w-3.5 flex-shrink-0" />
                {ad.country_targeting.map((c) => (
                  <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Headline — editable */}
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground font-label">Headline</Label>
            <Input
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              onBlur={() => headline !== (ad.headline || "") && saveField("headline", headline)}
              className="h-8 text-sm font-medium"
              placeholder="No headline"
            />
          </div>

          {/* Body text — editable */}
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground font-label">Body Text</Label>
            <Textarea
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              onBlur={() => bodyText !== (ad.body_text || "") && saveField("body_text", bodyText)}
              rows={4}
              className="text-sm"
              placeholder="No body text"
            />
          </div>

          {/* Landing page */}
          {ad.landing_page_url && (
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground font-label">Landing Page</Label>
              <div className="flex items-center gap-1.5">
                <a
                  href={ad.landing_page_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline truncate flex-1"
                >
                  {ad.landing_page_url}
                </a>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleCopyLandingPage}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )}

          <Separator />

          {/* Tags */}
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground font-label">Tags</Label>
            <TagEditor selectedTagIds={adTagIds} onChange={handleTagChange} allowCreate />
          </div>

          {/* Add to board */}
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground font-label">Boards</Label>
            {boards.length > 0 ? (
              <Select onValueChange={(boardId) => addToBoard.mutate({ board_id: boardId, ad_id: ad.id })}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Add to board..." />
                </SelectTrigger>
                <SelectContent>
                  {boards.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-xs text-muted-foreground">No boards created yet</p>
            )}
          </div>

          {/* Notes — auto-save on blur */}
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground font-label">Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== (ad.notes || "") && saveField("notes", notes)}
              rows={3}
              className="text-sm"
              placeholder="Your notes about this ad..."
            />
          </div>

          {/* Video Transcript */}
          {isVideo && (
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground font-label flex items-center gap-1.5">
                <Captions className="h-3 w-3" /> Video Transcript
              </Label>
              {((ad as any).transcript_status === "processing" || isTranscribing) && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Transcribing video...
                </div>
              )}
              {(ad as any).transcript_status === "completed" && transcript && !isTranscribing && (
                <div className="space-y-2">
                  <div className="bg-muted/40 border border-border rounded-md p-3">
                    <Textarea
                      value={transcript}
                      onChange={(e) => setTranscript(e.target.value)}
                      onBlur={() => transcript !== ((ad as any).transcript || "") && saveField("transcript", transcript)}
                      rows={5}
                      className="text-xs bg-transparent border-0 p-0 resize-none focus-visible:ring-0 leading-relaxed"
                      placeholder="Transcript text..."
                    />
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[11px] gap-1"
                      onClick={() => {
                        navigator.clipboard.writeText(transcript);
                        toast.success("Transcript copied");
                      }}
                    >
                      <Copy className="h-3 w-3" /> Copy Transcript
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[11px] gap-1"
                      onClick={triggerTranscription}
                      disabled={isTranscribing}
                    >
                      <RefreshCw className="h-3 w-3" /> Re-transcribe
                    </Button>
                  </div>
                </div>
              )}
              {(ad as any).transcript_status === "failed" && !isTranscribing && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-destructive">Transcription failed</span>
                  <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={triggerTranscription}>
                    <RefreshCw className="h-3 w-3" /> Retry
                  </Button>
                </div>
              )}
              {((ad as any).transcript_status === "none" || !(ad as any).transcript_status) && !isTranscribing && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5 w-full"
                  onClick={triggerTranscription}
                >
                  <Captions className="h-3.5 w-3.5" /> Transcribe Video
                </Button>
              )}
            </div>
          )}

          <Separator />

          {/* Metadata */}
          <div className="space-y-1 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <span>Saved</span>
              <span className="tabular-nums">{format(new Date(ad.created_at), "MMM d, yyyy")}</span>
            </div>
            {ad.ad_id && (
              <div className="flex justify-between">
                <span>Ad ID</span>
                <span className="font-mono text-[10px]">{ad.ad_id}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>Format</span>
              <span className="capitalize">{ad.ad_format || "Unknown"}</span>
            </div>
          </div>

          {/* Delete */}
          <Button
            variant="outline"
            size="sm"
            className="w-full text-destructive border-destructive/20 hover:bg-destructive/5 gap-1.5 text-xs"
            onClick={() => setShowDelete(true)}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete Ad
          </Button>
        </div>
      </div>

      {/* Lightbox */}
      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent className="max-w-4xl p-0 bg-black/95 border-0">
          <div className="relative flex items-center justify-center min-h-[60vh]">
            {mediaUrls[lightboxIdx] && (
              <img src={mediaUrls[lightboxIdx]} className="max-h-[85vh] max-w-full object-contain" alt="" />
            )}
            <button onClick={() => setLightboxOpen(false)} className="absolute top-4 right-4 text-white/70 hover:text-white">
              <X className="h-5 w-5" />
            </button>
            {isCarousel && lightboxIdx > 0 && (
              <button onClick={() => setLightboxIdx((i) => i - 1)} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white">
                <ChevronLeft className="h-8 w-8" />
              </button>
            )}
            {isCarousel && lightboxIdx < mediaUrls.length - 1 && (
              <button onClick={() => setLightboxIdx((i) => i + 1)} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white">
                <ChevronRight className="h-8 w-8" />
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading">Delete Ad?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove this ad from your library and all boards.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDeleteConfirm}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
