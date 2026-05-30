import { useState } from "react";
import { Image as ImageIcon, Loader2, Trophy } from "lucide-react";
import { useCachedMedia } from "@/hooks/useCachedMedia";
import { ClientEmptyState } from "@/components/client/ClientEmptyState";

/**
 * The shape a winner card needs. Intentionally narrow + client-safe: only the
 * fields required to play the video and frame revenue/ROAS. NO internal grade,
 * Hook Rate, CPA, kill/scale, or threshold fields are accepted or rendered.
 */
export interface ClientWinner {
  id: string;
  ad_name?: string | null;
  video_url?: string | null;
  thumbnail_url?: string | null;
  full_res_url?: string | null;
  spend?: number | null;
  roas?: number | null;
  purchase_value?: number | null;
}

const NO_VIDEO = "no-video";
const NO_THUMB = "no-thumbnail";

function money(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function roasBack(roas: number): string {
  return roas.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * A single winning creative. Reuses the native render path from
 * CreativeDetailModal's MediaPreview (<video controls poster src>), but in a
 * client-safe card that strips all internal strategist metrics.
 *
 * MANDATORY: the <video> carries key={ad.id} (soft policy
 * goodo-verdanote-react-video-key-prop) so a remounting parent that swaps
 * creatives forces a fresh media-element lifecycle instead of reusing a stale
 * <video> DOM node.
 */
function WinnerCard({ ad }: { ad: ClientWinner }) {
  const [videoError, setVideoError] = useState(false);
  const [videoLoading, setVideoLoading] = useState(true);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  const rawThumbnailUrl =
    (ad.full_res_url && ad.full_res_url !== NO_THUMB ? ad.full_res_url : null) ||
    (ad.thumbnail_url && ad.thumbnail_url !== NO_THUMB ? ad.thumbnail_url : null) ||
    null;

  // media uses useCachedMedia where applicable (AC4)
  const { url: cachedThumbnailUrl } = useCachedMedia(rawThumbnailUrl, {
    placeholderUrl: "/placeholder-creative.png",
  });

  const hasVideoUrl = !!(ad.video_url && ad.video_url !== NO_VIDEO);
  const hasThumbnail = !!rawThumbnailUrl;

  const spend = Number(ad.spend) || 0;
  const revenue = Number(ad.purchase_value) || 0;
  const roas = Number(ad.roas) || (spend > 0 ? revenue / spend : 0);

  return (
    <div className="bg-card border border-border-light rounded-[8px] overflow-hidden">
      <div className="bg-muted relative flex items-center justify-center w-full min-h-[200px]">
        {hasVideoUrl && !videoError ? (
          <>
            {videoLoading && (
              <div className="absolute inset-0 bg-muted animate-pulse flex items-center justify-center">
                <Loader2 className="h-8 w-8 text-muted-foreground/40 animate-spin" />
              </div>
            )}
            <video
              // MANDATORY stable key — forces remount when the creative changes.
              key={ad.id}
              src={ad.video_url ?? undefined}
              controls
              className={`max-w-full max-h-[420px] w-auto h-auto block transition-opacity duration-300 ${
                videoLoading ? "opacity-0 absolute" : "opacity-100"
              }`}
              poster={cachedThumbnailUrl || undefined}
              onLoadStart={() => setVideoLoading(true)}
              onCanPlay={() => setVideoLoading(false)}
              onError={() => {
                setVideoError(true);
                setVideoLoading(false);
              }}
            />
          </>
        ) : hasThumbnail ? (
          <>
            {!imgLoaded && !imgError && (
              <div className="absolute inset-0 bg-muted animate-pulse flex items-center justify-center">
                <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
              </div>
            )}
            <img
              src={cachedThumbnailUrl}
              alt={ad.ad_name ?? "Winning ad"}
              className={`max-w-full max-h-[420px] w-auto h-auto block transition-opacity duration-300 ${
                imgLoaded ? "opacity-100" : "opacity-0 absolute"
              }`}
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgError(true)}
            />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-10">
            <ImageIcon className="h-8 w-8 text-muted-foreground" />
            <span className="font-body text-[13px] text-muted-foreground">No preview available</span>
          </div>
        )}
      </div>

      {/* Client-safe context only: revenue + ROAS framing. No grade/threshold/CPA. */}
      <div className="p-4 space-y-3">
        {ad.ad_name && (
          <p className="font-body text-[13px] text-charcoal font-medium truncate" title={ad.ad_name}>
            {ad.ad_name}
          </p>
        )}
        <div className="flex items-end gap-6">
          <div>
            <p className="font-label text-[10px] uppercase tracking-[0.06em] text-sage font-medium">
              Revenue
            </p>
            <p className="font-data text-[20px] font-semibold tabular-nums text-charcoal mt-0.5">
              {money(revenue)}
            </p>
          </div>
          <div>
            <p className="font-label text-[10px] uppercase tracking-[0.06em] text-sage font-medium">
              Return on ad spend
            </p>
            <p className="font-data text-[20px] font-semibold tabular-nums text-verdant mt-0.5">
              {roasBack(roas)} back
            </p>
          </div>
        </div>
        <p className="font-body text-[12px] text-slate font-light">
          For every $1 you spent on this ad
        </p>
      </div>
    </div>
  );
}

export interface ClientWinnersSectionProps {
  winners: ClientWinner[];
  isLoading?: boolean;
}

/**
 * "What's working" — the client-facing list of current winners, each with its
 * video playable inline. Who counts as a "winner" comes from the shared
 * winner-selection logic (see selectWinners / useOverviewPageState) so client
 * and strategist agree. This surface shows revenue/ROAS framing only — never
 * Hook Rate, kill/scale grade, CPA, or any threshold UI.
 */
export function ClientWinnersSection({ winners, isLoading }: ClientWinnersSectionProps) {
  return (
    <div className="space-y-5" data-testid="client-winners">
      <div>
        <h2 className="font-heading text-[20px] text-forest">What&rsquo;s working</h2>
        <p className="font-body text-[13px] text-slate font-light mt-0.5">
          Your current winning ads — watch what&rsquo;s driving results
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="bg-card border border-border-light rounded-[8px] h-[320px] animate-pulse"
            />
          ))}
        </div>
      ) : winners.length === 0 ? (
        <ClientEmptyState
          icon={Trophy}
          heading="Winners show up here once your creatives gather enough data"
          subcopy="As your ads run and results come in, your top performers will appear here — ready to watch."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {winners.map((ad) => (
            <WinnerCard key={ad.id} ad={ad} />
          ))}
        </div>
      )}
    </div>
  );
}

export default ClientWinnersSection;
