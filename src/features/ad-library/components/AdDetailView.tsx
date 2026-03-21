import { useState, useCallback, useEffect, useRef } from "react";
import { useSavedAds, useUpdateSavedAd, useDeleteSavedAd, useAdLibraryBoards, useAddToBoard, useRemoveFromBoard, useAdLibraryTags, useToggleAdTag } from "@/features/ad-library/hooks/useAdLibrary";
import type { AdLibrarySavedAd, StoredMediaItem } from "@/features/ad-library/types/ad-library";
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
  Facebook, Instagram, ChevronLeft, ChevronRight, X, ZoomIn,
  Loader2, RefreshCw, Captions, Download, Play, AlertTriangle, Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  adId: string;
  onBack?: () => void;
}

const platformIcon: Record<string, typeof Facebook> = { facebook: Facebook, instagram: Instagram };

/** Heuristic: does the thumbnail look like a profile pic / logo? */
function looksLikeProfilePic(ad: any): boolean {
  const storedMedia = (ad.stored_media || []) as any[];
  const successfulMedia = storedMedia.filter((m: any) => !m.download_failed && m.stored_url);
  // If we have proper stored media with videos or large files, it's fine
  if (successfulMedia.some((m: any) => m.type === "video" || m.file_size_bytes > 50000)) return false;
  // If no stored media and thumbnail URL looks like a profile pic
  const thumb = ad.thumbnail_url || "";
  if (/\/profile|\/avatar|\/logo|page_picture|p\d{2,3}x\d{2,3}|s\d{2,3}x\d{2,3}/i.test(thumb)) return true;
  // If stored media is empty and no media_urls
  if (successfulMedia.length === 0 && (!ad.media_urls || ad.media_urls.length === 0)) return true;
  return false;
}

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
  const { user } = useAuth();
  const qc = useQueryClient();

  const [headline, setHeadline] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [notes, setNotes] = useState("");
  const [transcript, setTranscript] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [currentMediaIdx, setCurrentMediaIdx] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isRefetching, setIsRefetching] = useState(false);
  const [isUploadingCreative, setIsUploadingCreative] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ad) {
      setHeadline(ad.headline || "");
      setBodyText(ad.body_text || "");
      setNotes(ad.notes || "");
      setTranscript((ad as any).transcript || "");
      setCurrentMediaIdx(0);
    }
  }, [ad?.id]);

  const saveField = useCallback((field: string, value: string) => {
    if (!ad) return;
    updateAd.mutate({ id: ad.id, [field]: value } as any);
  }, [ad, updateAd]);

  const triggerTranscription = useCallback(async () => {
    if (!ad) return;
    const videoUrl = ad.media_urls?.find((u) => u.match(/\.(mp4|webm|mov)/i)) || ad.media_urls?.[0] || ad.thumbnail_url;
    if (!videoUrl) { toast.error("No video URL available"); return; }
    setIsTranscribing(true);
    try {
      const { data, error } = await supabase.functions.invoke("transcribe-ad", { body: { ad_id: ad.id, video_url: videoUrl } });
      if (error) throw error;
      if (data?.success) {
        setTranscript(data.transcript);
        qc.invalidateQueries({ queryKey: ["ad-library-saved-ads"] });
        toast.success("Transcription complete");
      } else { toast.error(data?.error || "Transcription failed"); }
    } catch (e: any) { toast.error("Transcription failed: " + e.message); }
    finally { setIsTranscribing(false); }
  }, [ad, qc]);

  const handleRefetchMedia = useCallback(async () => {
    if (!ad || !ad.source_url || isFakeSourceUrl(ad.source_url)) {
      toast.error("No valid source URL to re-fetch from");
      return;
    }
    setIsRefetching(true);
    try {
      const { data, error } = await supabase.functions.invoke("scrape-ad", { body: { url: ad.source_url } });
      if (error) throw error;
      if (data?.success && data.data) {
        const updates: any = {};
        if (data.data.stored_media?.length) updates.stored_media = data.data.stored_media;
        if (data.data.thumbnail_url) updates.thumbnail_url = data.data.thumbnail_url;
        if (data.data.media_urls?.length) updates.media_urls = data.data.media_urls;
        if (data.data.ad_format) updates.ad_format = data.data.ad_format;
        if (Object.keys(updates).length > 0) {
          updateAd.mutate({ id: ad.id, ...updates } as any);
          qc.invalidateQueries({ queryKey: ["ad-library-saved-ads"] });
          toast.success("Media re-fetched successfully");
        } else {
          toast.info("No new media found");
        }
      } else {
        toast.error(data?.error || "Re-fetch failed — Facebook may have blocked the request");
      }
    } catch (e: any) { toast.error("Re-fetch failed: " + e.message); }
    finally { setIsRefetching(false); }
  }, [ad, updateAd, qc]);

  const handleUploadCreative = useCallback(async (file: File) => {
    if (!ad || !user) return;
    setIsUploadingCreative(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const isVid = file.type.startsWith("video/");
      const existingMedia: any[] = (ad as any).stored_media || [];
      const position = existingMedia.length;
      const mediaType = isVid ? "video" : "image";
      const path = `${user.id}/${ad.id.slice(0, 8)}/${position}_${mediaType}.${ext}`;

      const { error: uploadError } = await supabase.storage.from("ad-media").upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("ad-media").getPublicUrl(path);
      const newItem = { original_url: "", stored_url: urlData.publicUrl, type: mediaType, mime_type: file.type, file_size_bytes: file.size, position };
      const newMedia = [...existingMedia, newItem];

      updateAd.mutate({ id: ad.id, stored_media: newMedia, thumbnail_url: urlData.publicUrl, ad_format: isVid ? "video" : ad.ad_format } as any);
      qc.invalidateQueries({ queryKey: ["ad-library-saved-ads"] });
      toast.success(`${isVid ? "Video" : "Image"} uploaded successfully`);
    } catch (e: any) { toast.error("Upload failed: " + e.message); }
    finally { setIsUploadingCreative(false); }
  }, [ad, user, updateAd, qc]);


  if (!ad) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground text-sm">Ad not found</p>
        {onBack && <Button variant="ghost" size="sm" onClick={onBack} className="mt-2">Go back</Button>}
      </div>
    );
  }

  const PlatformIcon = platformIcon[ad.platform || ""] || Facebook;
  const storedMedia: StoredMediaItem[] = (ad as any).stored_media || [];
  const successfulMedia = storedMedia.filter(m => !m.download_failed && m.stored_url);
  const failedMedia = storedMedia.filter(m => m.download_failed);

  // Build display media: prefer stored_media, fall back to media_urls/thumbnail
  const displayMedia: { url: string; type: "image" | "video" | "carousel_frame" | "video_thumbnail"; original?: string }[] = [];
  if (successfulMedia.length > 0) {
    // Sort by position, put videos first for video ads, exclude video_thumbnail from main display
    const mainMedia = successfulMedia.filter(m => m.type !== "video_thumbnail");
    mainMedia.sort((a, b) => {
      // Videos come first
      if (a.type === "video" && b.type !== "video") return -1;
      if (b.type === "video" && a.type !== "video") return 1;
      return a.position - b.position;
    });
    mainMedia.forEach(m => {
      displayMedia.push({ url: m.stored_url, type: m.type as any, original: m.original_url });
    });
  }
  // Fall back to media_urls/thumbnail if no stored media
  if (displayMedia.length === 0) {
    const mediaUrls = ad.media_urls?.length ? ad.media_urls : ad.thumbnail_url ? [ad.thumbnail_url] : [];
    mediaUrls.forEach(u => displayMedia.push({ url: u, type: isVideoUrl(u) ? "video" : "image" }));
  }

  const isVideo = ad.ad_format === "video";
  const hasStoredVideo = successfulMedia.some(m => m.type === "video");
  const isCarousel = ad.ad_format === "carousel" || displayMedia.filter(m => m.type !== "video").length > 1;
  const adTagIds = (ad.tags || []).map((t) => t.id);
  const currentMedia = displayMedia[currentMediaIdx] || displayMedia[0];

  const handleTagChange = (newTagIds: string[]) => {
    const currentIds = new Set(adTagIds);
    const newSet = new Set(newTagIds);
    newTagIds.filter((id) => !currentIds.has(id)).forEach((tagId) => toggleTag.mutate({ ad_id: ad.id, tag_id: tagId }));
    adTagIds.filter((id) => !newSet.has(id)).forEach((tagId) => toggleTag.mutate({ ad_id: ad.id, tag_id: tagId, remove: true }));
  };

  const handleCopyLandingPage = () => {
    if (ad.landing_page_url) { navigator.clipboard.writeText(ad.landing_page_url); toast.success("URL copied"); }
  };

  const handleDeleteConfirm = () => {
    deleteAd.mutate(ad.id, { onSuccess: () => onBack?.() });
    setShowDelete(false);
  };

  const handleDownload = async (url: string, filename?: string) => {
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename || url.split("/").pop() || "download";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      toast.success("Download started");
    } catch { toast.error("Download failed"); }
  };

  const changePlaybackRate = () => {
    const rates = [0.5, 1, 1.5, 2];
    const next = rates[(rates.indexOf(playbackRate) + 1) % rates.length];
    setPlaybackRate(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  };

  const renderMediaPreview = () => {
    if (displayMedia.length === 0) {
      return (
        <div className="aspect-[4/3] flex items-center justify-center">
          <Image className="h-16 w-16 text-muted-foreground/20" />
        </div>
      );
    }

    const media = displayMedia[currentMediaIdx] || displayMedia[0];
    const isCurrentVideo = media.type === "video" || isVideoUrl(media.url);

    return (
      <div className="relative">
        <div className="aspect-[4/3] overflow-hidden">
          {isCurrentVideo ? (
            <video
              ref={videoRef}
              src={media.url}
              className="h-full w-full object-contain"
              controls
              playsInline
              onLoadedMetadata={() => { if (videoRef.current) videoRef.current.playbackRate = playbackRate; }}
            />
          ) : (
            <div
              className="h-full w-full cursor-pointer group relative"
              onClick={() => { setLightboxIdx(currentMediaIdx); setLightboxOpen(true); }}
            >
              <img src={media.url} className="h-full w-full object-contain" alt="" />
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-foreground/5">
                <ZoomIn className="h-6 w-6 text-foreground/60" />
              </div>
            </div>
          )}
        </div>

        {/* Carousel navigation */}
        {displayMedia.length > 1 && (
          <>
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
              {displayMedia.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentMediaIdx(i)}
                  className={cn("h-2 w-2 rounded-full transition-colors", i === currentMediaIdx ? "bg-primary" : "bg-foreground/20")}
                />
              ))}
            </div>
            {currentMediaIdx > 0 && (
              <button onClick={() => setCurrentMediaIdx(i => i - 1)} className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-card/80 backdrop-blur-sm flex items-center justify-center hover:bg-card transition-colors">
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {currentMediaIdx < displayMedia.length - 1 && (
              <button onClick={() => setCurrentMediaIdx(i => i + 1)} className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-card/80 backdrop-blur-sm flex items-center justify-center hover:bg-card transition-colors">
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </>
        )}

        {/* Video speed control */}
        {isCurrentVideo && (
          <button
            onClick={changePlaybackRate}
            className="absolute top-2 right-2 h-7 px-2 rounded-md bg-card/80 backdrop-blur-sm text-[11px] font-label font-semibold hover:bg-card transition-colors"
          >
            {playbackRate}x
          </button>
        )}
      </div>
    );
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
        {ad.source_url && !isFakeSourceUrl(ad.source_url) && (
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => window.open(ad.source_url, "_blank")}>
            <ExternalLink className="h-3.5 w-3.5" /> View Original
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left column — media */}
        <div className="lg:col-span-3 space-y-4">
          <div className="relative rounded-card overflow-hidden border border-border bg-muted">
            {renderMediaPreview()}
          </div>

          {/* Media action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {currentMedia && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => handleDownload(currentMedia.url, `${ad.advertiser_name || "ad"}-${currentMediaIdx}.${currentMedia.type === "video" ? "mp4" : "jpg"}`)}
              >
                <Download className="h-3.5 w-3.5" />
                Download {currentMedia.type === "video" ? "Video" : "Image"}
              </Button>
            )}
            {isCarousel && displayMedia.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={async () => {
                  toast.info("Downloading all frames...");
                  for (let i = 0; i < displayMedia.length; i++) {
                    await handleDownload(displayMedia[i].url, `${ad.advertiser_name || "ad"}-frame-${i + 1}.jpg`);
                  }
                }}
              >
                <Layers className="h-3.5 w-3.5" />
                Download All ({displayMedia.length})
              </Button>
            )}
          </div>

          {/* Missing creative warning */}
          {looksLikeProfilePic(ad) && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground flex-1">
                <p className="font-medium text-foreground">Only a thumbnail was captured for this ad</p>
                <p className="mt-0.5">The saved image may be a brand logo instead of the actual ad creative. Re-fetch to get the real media, or upload it manually.</p>
                <div className="flex gap-2 mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px] gap-1"
                    onClick={handleRefetchMedia}
                    disabled={isRefetching || isFakeSourceUrl(ad.source_url)}
                  >
                    {isRefetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Re-fetch Media
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px] gap-1"
                    onClick={() => uploadInputRef.current?.click()}
                    disabled={isUploadingCreative}
                  >
                    {isUploadingCreative ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                    Upload Creative
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Failed media warning */}
          {failedMedia.length > 0 && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground">
                <p className="font-medium text-foreground">{failedMedia.length} media file{failedMedia.length > 1 ? "s" : ""} couldn't be downloaded</p>
                <p className="mt-0.5">The original source may have expired. You can re-save with new URLs.</p>
              </div>
            </div>
          )}

          {/* Hidden file input for upload creative */}
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUploadCreative(file);
              e.target.value = "";
            }}
          />

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
            {successfulMedia.length > 0 && (
              <Badge variant="outline" className="text-[10px] font-label gap-1 text-emerald-600 border-emerald-500/20 bg-emerald-500/5">
                <Download className="h-2.5 w-2.5" /> {successfulMedia.length} stored
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
                <a href={ad.landing_page_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline truncate flex-1">
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
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Add to board..." /></SelectTrigger>
                <SelectContent>
                  {boards.map((b) => (<SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-xs text-muted-foreground">No boards created yet</p>
            )}
          </div>

          {/* Notes */}
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
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Transcribing video...
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
                    <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1" onClick={() => { navigator.clipboard.writeText(transcript); toast.success("Transcript copied"); }}>
                      <Copy className="h-3 w-3" /> Copy Transcript
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1" onClick={triggerTranscription} disabled={isTranscribing}>
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
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 w-full" onClick={triggerTranscription}>
                  <Captions className="h-3.5 w-3.5" /> Transcribe Video
                </Button>
              )}
            </div>
          )}

          <Separator />

          {/* Metadata */}
          <div className="space-y-1 text-xs text-muted-foreground">
            <div className="flex justify-between"><span>Saved</span><span className="tabular-nums">{format(new Date(ad.created_at), "MMM d, yyyy")}</span></div>
            {ad.ad_id && (<div className="flex justify-between"><span>Ad ID</span><span className="font-mono text-[10px]">{ad.ad_id}</span></div>)}
            <div className="flex justify-between"><span>Format</span><span className="capitalize">{ad.ad_format || "Unknown"}</span></div>
            {successfulMedia.length > 0 && (
              <div className="flex justify-between">
                <span>Stored files</span>
                <span className="tabular-nums">{successfulMedia.length} ({(successfulMedia.reduce((s, m) => s + m.file_size_bytes, 0) / (1024 * 1024)).toFixed(1)} MB)</span>
              </div>
            )}
          </div>

          {/* Delete */}
          <Button variant="outline" size="sm" className="w-full text-destructive border-destructive/20 hover:bg-destructive/5 gap-1.5 text-xs" onClick={() => setShowDelete(true)}>
            <Trash2 className="h-3.5 w-3.5" /> Delete Ad
          </Button>
        </div>
      </div>

      {/* Lightbox */}
      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent className="max-w-4xl p-0 bg-black/95 border-0">
          <div className="relative flex items-center justify-center min-h-[60vh]">
            {displayMedia[lightboxIdx] && (
              isVideoUrl(displayMedia[lightboxIdx].url) || displayMedia[lightboxIdx].type === "video" ? (
                <video src={displayMedia[lightboxIdx].url} className="max-h-[85vh] max-w-full object-contain" controls autoPlay playsInline />
              ) : (
                <img src={displayMedia[lightboxIdx].url} className="max-h-[85vh] max-w-full object-contain" alt="" />
              )
            )}
            <button onClick={() => setLightboxOpen(false)} className="absolute top-4 right-4 text-white/70 hover:text-white">
              <X className="h-5 w-5" />
            </button>
            {lightboxIdx > 0 && (
              <button onClick={() => setLightboxIdx((i) => i - 1)} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white">
                <ChevronLeft className="h-8 w-8" />
              </button>
            )}
            {lightboxIdx < displayMedia.length - 1 && (
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
