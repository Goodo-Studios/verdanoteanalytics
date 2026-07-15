// Landing Pages report (Creative Terminal — Phase 1, Feature 1), US-004: destination drill-in.
//
// Opened by clicking a destination card on LandingPagesPage. Lists every creative
// pointing at that destination_key over the current window, with per-creative
// performance and a playable thumbnail. Reads through the session-authed
// `landing-pages` edge function (getLandingPageCreatives) with the destination_key
// param — aggregation lives entirely in the SQL RPC.
import { useQuery } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { getLandingPageCreatives, type LandingPageCreativeRow } from "@/lib/api";

const usd = (n: number) =>
  `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const num = (n: number) => (n || 0).toLocaleString();
const x = (n: number) => `${(n || 0).toFixed(2)}x`;
const pct = (n: number) => `${(n || 0).toFixed(1)}%`;
const hostPath = (url: string) => url.replace(/^https?:\/\//, "");

// Media columns can be NULL or a "no-thumbnail"/"no-video" sentinel (see api.ts).
// Filter those out before treating a value as a real, renderable URL.
const isSentinel = (u: string | null) =>
  !u || u === "no-thumbnail" || u === "no-video";
const realUrl = (u: string | null): string | null => (isSentinel(u) ? null : u);

function CreativeThumb({ row }: { row: LandingPageCreativeRow }) {
  const thumb = realUrl(row.thumbnail_url) ?? realUrl(row.preview_url);
  const video = realUrl(row.video_url);

  return (
    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
      {thumb ? (
        <img
          src={thumb}
          alt={row.ad_name ?? row.ad_id}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
          No preview
        </div>
      )}
      {video && (
        <a
          href={video}
          target="_blank"
          rel="noreferrer"
          title="Play video"
          className="absolute inset-0 flex items-center justify-center bg-black/30 text-white transition-colors hover:bg-black/50"
        >
          <span className="text-lg leading-none">▶</span>
        </a>
      )}
    </div>
  );
}

export interface LandingPageCreativesDialogProps {
  accountId: string;
  destinationKey: string | null;
  from: string;
  to: string;
  open: boolean;
  onClose: () => void;
}

export function LandingPageCreativesDialog({
  accountId, destinationKey, from, to, open, onClose,
}: LandingPageCreativesDialogProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["landing-page-creatives", accountId, destinationKey, from, to],
    queryFn: () => getLandingPageCreatives(accountId, destinationKey as string, from, to),
    enabled: open && !!accountId && !!destinationKey,
  });

  const rows = data?.rows ?? [];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="break-all text-sm font-medium">
            {destinationKey ? (
              <a
                href={destinationKey}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                {hostPath(destinationKey)}
              </a>
            ) : "Destination"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Creatives pointing at this destination over the selected window.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="p-4 text-sm text-muted-foreground">Loading creatives…</div>
        )}
        {error && (
          <div className="p-4 text-sm text-red-600">
            Couldn’t load creatives: {(error as Error).message}
          </div>
        )}
        {!isLoading && !error && !rows.length && (
          <div className="p-4 text-sm text-muted-foreground">
            No creatives found for this destination in the selected window.
          </div>
        )}

        {!isLoading && !error && rows.length > 0 && (
          <div className="space-y-3">
            <Badge variant="secondary">{rows.length} creative{rows.length === 1 ? "" : "s"}</Badge>
            <ul className="space-y-2">
              {rows.map((r) => (
                <li
                  key={r.ad_id}
                  className="flex items-start gap-3 rounded-md border p-3"
                >
                  <CreativeThumb row={r} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium" title={r.ad_name ?? r.ad_id}>
                      {r.ad_name || r.ad_id}
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                      <Stat label="Spend" value={usd(r.spend)} />
                      <Stat label="ROAS" value={x(r.roas)} />
                      <Stat label="CPA" value={usd(r.cpa)} />
                      <Stat label="CTR" value={pct(r.ctr)} />
                      <Stat label="CPC" value={usd(r.cpc)} />
                      <Stat label="Clicks" value={num(r.clicks)} />
                      <Stat label="Purchases" value={num(r.purchases)} />
                      <Stat label="Impr." value={num(r.impressions)} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
