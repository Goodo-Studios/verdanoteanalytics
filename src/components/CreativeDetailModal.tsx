import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TagSourceBadge } from "@/components/TagSourceBadge";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon, ExternalLink, Play, Video, AlertCircle, FileEdit, Sparkles, MessageSquare, GitBranch, Loader2 } from "lucide-react";
import { useState, forwardRef } from "react";
import { useCachedMedia, videoProxyUrl } from "@/hooks/useCachedMedia";

import { CreativeMetrics } from "@/components/creative-detail/CreativeMetrics";
import { CreativeTagEditor } from "@/components/creative-detail/CreativeTagEditor";
import { CreativeIterationAnalysis } from "@/components/creative-detail/CreativeIterationAnalysis";

import { TrendSection } from "@/components/creative-detail/TrendSection";
import { PredictionSection } from "@/components/creative-detail/PredictionSection";

import { CreativeAIAnalysis } from "@/components/creative-detail/CreativeAIAnalysis";
import { CreativeComments } from "@/components/creative-detail/CreativeComments";
import { CreativeVersions } from "@/components/creative-detail/CreativeVersions";
import { GradeBadge } from "@/components/creatives/GradeBadge";
import { Textarea } from "@/components/ui/textarea";

import type { WoWTrend } from "@/hooks/useWoWTrends";
import type { GradeInfo } from "@/lib/creativeGrading";
import type { FatigueResult } from "@/lib/fatigueScore";
import { useAuth } from "@/contexts/AuthContext";
import { useAccountContext } from "@/contexts/AccountContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAllCreatives } from "@/hooks/useAllCreatives";



interface CreativeDetailModalProps {
  creative: any;
  open: boolean;
  onClose: () => void;
  wowTrends?: Map<string, WoWTrend>;
  gradeMap?: Map<string, GradeInfo>;
  fatigueMap?: Map<string, FatigueResult>;
}

function MetaPreviewEmbed({ url, fallbackUrl }: { url: string; fallbackUrl?: string | null }) {
  const linkUrl = url || fallbackUrl;

  if (!linkUrl) return null;

  return (
    <div className="w-full h-[200px] flex flex-col items-center justify-center gap-3 bg-muted rounded-lg border border-border">
      <ExternalLink className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground font-medium">Ad Preview</p>
      <p className="text-xs text-muted-foreground text-center px-4">Meta ad previews can't be embedded. Open in Facebook to view.</p>
      <a href={linkUrl} target="_blank" rel="noopener noreferrer">
        <Button size="sm" className="gap-1.5 mt-1">
          <ExternalLink className="h-3.5 w-3.5" />View Ad on Facebook
        </Button>
      </a>
    </div>
  );
}

/**
 * VideoPlayer -- handles the 3-step fallback chain for video playback:
 *
 * Step 1: Try playing via video-proxy (routes through edge fn, solves CORS + signed URL expiry)
 * Step 2: If proxy 404/502, fall back to direct video_url (works for Supabase storage)
 * Step 3: If both fail, show Facebook Ad Library / preview_url link
 *
 * This replaces the previous single-attempt approach that went straight to error state.
 */
function VideoPlayer({
  creative,
  posterUrl,
  onBack,
}: {
  creative: any;
  posterUrl?: string;
  onBack: () => void;
}) {
  // Fallback state: 0 = try proxy, 1 = try direct URL, 2 = failed
  const [fallbackLevel, setFallbackLevel] = useState(0);
  const facebookAdUrl = creative.ad_id
    ? `https://www.facebook.com/ads/library/?id=${creative.ad_id}`
    : null;

  const isStorageUrl = creative.video_url?.includes("/storage/v1/object/public/");

  // For Supabase storage URLs, skip the proxy (no CORS issue, serves directly)
  const videoSrc =
    isStorageUrl
      ? creative.video_url
      : fallbackLevel === 0
      ? videoProxyUrl(creative.video_url)
      : fallbackLevel === 1
      ? creative.video_url
      : null;

  const handleError = () => {
    if (fallbackLevel < 1 && !isStorageUrl) {
      // Proxy failed -- try direct URL
      setFallbackLevel(1);
    } else {
      // All video sources exhausted
      setFallbackLevel(2);
    }
  };

  if (fallbackLevel === 2 || !videoSrc) {
    // Terminal failure -- show external links
    return (
      <div className="bg-muted rounded-lg overflow-hidden relative">
        <div className="w-full h-[400px] flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <AlertCircle className="h-8 w-8" />
          <p className="text-sm font-medium">Video unavailable inline</p>
          <p className="text-xs text-center px-6">
            The video URL has likely expired. It will be refreshed automatically within 2 hours.
          </p>
          <div className="flex gap-2 mt-1 flex-wrap justify-center">
            {facebookAdUrl && (
              <a href={facebookAdUrl} target="_blank" rel="noopener noreferrer">
                <Button size="sm" className="gap-1.5">
                  <Video className="h-4 w-4" />Watch on Facebook
                </Button>
              </a>
            )}
            {creative.preview_url && (
              <a href={creative.preview_url} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="outline" className="gap-1.5">
                  <ExternalLink className="h-3.5 w-3.5" />Ad Preview
                </Button>
              </a>
            )}
          </div>
          <button
            onClick={onBack}
            className="text-xs text-muted-foreground underline mt-1"
          >
            Back to thumbnail
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-muted rounded-lg overflow-hidden relative">
      <video
        key={videoSrc}
        src={videoSrc}
        controls
        autoPlay
        playsInline
        className="w-full max-h-[400px]"
        poster={posterUrl}
        onError={handleError}
      />
      <div className="absolute bottom-2 right-2 flex gap-1.5">
        {creative.preview_url && (
          <a href={creative.preview_url} target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="secondary" className="gap-1.5 text-xs bg-white/90 text-foreground hover:bg-white">
              <ExternalLink className="h-3 w-3" />Ad Preview
            </Button>
          </a>
        )}
        {facebookAdUrl && (
          <a href={facebookAdUrl} target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="secondary" className="gap-1.5 text-xs bg-white/90 text-foreground hover:bg-white">
              <ExternalLink className="h-3 w-3" />Facebook
            </Button>
          </a>
        )}
      </div>
    </div>
  );
}

function MediaPreview({ creative }: { creative: any }) {
  const [showVideo, setShowVideo] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const hasVideo = !!creative.video_url && creative.video_url !== "no-video";
  const isVideoAdWithoutSource =
    creative.video_url === "no-video" && (creative.video_views || 0) > 0;
  const facebookAdUrl = creative.ad_id
    ? `https://www.facebook.com/ads/library/?id=${creative.ad_id}`
    : null;

  // Use cached media hook for thumbnail -- caches to IndexedDB, survives Meta CDN URL expiry.
  // Prefer full_res_url (high-res source stored during refresh-thumbnails).
  const { url: cachedThumbnailUrl, isLoading: thumbnailLoading, error: thumbnailError } =
    useCachedMedia(creative.full_res_url || creative.thumbnail_url, {
      placeholderUrl: "/placeholder-creative.png",
    });

  const hasThumbnail = !!creative.thumbnail_url;

  // Show the inline video player
  if (hasVideo && showVideo) {
    return (
      <VideoPlayer
        creative={creative}
        posterUrl={cachedThumbnailUrl || undefined}
        onBack={() => setShowVideo(false)}
      />
    );
  }

  // Video ad but no source URL yet -- show Ad Library link
  if (isVideoAdWithoutSource) {
    const adLibUrl = facebookAdUrl;
    return (
      <div className="bg-muted rounded-lg flex flex-col items-center justify-center gap-3 py-12">
        <Video className="h-8 w-8 text-muted-foreground" />
        <span className="font-body text-[13px] text-muted-foreground">
          Video preview not available inline
        </span>
        <p className="text-xs text-muted-foreground text-center px-8">
          The video source URL couldn't be fetched from Meta. It will be retried automatically.
        </p>
        {adLibUrl && (
          <Button
            size="sm"
            className="gap-1.5"
            onClick={(e) => {
              e.stopPropagation();
              window.open(adLibUrl, "_blank", "noopener,noreferrer");
            }}
          >
            <ExternalLink className="h-3.5 w-3.5" />View in Ad Library
          </Button>
        )}
      </div>
    );
  }

  const adLibraryUrl = creative.ad_id
    ? `https://www.facebook.com/ads/library/?id=${encodeURIComponent(String(creative.ad_id))}`
    : null;

  return (
    <div className="bg-muted rounded-lg flex items-center justify-center overflow-hidden relative group">
      {hasThumbnail ? (
        <div className="relative w-full">
          {/* Loading skeleton */}
          {(thumbnailLoading || !imgLoaded) && (
            <div className="w-full h-[300px] bg-cream-dark rounded animate-pulse flex items-center justify-center">
              <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
            </div>
          )}

          {/* Error state */}
          {thumbnailError && !thumbnailLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/80 z-10">
              <span className="font-body text-xs text-muted-foreground">Thumbnail unavailable</span>
            </div>
          )}

          {/* Thumbnail image */}
          <img
            src={cachedThumbnailUrl}
            alt={creative.ad_name}
            className={`w-full max-h-[400px] object-contain transition-opacity duration-300 ${
              imgLoaded ? "opacity-100" : "opacity-0 absolute inset-0"
            }`}
            onLoad={() => setImgLoaded(true)}
            onError={() => {
              /* hook already handled fallback */
            }}
          />

          {/* Video play overlay */}
          {hasVideo && imgLoaded && (
            <button
              onClick={() => setShowVideo(true)}
              className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity"
            >
              <div className="h-14 w-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                <Play className="h-6 w-6 text-foreground ml-0.5" />
              </div>
            </button>
          )}

          {/* Ad Library link */}
          {adLibraryUrl && imgLoaded && (
            <a
              href={adLibraryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute bottom-2 right-2 z-10 inline-flex items-center gap-1.5 bg-white/90 hover:bg-white text-[11px] font-medium text-slate-700 rounded-md px-2.5 py-1.5 shadow-sm transition-colors cursor-pointer"
              title="View in Facebook Ad Library"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
              Ad Library
            </a>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-12">
          <ImageIcon className="h-8 w-8 text-sage" />
          <span className="font-body text-[13px] text-sage">No preview available</span>
          {isVideoAdWithoutSource && facebookAdUrl && (
            <a href={facebookAdUrl} target="_blank" rel="noopener noreferrer">
              <Button size="sm" className="gap-1.5 text-xs mt-1">
                <Video className="h-4 w-4" />Watch on Facebook
              </Button>
            </a>
          )}
          {!isVideoAdWithoutSource && creative.preview_url && (
            <a href={creative.preview_url} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="secondary" className="gap-1.5 text-xs mt-1">
                <ExternalLink className="h-3 w-3" />View Ad Preview
              </Button>
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export const CreativeDetailModal = forwardRef<HTMLDivElement, CreativeDetailModalProps>(function CreativeDetailModal({ creative, open, onClose, wowTrends, gradeMap, fatigueMap }, ref) {
  const { isBuilder, isEmployee, user } = useAuth();
  const { selectedAccount } = useAccountContext();
  const canEdit = isBuilder || isEmployee;
  const [codaBriefOpen, setCodaBriefOpen] = useState(false);
  const [briefTaskName, setBriefTaskName] = useState("");
  const [briefNote, setBriefNote] = useState("");
  const [pushing, setPushing] = useState(false);

  // Fetch all creatives once at modal level — passed down to avoid duplicate fetches
  const { data: allCreatives = [] } = useAllCreatives({ account_id: creative?.account_id });

  if (!creative) return null;
  const fatigue = fatigueMap?.get(creative.ad_id);

  const creativeLink = creative ? `https://www.facebook.com/ads/library/?id=${creative.ad_id}` : "";

  const handleOpenCodaBrief = () => {
    setBriefTaskName("");
    setBriefNote(`Reference creative: ${creative?.ad_name || creative?.ad_id}\n${creativeLink}\n\n`);
    setCodaBriefOpen(true);
  };

  const handlePushToCoda = async () => {
    setPushing(true);
    try {
      const { error } = await supabase.functions.invoke("create-coda-brief", {
        body: {
          creative_id: creative.ad_id,
          account_id: creative.account_id,
          account_name: selectedAccount?.name || "",
          task_name: briefTaskName,
          brief_note: briefNote,
          user_id: user?.id,
        },
      });
      if (error) throw error;
      toast.success("Brief created in Coda");
      setCodaBriefOpen(false);
      setBriefNote("");
      setBriefTaskName("");
    } catch (err: any) {
      toast.error(err?.message || "Failed to create brief in Coda");
    } finally {
      setPushing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-white rounded-[8px] shadow-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-label text-[12px] font-semibold text-charcoal tracking-wide">{creative.unique_code}</span>
            <TagSourceBadge source={creative.tag_source} />
            {creative.ad_status && (
              <span className="font-label text-[10px] font-semibold tracking-wide bg-sage-light text-verdant rounded-[4px] px-2 py-0.5">
                {creative.ad_status}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Media preview */}
        <MediaPreview creative={creative} />

        <Tabs defaultValue="details" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="details" className="flex-1">Details</TabsTrigger>
            {canEdit && (
              <TabsTrigger value="ai-analysis" className="flex-1 gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                AI Analysis
              </TabsTrigger>
            )}
            <TabsTrigger value="comments" className="flex-1 gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" />
              Comments
            </TabsTrigger>
            <TabsTrigger value="versions" className="flex-1 gap-1.5">
              <GitBranch className="h-3.5 w-3.5" />
              Versions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-4 mt-4">
            <CreativeMetrics creative={creative} />

            {/* Iteration Analysis - right after metrics */}
            <CreativeIterationAnalysis creative={creative} allCreatives={allCreatives} />

            {gradeMap?.get(creative.ad_id) && (
              <div className="flex items-center gap-2 px-1">
                <GradeBadge grade={gradeMap.get(creative.ad_id)!.grade} />
                <span className="font-body text-[12px] text-muted-foreground">
                  This creative ranks in the top {100 - gradeMap.get(creative.ad_id)!.roasPercentile}% for ROAS in this account.
                </span>
              </div>
            )}
            <TrendSection trend={wowTrends?.get(creative.ad_id)} />

            {/* Fatigue section */}
            {fatigue && fatigue.level !== "ok" && (
              <div className="space-y-2 px-1">
                <div className="flex items-center gap-2">
                  <span className="font-label text-[11px] font-semibold uppercase tracking-wider text-foreground">
                    {fatigue.level === "high" ? "🔥" : "⚠️"} Fatigue Score
                  </span>
                  <span className={`font-data text-[13px] font-bold tabular-nums ${fatigue.level === "high" ? "text-destructive" : "text-amber-600"}`}>
                    {fatigue.score}/100
                  </span>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${fatigue.level === "high" ? "bg-destructive" : "bg-amber-400"}`}
                    style={{ width: `${fatigue.score}%` }}
                  />
                </div>
                {fatigue.explanation && (
                  <p className="font-body text-[12px] text-muted-foreground leading-relaxed">{fatigue.explanation}</p>
                )}
                {fatigue.reasons.length > 0 && (
                  <ul className="space-y-0.5">
                    {fatigue.reasons.map((r, i) => (
                      <li key={i} className="font-body text-[11px] text-muted-foreground flex items-center gap-1.5">
                        <span className="w-1 h-1 rounded-full bg-muted-foreground flex-shrink-0" />
                        {r}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}


            {/* Performance Prediction (builder/employee only) */}
            {canEdit && creative.spend > 0 && (
              <PredictionSection
                creative={creative}
                wowTrend={wowTrends?.get(creative.ad_id)}
                fatigue={fatigue}
                killThreshold={1.0}
              />
            )}

            {/* Context */}
            <div className="space-y-1.5">
              <p className="font-body text-[13px]"><span className="font-semibold text-foreground">Ad Name:</span> <span className="font-normal text-muted-foreground break-all">{creative.ad_name}</span></p>
              <p className="font-body text-[13px]"><span className="font-semibold text-foreground">Campaign:</span> <span className="font-normal text-muted-foreground break-all">{creative.campaign_name || "—"}</span></p>
              <p className="font-body text-[13px]"><span className="font-semibold text-foreground">Ad Set:</span> <span className="font-normal text-muted-foreground break-all">{creative.adset_name || "—"}</span></p>
            </div>

            {/* Create Brief in Coda */}
            {(isBuilder || isEmployee) && (
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 font-body text-[12px]"
                  onClick={handleOpenCodaBrief}
                >
                  <FileEdit className="h-3.5 w-3.5" />
                  Create brief in Coda
                </Button>
              </div>
            )}

            <CreativeTagEditor creative={creative} />
          </TabsContent>

          {canEdit && (
            <TabsContent value="ai-analysis" className="mt-4">
              <CreativeAIAnalysis creative={creative} />
            </TabsContent>
          )}

          <TabsContent value="comments" className="mt-4">
            <CreativeComments adId={creative.ad_id} accountId={creative.account_id} />
          </TabsContent>

          <TabsContent value="versions" className="mt-4">
            <CreativeVersions creative={creative} onCreativeClick={(c) => { onClose(); }} />
          </TabsContent>
        </Tabs>
      </DialogContent>

      {/* Coda Brief Modal */}
      <Dialog open={codaBriefOpen} onOpenChange={setCodaBriefOpen}>
        <DialogContent className="max-w-md bg-card rounded-lg shadow-modal">
          <DialogHeader>
            <DialogTitle className="font-label text-[14px] font-semibold text-foreground">Create Brief</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <label className="font-body text-[12px] font-medium text-foreground">Task name</label>
              <input
                type="text"
                placeholder="e.g., Sleep anxiety hook variation"
                value={briefTaskName}
                onChange={(e) => setBriefTaskName(e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-input bg-background font-body text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <label className="font-body text-[12px] font-medium text-foreground">Brief note</label>
              <Textarea
                placeholder="e.g., Hook variation leaning into sleep anxiety"
                value={briefNote}
                onChange={(e) => setBriefNote(e.target.value)}
                className="min-h-[100px] font-body text-[13px]"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" size="sm" onClick={() => setCodaBriefOpen(false)} disabled={pushing}>
              Cancel
            </Button>
            <Button size="sm" onClick={handlePushToCoda} disabled={pushing} className="gap-1.5">
              {pushing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Push to Coda
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
});
