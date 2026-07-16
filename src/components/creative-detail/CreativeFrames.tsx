import { useState } from "react";
import { Image as ImageIcon, Loader2 } from "lucide-react";
import { useCreativeFrames } from "@/hooks/useCreativeFrames";
import type { CreativeFrame } from "@/features/vault/types/vault";

interface CreativeFramesProps {
  adId: string;
  /** Ad-level fallback media when a frame has no cached asset yet. */
  fallbackThumbnailUrl?: string | null;
  /** Expected number of frames (creatives.expected_frame_count); used only for the header count. */
  expectedFrameCount?: number | null;
}

function isVideoFrame(frame: CreativeFrame): boolean {
  const contentType = frame.media_assets?.content_type?.toLowerCase() ?? "";
  if (contentType.startsWith("video/")) return true;
  return frame.media_type === "video";
}

function FrameTile({
  frame,
  index,
  fallbackThumbnailUrl,
}: {
  frame: CreativeFrame;
  index: number;
  fallbackThumbnailUrl?: string | null;
}) {
  const [imgError, setImgError] = useState(false);

  const publicUrl = frame.media_assets?.public_url || null;
  const isVideo = isVideoFrame(frame);
  // Frame not yet cached (asset_id/public_url missing): fall back to the ad thumbnail
  // for a still frame, or a "pending" placeholder when there is nothing to show.
  const effectiveUrl = publicUrl || (isVideo ? null : fallbackThumbnailUrl || null);
  const pending = !effectiveUrl;

  return (
    <div className="shrink-0 w-[160px] space-y-1.5">
      <div className="relative bg-muted rounded-lg overflow-hidden aspect-[4/5] flex items-center justify-center">
        {isVideo && publicUrl && !imgError ? (
          <video
            src={publicUrl}
            controls
            poster={fallbackThumbnailUrl || undefined}
            className="max-w-full max-h-full w-auto h-auto block"
            onError={() => setImgError(true)}
          />
        ) : effectiveUrl && !imgError ? (
          <img
            src={effectiveUrl}
            alt={`Frame ${index + 1}`}
            className="max-w-full max-h-full w-auto h-auto block"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-1.5 px-2 text-center">
            <ImageIcon className="h-6 w-6 text-muted-foreground/50" />
            <span className="font-body text-[11px] text-muted-foreground">
              {pending ? "Frame pending" : "Unavailable"}
            </span>
          </div>
        )}
        <span className="absolute top-1.5 left-1.5 bg-black/60 text-white font-label text-[10px] font-semibold px-1.5 py-0.5 rounded">
          {index + 1}
        </span>
      </div>
    </div>
  );
}

/**
 * Renders every frame of a (carousel) creative in render order (frame_index ASC),
 * images and videos alike, as a horizontal strip. Frames whose media has not been
 * cached fall back to the ad thumbnail or a "frame pending" placeholder. US-004.
 */
export function CreativeFrames({
  adId,
  fallbackThumbnailUrl,
  expectedFrameCount,
}: CreativeFramesProps) {
  const { data: frames = [], isLoading } = useCreativeFrames(adId);

  // Single-frame (or no-frame) creatives already render via the main MediaPreview —
  // only surface the strip when there are multiple frames to show in order.
  if (!isLoading && frames.length <= 1) return null;

  const count = frames.length || expectedFrameCount || 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h4 className="font-label text-[12px] font-semibold text-foreground tracking-wide">
          Carousel frames
        </h4>
        {count > 0 && (
          <span className="font-body text-[11px] text-muted-foreground">{count}</span>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-6 justify-center">
          <Loader2 className="h-5 w-5 text-muted-foreground/50 animate-spin" />
          <span className="font-body text-[12px] text-muted-foreground">Loading frames…</span>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {frames.map((frame, i) => (
            <FrameTile
              key={frame.id}
              frame={frame}
              index={i}
              fallbackThumbnailUrl={fallbackThumbnailUrl}
            />
          ))}
        </div>
      )}
    </div>
  );
}
