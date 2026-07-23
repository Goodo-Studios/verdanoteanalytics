import { TagSourceBadge } from "@/components/TagSourceBadge";
import { Checkbox } from "@/components/ui/checkbox";
import { LayoutGrid, Video, Zap as ZapIcon } from "lucide-react";
import { useState } from "react";
import { fmt } from "./constants";
import { cn } from "@/lib/utils";
import { useCachedMedia } from "@/hooks/useCachedMedia";
import { RoasTrendArrow } from "./RoasTrendArrow";
import { GradeBadge } from "./GradeBadge";
import { PlatformBadge } from "./PlatformBadge";
import type { WoWTrend } from "@/hooks/useWoWTrends";
import type { GradeInfo } from "@/lib/creativeGrading";
import type { FatigueResult } from "@/lib/fatigueScore";
import type { CardPresenceUser } from "@/hooks/useCardPresence";

interface CreativesCardGridProps {
  creatives: any[];
  onSelect: (creative: any) => void;
  wowTrends?: Map<string, WoWTrend>;
  gradeMap?: Map<string, GradeInfo>;
  fatigueMap?: Map<string, FatigueResult>;
  // Bulk multi-select (US-004): when provided, each card shows a selection
  // checkbox and clicking the card toggles selection instead of opening detail.
  bulkSelectedIds?: Set<string>;
  onBulkToggle?: (adId: string) => void;

  hoveredCards?: Map<string, CardPresenceUser[]>;
  onCardHover?: (adId: string | null) => void;
  optimizationGoal?: string;
}

function CardThumbnail({ src, alt }: { src: string; alt: string }) {
  const { url, isLoading, error } = useCachedMedia(src);
  const [imgError, setImgError] = useState(false);

  if (imgError || !src) {
    return <LayoutGrid className="h-6 w-6 text-muted-foreground" />;
  }

  return (
    <>
      {isLoading && <div className="absolute inset-0 bg-cream-dark rounded animate-pulse" />}
      <img
        src={url}
        alt={alt}
        className={`h-full w-full object-contain transition-opacity duration-300 ${isLoading ? "opacity-0" : "opacity-100"}`}
        loading="lazy"
        onError={() => setImgError(true)}
      />
    </>
  );
}

/**
 * Card media: thumbnail by default, and on hover an autoplaying muted loop of the
 * captured video (Creative Vault parity). Only creatives with a real captured
 * video file (video_url starting with http — the preview-capture output) can
 * hover-play; Meta-only videos with no owned file keep the static thumbnail. The
 * <video> is mounted only while hovered, so the grid stays light until intent.
 */
function CardMedia({ c }: { c: any }) {
  const [hovered, setHovered] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const hasThumb = c.thumbnail_url && c.thumbnail_url !== "no-thumbnail";
  const realVideo = typeof c.video_url === "string" && c.video_url.startsWith("http");
  const showVideo = hovered && realVideo && !videoError;

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hasThumb ? (
        <CardThumbnail src={c.thumbnail_url} alt={c.ad_name || ""} />
      ) : (
        <LayoutGrid className="h-6 w-6 text-muted-foreground" />
      )}
      {showVideo && (
        <video
          key={c.video_url}
          src={c.video_url}
          autoPlay
          muted
          playsInline
          loop
          onError={() => setVideoError(true)}
          className="absolute inset-0 h-full w-full object-contain bg-muted"
        />
      )}
    </div>
  );
}

function roasColor(roas: number | null | undefined): string {
  if (roas == null) return "text-charcoal";
  if (roas >= 2) return "text-verdant";
  if (roas < 1) return "text-red-700";
  return "text-charcoal";
}

export function CreativesCardGrid({ creatives, onSelect, wowTrends, gradeMap, fatigueMap, bulkSelectedIds, onBulkToggle, hoveredCards, onCardHover, optimizationGoal }: CreativesCardGridProps) {
  const isSessionGoal = (optimizationGoal ?? 'PURCHASE') === 'SESSION_CONVERSION';
  const bulkMode = !!onBulkToggle;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {creatives.map((c: any) => {
        const isBulkSelected = !!bulkSelectedIds?.has(c.ad_id);
        const viewers = hoveredCards?.get(c.ad_id);
        const handleCardClick = () => {
          if (bulkMode) { onBulkToggle!(c.ad_id); return; }
          onSelect(c);
        };
        return (
          <div
            key={c.ad_id}
            className={cn(
              "bg-card border rounded-card shadow-card cursor-pointer transition-[box-shadow,ring] duration-150 ease hover:shadow-card-hover relative",
              isBulkSelected ? "border-verdant border-2" : "border-border-light",
              viewers && viewers.length > 0 && "ring-2 ring-primary/40",
            )}
            onClick={handleCardClick}
            onMouseEnter={() => onCardHover?.(c.ad_id)}
            onMouseLeave={() => onCardHover?.(null)}
          >
            {/* Viewer name label */}
            {viewers && viewers.length > 0 && (
              <div className="absolute -top-2.5 left-3 z-20 flex items-center gap-1">
                {viewers.slice(0, 2).map((v) => (
                  <span
                    key={v.user_id}
                    className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground font-label text-[9px] font-semibold shadow-sm"
                  >
                    {v.name}
                  </span>
                ))}
              </div>
            )}
            {/* Bulk-select checkbox (US-004) */}
            {bulkMode && (
              <div className="absolute top-2 right-2 z-10" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={isBulkSelected}
                  onCheckedChange={() => onBulkToggle!(c.ad_id)}
                  aria-label="Select creative"
                  className="h-5 w-5 bg-white/90 data-[state=checked]:bg-verdant data-[state=checked]:border-verdant shadow-sm"
                />
              </div>
            )}

            {/* Thumbnail — hover to autoplay the captured video (Vault parity) */}
            <div className="bg-muted rounded-t-card aspect-[4/3] flex items-center justify-center overflow-hidden relative">
              <CardMedia c={c} />
              <div className="absolute top-1.5 left-1.5 z-10 flex items-center gap-1">
                {(c.video_views > 0) && (
                  <div className="bg-charcoal/80 rounded-[3px] px-1.5 py-0.5 flex items-center gap-0.5">
                    <Video className="h-3 w-3 text-white" />
                    <span className="font-label text-[9px] font-semibold uppercase tracking-wide text-white">Video</span>
                  </div>
                )}
                {c.platform && c.platform !== "meta" && <PlatformBadge platform={c.platform} />}
                {(c.version || 1) >= 3 && (
                  <div className="bg-primary/90 rounded-[3px] px-1.5 py-0.5">
                    <span className="font-label text-[9px] font-semibold text-primary-foreground">v{c.version}</span>
                  </div>
                )}
              </div>
              {gradeMap?.get(c.ad_id) && (
                <div className="absolute top-1.5 right-1.5 z-10">
                  <GradeBadge grade={gradeMap.get(c.ad_id)!.grade} />
                </div>
              )}
            </div>

            {/* Name & code area */}
            <div className="px-3 pt-2.5 pb-2">
              <div className="flex items-center justify-between mb-0.5">
                <div className="flex items-center gap-1 flex-1 min-w-0 mr-2">
                  <p className="font-body text-[12px] font-medium text-charcoal truncate">{c.ad_name}</p>
                </div>
                <TagSourceBadge source={c.tag_source} />
              </div>
              <p className="font-body text-[11px] font-normal text-sage truncate mt-0.5">{c.unique_code}</p>
            </div>

            {/* Metrics row */}
            <div className="border-t border-border-light grid grid-cols-3 gap-1 text-center py-2 px-3 relative">
              {isSessionGoal ? (
                <>
                  <div>
                    <div className="font-label text-[9px] uppercase tracking-[0.06em] text-sage font-medium">Sessions</div>
                    <div className="font-data text-[17px] font-semibold text-charcoal tabular-nums">{fmt(c.result_count, "", "", 0)}</div>
                  </div>
                  <div>
                    <div className="font-label text-[9px] uppercase tracking-[0.06em] text-sage font-medium">Cost/Session</div>
                    <div className="font-data text-[17px] font-semibold text-charcoal tabular-nums">{fmt(c.cost_per_result, "$")}</div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <div className="font-label text-[9px] uppercase tracking-[0.06em] text-sage font-medium">ROAS</div>
                    <div className={`font-data text-[17px] font-semibold tabular-nums ${roasColor(c.roas)} flex items-center justify-center gap-0.5`}>
                      {fmt(c.roas, "", "x")}
                      <RoasTrendArrow trend={wowTrends?.get(c.ad_id)} />
                    </div>
                  </div>
                  <div>
                    <div className="font-label text-[9px] uppercase tracking-[0.06em] text-sage font-medium">CPA</div>
                    <div className="font-data text-[17px] font-semibold text-charcoal tabular-nums">{fmt(c.cpa, "$")}</div>
                  </div>
                </>
              )}
              <div>
                <div className="font-label text-[9px] uppercase tracking-[0.06em] text-sage font-medium">Spend</div>
                <div className="font-data text-[17px] font-semibold text-charcoal tabular-nums">{fmt(c.spend, "$")}</div>
              </div>
              {/* Fatigue badge */}
              {fatigueMap?.get(c.ad_id)?.level === "high" && (
                <div className="absolute bottom-1.5 right-2">
                  <span className="font-label text-[9px] font-semibold text-red-600">🔥 High Fatigue</span>
                </div>
              )}
              {fatigueMap?.get(c.ad_id)?.level === "warning" && (
                <div className="absolute bottom-1.5 right-2">
                  <span className="font-label text-[9px] font-semibold text-amber-600">⚠️ Fatiguing</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
