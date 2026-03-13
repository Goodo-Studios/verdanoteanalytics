import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TagSourceBadge } from "@/components/TagSourceBadge";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon, ExternalLink, Play, Video, FileEdit, MessageSquare, GitBranch, Loader2 } from "lucide-react";
import { useState, forwardRef } from "react";
import { useCachedMedia } from "@/hooks/useCachedMedia";

import { CreativeMetrics } from "@/components/creative-detail/CreativeMetrics";
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

function MediaPreview({ creative }: { creative: any }) {
  const [imgLoaded, setImgLoaded] = useState(false);

  const adPreviewUrl = creative.ad_post_url || null;

  const { url: cachedThumbnailUrl, isLoading: thumbnailLoading, error: thumbnailError } =
    useCachedMedia(creative.full_res_url || creative.thumbnail_url, {
      placeholderUrl: "/placeholder-creative.png",
    });

  const hasThumbnail = !!creative.thumbnail_url;
  const isVideoAd = (creative.video_views || 0) > 0;

  return (
    <div className="bg-muted rounded-lg flex items-center justify-center overflow-hidden relative group">
      {hasThumbnail ? (
        <div className="relative w-full">
          {(thumbnailLoading || !imgLoaded) && (
            <div className="w-full h-[300px] bg-muted rounded animate-pulse flex items-center justify-center">
              <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
            </div>
          )}
          {thumbnailError && !thumbnailLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/80 z-10">
              <span className="font-body text-xs text-muted-foreground">Thumbnail unavailable</span>
            </div>
          )}
          <img
            src={cachedThumbnailUrl}
            alt={creative.ad_name}
            className={`w-full max-h-[400px] object-contain transition-opacity duration-300 ${
              imgLoaded ? "opacity-100" : "opacity-0 absolute inset-0"
            }`}
            onLoad={() => setImgLoaded(true)}
          />

          {/* Play overlay for video ads — opens ad post preview or Ad Library */}
          {isVideoAd && (adPreviewUrl || adLibraryUrl) && imgLoaded && (
            <a
              href={adPreviewUrl || adLibraryUrl!}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            >
              <div className="h-14 w-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                <Play className="h-6 w-6 text-foreground ml-0.5" />
              </div>
              <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[10px] font-medium text-white bg-black/60 rounded px-2 py-0.5 whitespace-nowrap">
                {adPreviewUrl ? "View Ad Post" : "Search Ad Library"}
              </span>
            </a>
          )}

          {/* Ad preview / Ad Library link badge */}
          {(adPreviewUrl || adLibraryUrl) && imgLoaded && (
            <a
              href={adPreviewUrl || adLibraryUrl!}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute bottom-2 right-2 z-10 inline-flex items-center gap-1.5 bg-white/90 hover:bg-white text-[11px] font-medium text-foreground/80 rounded-md px-2.5 py-1.5 shadow-sm transition-colors cursor-pointer"
              title={adPreviewUrl ? "View ad post on Facebook" : "Search in Ad Library"}
            >
              <ExternalLink className="h-3 w-3" />
              {adPreviewUrl ? "View Post" : "Ad Library"}
            </a>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-12">
          <ImageIcon className="h-8 w-8 text-muted-foreground" />
          <span className="font-body text-[13px] text-muted-foreground">No preview available</span>
          {(adPreviewUrl || adLibraryUrl) && (
            <a href={adPreviewUrl || adLibraryUrl!} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="secondary" className="gap-1.5 text-xs mt-1">
                <ExternalLink className="h-3 w-3" />{adPreviewUrl ? "View Post" : "Search Ad Library"}
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
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto bg-white rounded-[8px] shadow-modal">
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
