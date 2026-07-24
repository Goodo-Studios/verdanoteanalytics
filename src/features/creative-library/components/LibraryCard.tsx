import { useState } from "react";
import { LayoutGrid, Play, Vault as VaultIcon, Archive, Check, Tag } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { fmt } from "@/components/creatives/constants";
import { useCachedMedia } from "@/hooks/useCachedMedia";
import type { LibraryCreative } from "../api";
import type { ClassificationResult } from "../hooks/useCreativeLibrary";
import { ClassBadge } from "./ClassBadge";

function roasColor(roas: number | null | undefined): string {
  if (roas == null) return "text-charcoal";
  if (roas >= 2) return "text-verdant";
  if (roas < 1) return "text-red-700";
  return "text-charcoal";
}

/**
 * The still image by default; on hover it autoplays a muted, looping preview of
 * the captured video (Creative Vault parity), and a click plays it full with
 * controls + sound. Only creatives with a real captured file (video_url starting
 * with http — the preview-capture output) can hover-preview; Meta-only videos
 * keep the click-to-play poster. The preview <video> mounts only while hovered.
 */
function CardMedia({ creative }: { creative: LibraryCreative }) {
  const [playing, setPlaying] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [imgError, setImgError] = useState(false);
  const posterSrc =
    creative.thumbnail_url && creative.thumbnail_url !== "no-thumbnail"
      ? creative.thumbnail_url
      : creative.full_res_url && creative.full_res_url !== "no-thumbnail"
        ? creative.full_res_url
        : "";
  const { url: posterUrl, isLoading } = useCachedMedia(posterSrc);
  const hasVideo = !!creative.video_url && creative.video_url !== "no-video";
  const realVideo = hasVideo && creative.video_url!.startsWith("http");

  // Full click-to-play (controls + sound) takes over the whole tile.
  if (playing && hasVideo) {
    return (
      <video
        src={creative.video_url!}
        className="h-full w-full object-contain bg-black"
        controls
        autoPlay
        playsInline
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {isLoading && <div className="absolute inset-0 bg-cream-dark animate-pulse" />}
      {posterSrc && !imgError ? (
        <img
          src={posterUrl}
          alt={creative.ad_name}
          className={`h-full w-full object-contain transition-opacity duration-300 ${isLoading ? "opacity-0" : "opacity-100"}`}
          loading="lazy"
          onError={() => setImgError(true)}
        />
      ) : (
        <LayoutGrid className="h-6 w-6 text-muted-foreground" />
      )}
      {/* Hover preview: muted autoplay loop (Vault parity). Mounted only on hover. */}
      {hovered && realVideo && (
        <video
          key={creative.video_url}
          src={creative.video_url!}
          autoPlay
          muted
          playsInline
          loop
          className="absolute inset-0 h-full w-full object-contain bg-muted pointer-events-none"
        />
      )}
      {hasVideo && (
        <button
          type="button"
          className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/20 transition-colors group"
          onClick={(e) => {
            e.stopPropagation();
            setPlaying(true);
          }}
          aria-label="Play video"
        >
          {/* Hide the play badge while the hover preview is running. */}
          {!(hovered && realVideo) && (
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 shadow-md group-hover:scale-105 transition-transform">
              <Play className="h-4 w-4 text-charcoal fill-charcoal ml-0.5" />
            </span>
          )}
        </button>
      )}
    </div>
  );
}

interface LibraryCardProps {
  creative: LibraryCreative;
  classification?: ClassificationResult;
  onOpen: (c: LibraryCreative) => void;
  /** US-004: open the governed matrix-axis tag editor for this creative. */
  onTag?: (c: LibraryCreative) => void;
  selected: boolean;
  onToggleSelect: (adId: string) => void;
}

export function LibraryCard({ creative: c, classification, onOpen, onTag, selected, onToggleSelect }: LibraryCardProps) {
  return (
    <div
      className={cn(
        "bg-card border rounded-card shadow-card transition-[box-shadow] duration-150 hover:shadow-card-hover relative flex flex-col",
        selected ? "border-verdant border-2" : "border-border-light",
      )}
    >
      {/* Select checkbox for bulk export + governed tag affordance */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        {onTag && (
          <button
            type="button"
            onClick={() => onTag(c)}
            aria-label="Tag matrix axes"
            title="Tag Theme/Persona, creative type, body"
            className="flex h-5 w-5 items-center justify-center rounded-[3px] bg-white/90 text-charcoal shadow-sm hover:bg-white"
          >
            <Tag className="h-3 w-3" />
          </button>
        )}
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelect(c.ad_id)}
          aria-label="Select creative for export"
          className="h-5 w-5 bg-white/90 data-[state=checked]:bg-verdant data-[state=checked]:border-verdant shadow-sm"
        />
      </div>

      {/* Status flags */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-1">
        {c.archived && (
          <span className="inline-flex items-center gap-0.5 rounded-[3px] bg-charcoal/80 px-1 py-0.5 text-[9px] font-semibold text-white" title="Durably archived">
            <Archive className="h-2.5 w-2.5" /> Saved
          </span>
        )}
        {c.in_vault && (
          <span className="inline-flex items-center gap-0.5 rounded-[3px] bg-verdant/90 px-1 py-0.5 text-[9px] font-semibold text-white" title="In Creative Vault">
            <VaultIcon className="h-2.5 w-2.5" /> Vault
          </span>
        )}
      </div>

      {/* Media */}
      <div className="bg-muted rounded-t-card aspect-[4/3] flex items-center justify-center overflow-hidden relative">
        <CardMedia creative={c} />
      </div>

      {/* Body — click opens detail */}
      <button type="button" className="text-left px-3 pt-2.5 pb-2 flex-1" onClick={() => onOpen(c)}>
        <div className="flex items-center gap-1.5 mb-1">
          {classification && <ClassBadge klass={classification.klass} />}
        </div>
        <p className="font-body text-[12px] font-medium text-charcoal truncate">{c.ad_name}</p>
        {c.unique_code && <p className="font-body text-[11px] text-sage truncate mt-0.5">{c.unique_code}</p>}
        {classification && classification.reasons.length > 0 && (
          <p className="font-body text-[10px] text-muted-foreground truncate mt-1" title={classification.reasons.join(" · ")}>
            {classification.reasons[0]}
          </p>
        )}
      </button>

      {/* Metrics */}
      <button
        type="button"
        className="border-t border-border-light grid grid-cols-3 gap-1 text-center py-2 px-3"
        onClick={() => onOpen(c)}
      >
        <div>
          <div className="font-label text-[9px] uppercase tracking-[0.06em] text-sage font-medium">ROAS</div>
          <div className={`font-data text-[16px] font-semibold tabular-nums ${roasColor(c.roas)}`}>{fmt(c.roas, "", "x")}</div>
        </div>
        <div>
          <div className="font-label text-[9px] uppercase tracking-[0.06em] text-sage font-medium">CPA</div>
          <div className="font-data text-[16px] font-semibold text-charcoal tabular-nums">{fmt(c.cpa, "$")}</div>
        </div>
        <div>
          <div className="font-label text-[9px] uppercase tracking-[0.06em] text-sage font-medium">Spend</div>
          <div className="font-data text-[16px] font-semibold text-charcoal tabular-nums">{fmt(c.spend, "$")}</div>
        </div>
      </button>
    </div>
  );
}
