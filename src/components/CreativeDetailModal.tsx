import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TagSourceBadge } from "@/components/TagSourceBadge";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon, ExternalLink, Play, Video, AlertCircle, Users, FileEdit, BookOpen, Sparkles, PenTool, MessageSquare, GitBranch } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useCreator } from "@/hooks/useCreatorsApi";
import { useState, forwardRef } from "react";
import { AnnotationCanvas } from "@/components/creative-detail/AnnotationCanvas";
import { AnnotationGallery } from "@/components/creative-detail/AnnotationGallery";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBriefs } from "@/hooks/useBriefsApi";
import { CreativeMetrics } from "@/components/creative-detail/CreativeMetrics";
import { CreativeTagEditor } from "@/components/creative-detail/CreativeTagEditor";
import { CreativeIterationAnalysis } from "@/components/creative-detail/CreativeIterationAnalysis";
import { CreativeNotes } from "@/components/creative-detail/CreativeNotes";
import { TrendSection } from "@/components/creative-detail/TrendSection";
import { PredictionSection } from "@/components/creative-detail/PredictionSection";
import { CreativeChangelog } from "@/components/creative-detail/CreativeChangelog";
import { CreativeAIAnalysis } from "@/components/creative-detail/CreativeAIAnalysis";
import { CreativeComments } from "@/components/creative-detail/CreativeComments";
import { CreativeVersions } from "@/components/creative-detail/CreativeVersions";
import { GradeBadge } from "@/components/creatives/GradeBadge";
import { FatigueForecastSection } from "@/components/creative-detail/FatigueForecastSection";
import { ScoreCircle } from "@/components/creatives/ScoreCircle";
import type { WoWTrend } from "@/hooks/useWoWTrends";
import type { GradeInfo } from "@/lib/creativeGrading";
import type { FatigueResult } from "@/lib/fatigueScore";
import type { CreativeScore } from "@/lib/creativeScore";
import { useAuth } from "@/contexts/AuthContext";
import { useCreateBrief } from "@/hooks/useBriefsApi";
import { SaveToMoodboardMenu } from "@/components/moodboards/SaveToMoodboardMenu";
import { HookBrowserModal } from "@/components/hooks/HookBrowserModal";

interface CreativeDetailModalProps {
  creative: any;
  open: boolean;
  onClose: () => void;
  wowTrends?: Map<string, WoWTrend>;
  gradeMap?: Map<string, GradeInfo>;
  fatigueMap?: Map<string, FatigueResult>;
  scoreMap?: Map<string, CreativeScore>;
}

function MetaPreviewEmbed({ url, fallbackUrl }: { url: string; fallbackUrl?: string | null }) {
  const [iframeError, setIframeError] = useState(false);

  if (iframeError && fallbackUrl) {
    return (
      <div className="w-full h-[400px] flex flex-col items-center justify-center gap-3 bg-muted rounded-lg">
        <AlertCircle className="h-6 w-6 text-muted-foreground" />
        <p className="font-body text-xs text-muted-foreground">Preview couldn't load inline.</p>
        <a href={fallbackUrl} target="_blank" rel="noopener noreferrer">
          <Button size="sm" className="gap-1.5"><ExternalLink className="h-3.5 w-3.5" />Open Preview</Button>
        </a>
      </div>
    );
  }

  return (
    <div className="bg-muted rounded-lg overflow-hidden relative">
      <iframe
        src={url}
        className="w-full h-[400px] border-0 rounded-lg"
        allow="autoplay; encrypted-media"
        allowFullScreen
        onError={() => setIframeError(true)}
        sandbox="allow-scripts allow-same-origin allow-popups"
      />
      {fallbackUrl && (
        <a href={fallbackUrl} target="_blank" rel="noopener noreferrer" className="absolute bottom-2 right-2">
          <Button size="sm" variant="secondary" className="gap-1.5 text-xs">
            <ExternalLink className="h-3 w-3" />Open in New Tab
          </Button>
        </a>
      )}
    </div>
  );
}

function MediaPreview({ creative }: { creative: any }) {
  const [showVideo, setShowVideo] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const hasVideo = !!creative.video_url && creative.video_url !== "no-video";
  const isVideoAdWithoutSource = creative.video_url === "no-video" && (creative.video_views > 0);
  const facebookAdUrl = creative.preview_url || (creative.ad_id ? `https://www.facebook.com/ads/library/?id=${creative.ad_id}` : null);

  // Video playback with error fallback to iframe embed
  if (hasVideo && showVideo) {
    if (videoError) {
      if (creative.preview_url) {
        return <MetaPreviewEmbed url={creative.preview_url} fallbackUrl={facebookAdUrl} />;
      }
      return (
        <div className="bg-muted rounded-lg overflow-hidden relative">
          <div className="w-full h-[400px] flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <AlertCircle className="h-8 w-8" />
            <p className="text-xs">Video couldn't be played directly.</p>
            {facebookAdUrl && (
              <a href={facebookAdUrl} target="_blank" rel="noopener noreferrer">
                <Button size="sm" className="gap-1.5"><Video className="h-4 w-4" />Watch on Facebook</Button>
              </a>
            )}
            <button onClick={() => { setShowVideo(false); setVideoError(false); }} className="text-xs text-muted-foreground underline mt-1">
              Back to thumbnail
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="bg-muted rounded-lg overflow-hidden relative">
        <video
          src={creative.video_url}
          controls
          autoPlay
          className="w-full max-h-[400px]"
          poster={creative.thumbnail_url || undefined}
          onError={() => setVideoError(true)}
        />
        {creative.preview_url && (
          <a href={creative.preview_url} target="_blank" rel="noopener noreferrer" className="absolute bottom-2 right-2">
            <Button size="sm" variant="secondary" className="gap-1.5 text-xs">
              <ExternalLink className="h-3 w-3" />View Ad Preview
            </Button>
          </a>
        )}
      </div>
    );
  }

  // For "no-video" ads that have a preview URL, embed the Meta preview directly
  if (isVideoAdWithoutSource && creative.preview_url) {
    return (
      <div className="relative group">
        <MetaPreviewEmbed url={creative.preview_url} fallbackUrl={facebookAdUrl} />
      </div>
    );
  }

  const adLibraryUrl = creative.ad_id ? `https://www.facebook.com/ads/library/?id=${creative.ad_id}` : null;

  return (
    <div className="bg-muted rounded-lg flex items-center justify-center overflow-hidden relative group">
      {creative.thumbnail_url && !imgError ? (
        <div className="relative w-full">
          {!imgLoaded && (
            <div className="w-full h-[300px] bg-cream-dark rounded" />
          )}
          <img
            src={creative.thumbnail_url}
            alt={creative.ad_name}
            className={`w-full max-h-[400px] object-contain ${imgLoaded ? "opacity-100" : "opacity-0 absolute inset-0"}`}
            loading="lazy"
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
          />
          {hasVideo && imgLoaded && (
            <button
              onClick={() => { setShowVideo(true); setVideoError(false); }}
              className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 cursor-pointer"
            >
              <div className="h-14 w-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                <Play className="h-6 w-6 text-foreground ml-0.5" />
              </div>
            </button>
          )}
          {adLibraryUrl && imgLoaded && (
            <a
              href={adLibraryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute bottom-2 right-2 inline-flex items-center gap-1.5 bg-white/90 hover:bg-white text-[11px] font-medium text-slate-700 rounded-md px-2.5 py-1.5 shadow-sm transition-colors"
              title="View in Facebook Ad Library"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
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

export const CreativeDetailModal = forwardRef<HTMLDivElement, CreativeDetailModalProps>(function CreativeDetailModal({ creative, open, onClose, wowTrends, gradeMap, fatigueMap, scoreMap }, ref) {
  const creatorId = creative?.creator_id;
  const { data: creator } = useCreator(creatorId || undefined);
  const { isBuilder, isEmployee, user } = useAuth();
  const canEdit = isBuilder || isEmployee;
  const navigate = useNavigate();
  const createBrief = useCreateBrief();
  const [hookBrowserOpen, setHookBrowserOpen] = useState(false);
  const [annotateMode, setAnnotateMode] = useState(false);
  const queryClient = useQueryClient();
  const { data: briefs } = useBriefs(creative?.account_id);
  if (!creative) return null;
  const fatigue = fatigueMap?.get(creative.ad_id);
  const creativeScore = scoreMap?.get(creative.ad_id);

  const handleCreateBrief = () => {
    createBrief.mutate(
      {
        account_id: creative.account_id,
        name: `Brief from ${creative.unique_code || creative.ad_name}`,
        status: "draft",
        reference_ad_ids: [creative.ad_id],
        content: {
          concept_name: creative.unique_code || "",
          objective: "",
          hook: creative.hook || "",
          key_message: "",
          cta: "",
          format_specs: creative.ad_type ? `Format: ${creative.ad_type}` : "",
          dos: "",
          donts: "",
        },
        created_by: user?.id,
      } as any,
      { onSuccess: () => { onClose(); navigate("/briefs"); } },
    );
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

        {/* Annotate button + Media preview */}
        {annotateMode && creative.thumbnail_url ? (
          <AnnotationCanvas
            imageUrl={creative.thumbnail_url}
            adId={creative.ad_id}
            accountId={creative.account_id}
            onClose={() => setAnnotateMode(false)}
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ["annotations", creative.ad_id] });
              setAnnotateMode(false);
            }}
            briefs={briefs}
          />
        ) : (
          <div className="relative">
            <MediaPreview creative={creative} />
            {canEdit && creative.thumbnail_url && (
              <Button
                size="sm"
                variant="secondary"
                className="absolute top-2 left-2 gap-1.5 font-body text-[11px] shadow-sm"
                onClick={() => setAnnotateMode(true)}
              >
                <PenTool className="h-3.5 w-3.5" /> Annotate
              </Button>
            )}
          </div>
        )}

        <Tabs defaultValue="details" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="details" className="flex-1">Details</TabsTrigger>
            {canEdit && (
              <TabsTrigger value="ai-analysis" className="flex-1 gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                AI Analysis
              </TabsTrigger>
            )}
            <TabsTrigger value="annotations" className="flex-1 gap-1.5">
              <PenTool className="h-3.5 w-3.5" />
              Annotations
            </TabsTrigger>
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

            {/* Creative Score */}
            {creativeScore && (
              <div className="space-y-2 px-1">
                <div className="flex items-center gap-3">
                  <ScoreCircle score={creativeScore.score} tier={creativeScore.tier} size="md" />
                  <span className="font-heading text-[16px] text-foreground">Creative Score: {creativeScore.score}/100</span>
                </div>
                <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${creativeScore.tier === "green" ? "bg-success" : creativeScore.tier === "amber" ? "bg-amber-500" : "bg-destructive"}`}
                    style={{ width: `${creativeScore.score}%` }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] font-body mt-1">
                  <ScoreRow label="ROAS" value={creativeScore.breakdown.roas} max={35} />
                  <ScoreRow label="CTR" value={creativeScore.breakdown.ctr} max={20} />
                  <ScoreRow label="Hook Rate" value={creativeScore.breakdown.hookRate} max={15} />
                  <ScoreRow label="CPA Efficiency" value={creativeScore.breakdown.cpaEfficiency} max={10} />
                  <ScoreRow label="Momentum" value={creativeScore.breakdown.momentum} max={10} />
                  {creativeScore.breakdown.fatiguePenalty < 0 && (
                    <ScoreRow label="Fatigue Penalty" value={creativeScore.breakdown.fatiguePenalty} max={0} negative />
                  )}
                </div>
              </div>
            )}

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

            {/* Fatigue Forecast */}
            {canEdit && creative.spend > 0 && (
              <FatigueForecastSection
                adId={creative.ad_id}
                adName={creative.ad_name}
                accountId={creative.account_id}
              />
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
              {creator && (
                <p className="font-body text-[13px] flex items-center gap-1.5">
                  <span className="font-semibold text-foreground">Creator:</span>
                  <a href="/creators" className="inline-flex items-center gap-1 text-primary hover:underline font-normal">
                    <Users className="h-3 w-3" />{creator.name}
                  </a>
                </p>
              )}
              <p className="font-body text-[13px]"><span className="font-semibold text-foreground">Campaign:</span> <span className="font-normal text-muted-foreground break-all">{creative.campaign_name || "—"}</span></p>
              <p className="font-body text-[13px]"><span className="font-semibold text-foreground">Ad Set:</span> <span className="font-normal text-muted-foreground break-all">{creative.adset_name || "—"}</span></p>
            </div>

            {/* Create Brief from This */}
            {(isBuilder || isEmployee) && (
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 font-body text-[12px]"
                  onClick={handleCreateBrief}
                  disabled={createBrief.isPending}
                >
                  <FileEdit className="h-3.5 w-3.5" />
                  Create Brief from This
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 font-body text-[12px]"
                  onClick={() => setHookBrowserOpen(true)}
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  Browse Hooks
                </Button>
                <SaveToMoodboardMenu
                  adId={creative.ad_id}
                  thumbnailUrl={creative.thumbnail_url}
                  caption={creative.ad_name}
                />
              </div>
            )}

            <Separator />
            <CreativeNotes creative={creative} />
            <Separator />
            <CreativeChangelog adId={creative.ad_id} accountId={creative.account_id} />
            <Separator />
            <CreativeTagEditor creative={creative} />
            <Separator />
            <CreativeIterationAnalysis creative={creative} />
          </TabsContent>

          {canEdit && (
            <TabsContent value="ai-analysis" className="mt-4">
              <CreativeAIAnalysis creative={creative} />
            </TabsContent>
          )}

          <TabsContent value="annotations" className="mt-4">
            <AnnotationGallery adId={creative.ad_id} />
          </TabsContent>

          <TabsContent value="comments" className="mt-4">
            <CreativeComments adId={creative.ad_id} accountId={creative.account_id} />
          </TabsContent>

          <TabsContent value="versions" className="mt-4">
            <CreativeVersions creative={creative} onCreativeClick={(c) => { onClose(); /* parent will re-open with new creative */ }} />
          </TabsContent>
        </Tabs>
      </DialogContent>
      <HookBrowserModal open={hookBrowserOpen} onClose={() => setHookBrowserOpen(false)} />
    </Dialog>
  );
});

function ScoreRow({ label, value, max, negative }: { label: string; value: number; max: number; negative?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-data font-medium tabular-nums ${negative ? "text-destructive" : "text-foreground"}`}>
        {value > 0 ? "+" : ""}{value} / {max}
      </span>
    </div>
  );
}
