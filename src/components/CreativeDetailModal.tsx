import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TagSourceBadge } from "@/components/TagSourceBadge";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon, ExternalLink, FileEdit, MessageSquare, GitBranch, Loader2, BookmarkPlus, Bookmark } from "lucide-react";
import { useState, forwardRef, useEffect } from "react";
import { useCachedMedia } from "@/hooks/useCachedMedia";

import { CreativeMetrics } from "@/components/creative-detail/CreativeMetrics";
import { RetentionCurveChart } from "@/components/creative-detail/RetentionCurveChart";
import { CreativeTagEditor } from "@/components/creative-detail/CreativeTagEditor";
import { CreativeIterationAnalysis } from "@/components/creative-detail/CreativeIterationAnalysis";

import { TrendSection } from "@/components/creative-detail/TrendSection";
import { PredictionSection } from "@/components/creative-detail/PredictionSection";


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
import type { Database } from "@/integrations/supabase/types";

type Creative = Database["public"]["Tables"]["creatives"]["Row"];
import { toast } from "sonner";
import { useAllCreatives } from "@/hooks/useAllCreatives";
import { useQueryClient } from "@tanstack/react-query";
import { saveCreativeToVault } from "@/lib/vaultSave";



interface CreativeDetailModalProps {
  creative: Creative;
  open: boolean;
  onClose: () => void;
  wowTrends?: Map<string, WoWTrend>;
  gradeMap?: Map<string, GradeInfo>;
  fatigueMap?: Map<string, FatigueResult>;
}

function MediaPreview({ creative, caching = false }: { creative: Creative; caching?: boolean }) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [videoLoading, setVideoLoading] = useState(true);

  const adPreviewUrl = creative.ad_post_url || `https://www.facebook.com/ads/library/?id=${creative.ad_id}`;

  // Filter out sentinel strings before passing to useCachedMedia — "no-thumbnail" is truthy
  // and would be passed as a URL to fetch, causing a load error even when thumbnail_url is valid.
  const rawThumbnailUrl =
    (creative.full_res_url && creative.full_res_url !== "no-thumbnail" ? creative.full_res_url : null) ||
    (creative.thumbnail_url && creative.thumbnail_url !== "no-thumbnail" ? creative.thumbnail_url : null) ||
    null;

  const { url: cachedThumbnailUrl, isLoading: thumbnailLoading, error: thumbnailError } =
    useCachedMedia(rawThumbnailUrl, {
      placeholderUrl: "/placeholder-creative.png",
    });

  const hasThumbnail = !!(
    (creative.thumbnail_url && creative.thumbnail_url !== "no-thumbnail") ||
    (creative.full_res_url && creative.full_res_url !== "no-thumbnail")
  );
  const hasVideoUrl = !!(creative.video_url && creative.video_url !== "no-video");

  // Video creatives whose source we can't cache (page-owned videos — the Meta token
  // lacks page permissions, so no downloadable source). They DO have video metrics, so
  // embed Meta's ad-preview iframe (scoped-token URL fetched server-side) so the video
  // still PLAYS in-app instead of only via an external link.
  const isVideoNoSource = !hasVideoUrl && (creative.video_avg_play_time ?? 0) > 0;
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    setPreviewUrl(null);
    if (!isVideoNoSource || !creative.ad_id) { setPreviewState("idle"); return; }
    setPreviewState("loading");
    supabase.functions
      .invoke("ad-preview", { body: { ad_id: creative.ad_id } })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.url) { setPreviewState("error"); return; }
        setPreviewUrl(data.url as string);
        setPreviewState("idle");
      })
      .catch(() => { if (!cancelled) setPreviewState("error"); });
    return () => { cancelled = true; };
  }, [creative.ad_id, isVideoNoSource]);

  // True while we don't yet have media dimensions to size the container by
  const isLoading = hasVideoUrl
    ? videoLoading && !videoError
    : hasThumbnail
    ? thumbnailLoading || (!imgLoaded && !imgError)
    : false;

  return (
    <div className="space-y-2">
      {/*
        Container sizes itself to the natural media dimensions.
        - max-w-[480px] + mx-auto: caps landscape width; portrait content will be narrower
        - max-h-[600px] on the media: prevents very tall portrait ads from overflowing
        - min-h-[300px] only shown while loading so the skeleton has room
        Skeleton uses absolute inset-0; once media loads it drops out and the
        container collapses to the real image/video size.
      */}
      <div className={`bg-muted rounded-lg overflow-hidden relative flex items-center justify-center w-full max-w-[480px] mx-auto${isLoading || caching || (!hasVideoUrl && !hasThumbnail) ? " min-h-[300px]" : ""}`}>
        {hasVideoUrl && !videoError ? (
          <>
            {videoLoading && (
              <div className="absolute inset-0 bg-muted animate-pulse flex items-center justify-center">
                <Loader2 className="h-8 w-8 text-muted-foreground/40 animate-spin" />
              </div>
            )}
            <video
              key={creative.video_url}
              src={creative.video_url}
              controls
              className={`max-w-full max-h-[600px] w-auto h-auto block transition-opacity duration-300 ${
                videoLoading ? "opacity-0 absolute" : "opacity-100"
              }`}
              poster={cachedThumbnailUrl || undefined}
              onLoadStart={() => setVideoLoading(true)}
              onCanPlay={() => setVideoLoading(false)}
              onError={() => { setVideoError(true); setVideoLoading(false); }}
            />
          </>
        ) : isVideoNoSource && previewUrl ? (
          // Page-owned video we can't cache — embed Meta's ad preview so it plays in-app.
          <iframe
            key={previewUrl}
            src={previewUrl}
            title={creative.ad_name}
            allow="autoplay; encrypted-media"
            className="w-[360px] max-w-full h-[560px] border-0 block bg-white"
          />
        ) : isVideoNoSource && previewState === "loading" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <Loader2 className="h-8 w-8 text-muted-foreground/40 animate-spin" />
            <span className="font-body text-[12px] text-muted-foreground">Loading video preview…</span>
          </div>
        ) : hasThumbnail ? (
          <>
            {(thumbnailLoading || (!imgLoaded && !imgError)) && (
              <div className="absolute inset-0 bg-muted animate-pulse flex items-center justify-center">
                <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
              </div>
            )}
            {(thumbnailError || imgError) && !thumbnailLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-muted/80 z-10">
                <span className="font-body text-xs text-muted-foreground">Thumbnail unavailable</span>
              </div>
            )}
            {videoError && !imgError && imgLoaded && (
              <div className="absolute top-2 left-2 z-10">
                <span className="bg-black/60 text-white font-label text-[10px] font-semibold px-2 py-0.5 rounded">
                  Video unavailable
                </span>
              </div>
            )}
            <img
              src={cachedThumbnailUrl}
              alt={creative.ad_name}
              className={`max-w-full max-h-[600px] w-auto h-auto block transition-opacity duration-300 ${
                imgLoaded ? "opacity-100" : "opacity-0 absolute"
              }`}
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgError(true)}
            />
          </>
        ) : caching ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <Loader2 className="h-8 w-8 text-muted-foreground/40 animate-spin" />
            <span className="font-body text-[12px] text-muted-foreground">Fetching ad media...</span>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2">
            <ImageIcon className="h-8 w-8 text-muted-foreground" />
            <span className="font-body text-[13px] text-muted-foreground">No preview available</span>
          </div>
        )}
      </div>

      {/* View on Facebook — always shown as a secondary link */}
      {adPreviewUrl && (
        <a
          href={adPreviewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-[12px] font-semibold rounded-md px-3 py-1.5 shadow-sm transition-colors cursor-pointer"
          title="View this ad on Facebook"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {hasVideoUrl ? "View on Facebook" : "Preview Ad"}
        </a>
      )}
    </div>
  );
}
export const CreativeDetailModal = forwardRef<HTMLDivElement, CreativeDetailModalProps>(function CreativeDetailModal({ creative, open, onClose, wowTrends, gradeMap, fatigueMap }, ref) {
  const { isBuilder, isEmployee, user } = useAuth();
  const { selectedAccount } = useAccountContext();
  const queryClient = useQueryClient();
  const canEdit = isBuilder || isEmployee;
  const [codaBriefOpen, setCodaBriefOpen] = useState(false);
  const [briefTaskName, setBriefTaskName] = useState("");
  const [briefNote, setBriefNote] = useState("");
  const [pushing, setPushing] = useState(false);
  const [savingToVault, setSavingToVault] = useState(false);
  const [savedToVault, setSavedToVault] = useState(false);
  // true when the saved state came from a dedupe hit / pre-existing vault item,
  // so the button can read "Already in Vault" rather than "Saved".
  const [alreadyInVault, setAlreadyInVault] = useState(false);
  const [cachedMedia, setCachedMedia] = useState<{
    thumbnail_url?: string | null;
    full_res_url?: string | null;
    video_url?: string | null;
  } | null>(null);
  const [caching, setCaching] = useState(false);

  // Fetch all creatives once at modal level — passed down to avoid duplicate fetches
  const { data: allCreatives = [] } = useAllCreatives({ account_id: creative?.account_id });

  // On-demand media caching / self-heal: fire when modal opens unless BOTH media
  // slots are already "settled" — i.e. a permanent storage url or a confirmed-absent
  // sentinel. A non-storage CDN url may be expired (Meta fbcdn urls die in hours), so
  // a non-null video_url is NOT a reason to skip: previously `if (hasVideo) return`
  // permanently stranded creatives whose video_url was an expired CDN url with no UI
  // recovery path. cache-creative-image is idempotent (its own skip guards no-op the
  // parts already in storage), so re-triggering only re-downloads what's still a CDN url.
  useEffect(() => {
    if (!open || !creative) return;
    setCachedMedia(null);
    const isStorageUrl = (u?: string | null) =>
      !!u && u.includes("/storage/v1/object/public/");
    const videoSettled =
      creative.video_url === "no-video" || isStorageUrl(creative.video_url);
    const thumbSettled =
      creative.thumbnail_url === "no-thumbnail" || isStorageUrl(creative.thumbnail_url);
    // Both permanent or confirmed-absent → nothing to recover.
    if (videoSettled && thumbSettled) return;
    setCaching(true);
    supabase.functions
      .invoke("cache-creative-image", {
        body: { ad_id: creative.ad_id, account_id: creative.account_id },
      })
      .then(({ data, error }) => {
        if (!error && data) {
          setCachedMedia({
            thumbnail_url: data.thumbnail_url ?? null,
            full_res_url: data.full_res_url ?? null,
            video_url: data.video_url ?? null,
          });
          queryClient.invalidateQueries({ queryKey: ["creatives"] });
        }
      })
      .finally(() => setCaching(false));
  }, [open, creative?.ad_id]);

  // Reflect already-in-vault state when the modal opens. The vault library is
  // global, so an item saved by anyone (matched on source_ad_id) marks this
  // creative as saved.
  useEffect(() => {
    if (!open || !creative) return;
    let cancelled = false;
    setSavedToVault(false);
    setAlreadyInVault(false);
    supabase
      .from("inspiration_items")
      .select("id")
      .eq("source_ad_id", creative.ad_id)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) {
          setSavedToVault(true);
          setAlreadyInVault(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, creative?.ad_id]);

  if (!creative) return null;

  const displayCreative: Creative = cachedMedia
    ? { ...creative, ...(Object.fromEntries(Object.entries(cachedMedia).filter(([, v]) => v != null)) as Partial<Creative>) }
    : creative;
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
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create brief in Coda");
    } finally {
      setPushing(false);
    }
  };

  // Save this analytics creative into the global Creative Vault via the
  // vault-save-creative edge function (US-002). Uses cached media when available
  // so the vault gets a usable copy even when the source video was just fetched.
  // Snapshot shaping + invoke live in the shared saveCreativeToVault helper,
  // reused by the analytics-grid bulk save (US-004).
  const handleSaveToVault = async () => {
    setSavingToVault(true);
    try {
      // Build the metric snapshot from the source creative, but send the
      // (possibly freshly cached) display media URLs so the vault gets a copy.
      const result = await saveCreativeToVault({
        ...creative,
        full_res_url: displayCreative.full_res_url,
        video_url: displayCreative.video_url,
        thumbnail_url: displayCreative.thumbnail_url,
      });

      setSavedToVault(true);
      if (result.alreadySaved) {
        setAlreadyInVault(true);
        toast.success("Already in Vault");
      } else {
        setAlreadyInVault(false);
        toast.success("Saved to Vault");
      }
    } catch (err: unknown) {
      setSavedToVault(false);
      setAlreadyInVault(false);
      toast.error(err instanceof Error ? err.message : "Failed to save to Vault");
    } finally {
      setSavingToVault(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto bg-card rounded-[8px] shadow-modal">
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

        {/* Media preview — key resets loading state when switching creatives */}
        <MediaPreview key={creative.ad_id} creative={displayCreative} caching={caching} />

        <Tabs defaultValue="details" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="details" className="flex-1">Details</TabsTrigger>
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

            {/* Frame-by-frame retention drop-off (US-004) — reads creative.play_curve */}
            <RetentionCurveChart creative={creative} />

            {/* Iteration Analysis - right after metrics */}
            <CreativeIterationAnalysis creative={creative} allCreatives={allCreatives} />

            {gradeMap?.get(creative.ad_id) && (
              <div className="flex items-center gap-2 px-1">
                <GradeBadge grade={gradeMap.get(creative.ad_id)!.grade} />
                <span className="font-body text-[12px] text-muted-foreground">
                  This creative ranks in the top {100 - gradeMap.get(creative.ad_id)!.spendPercentile}% for spend in this account.
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
                  <span className={`font-data text-[17px] font-bold tabular-nums ${fatigue.level === "high" ? "text-destructive" : "text-amber-600"}`}>
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
                <Button
                  variant={savedToVault ? "default" : "outline"}
                  size="sm"
                  className="gap-1.5 font-body text-[12px]"
                  onClick={handleSaveToVault}
                  disabled={savingToVault || savedToVault}
                >
                  {savingToVault ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : savedToVault ? (
                    <Bookmark className="h-3.5 w-3.5 fill-current" />
                  ) : (
                    <BookmarkPlus className="h-3.5 w-3.5" />
                  )}
                  {savedToVault ? (alreadyInVault ? "Already in Vault" : "Saved") : "Save to Vault"}
                </Button>
              </div>
            )}

            <CreativeTagEditor creative={creative} />
          </TabsContent>


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
