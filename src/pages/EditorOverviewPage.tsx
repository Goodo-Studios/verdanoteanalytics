import { AppLayout } from "@/components/AppLayout";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, LayoutGrid, Video, Image as ImageIcon, Play, AlertCircle, TrendingUp, Award, Percent, Film } from "lucide-react";
import { useState, useMemo, useCallback } from "react";
import { useCreatives } from "@/hooks/useCreatives";
import { useAccountContext } from "@/contexts/AccountContext";
import { cn } from "@/lib/utils";

function fmt$(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number) {
  return `${n.toFixed(2)}%`;
}

function roasColor(roas: number): string {
  if (roas >= 2) return "text-verdant";
  if (roas < 1) return "text-red-600";
  return "text-[#92730F]";
}

function roasDotColor(roas: number): string {
  if (roas >= 2) return "bg-verdant";
  if (roas < 1) return "bg-red-500";
  return "bg-gold";
}

function roasStatusLabel(roas: number): { label: string; cls: string } {
  if (roas >= 2) return { label: "Winning", cls: "bg-sage-light text-verdant" };
  if (roas < 1) return { label: "Needs Work", cls: "bg-red-50 text-red-700" };
  return { label: "In Progress", cls: "bg-gold-light text-[#92730F]" };
}

const EDITOR_METRICS = [
  { key: "roas", label: "ROAS", fmt: (v: number) => `${v.toFixed(2)}x` },
  { key: "spend", label: "Spend", fmt: (v: number) => fmt$(v) },
  { key: "purchases", label: "Purchases", fmt: (v: number) => v.toLocaleString() },
  { key: "ctr", label: "CTR", fmt: (v: number) => fmtPct(v) },
  { key: "thumb_stop_rate", label: "Thumb Stop", fmt: (v: number) => fmtPct(v) },
  { key: "cpa", label: "CPA", fmt: (v: number) => fmt$(v) },
];

const EditorOverviewPage = () => {
  const { selectedAccountId, selectedAccount } = useAccountContext();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedCreative, setSelectedCreative] = useState<any>(null);

  const spendThreshold = parseFloat(selectedAccount?.iteration_spend_threshold || "50");

  const allFilters = useMemo(() => ({
    ...(selectedAccountId && selectedAccountId !== "all" ? { account_id: selectedAccountId } : {}),
    ...(search ? { search } : {}),
  }), [selectedAccountId, search]);

  const { data: creativesResult, isLoading } = useCreatives(allFilters, 0);
  const rawCreatives = creativesResult?.data || [];

  // All creatives with spend >= threshold, sorted ROAS desc
  const filteredCreatives = useMemo(() => {
    let list = rawCreatives.filter((c: any) => (Number(c.spend) || 0) >= spendThreshold);

    if (statusFilter === "winning") {
      list = list.filter((c: any) => (Number(c.roas) || 0) >= 2);
    } else if (statusFilter === "needs_work") {
      list = list.filter((c: any) => (Number(c.roas) || 0) < 1);
    }

    list.sort((a: any, b: any) => (Number(b.roas) || 0) - (Number(a.roas) || 0));
    return list;
  }, [rawCreatives, statusFilter, spendThreshold]);

  // Hero metrics
  const heroMetrics = useMemo(() => {
    const withSpend = rawCreatives.filter((c: any) => (Number(c.spend) || 0) >= spendThreshold);
    const total = withSpend.length;
    const avgRoas = total > 0
      ? withSpend.reduce((s: number, c: any) => s + (Number(c.roas) || 0), 0) / total
      : 0;
    const best = withSpend.reduce<any>((best, c) => {
      return (Number(c.roas) || 0) > (Number(best?.roas) || 0) ? c : best;
    }, null);
    const above2x = total > 0
      ? (withSpend.filter((c: any) => (Number(c.roas) || 0) >= 2).length / total) * 100
      : 0;
    return { total, avgRoas, best, above2x };
  }, [rawCreatives, spendThreshold]);

  return (
    <AppLayout>
      <div className="space-y-7">
        {/* Motivational banner */}
        <div className="bg-sage-light border border-verdant/20 rounded-[8px] px-5 py-3 flex items-center gap-3">
          <TrendingUp className="h-4 w-4 text-verdant flex-shrink-0" />
          <p className="font-body text-[13px] text-verdant font-medium">
            Updated daily. All metrics reflect the last 14 days of ad performance.
          </p>
        </div>

        {/* Header */}
        <div>
          <h1 className="font-heading text-[36px] text-forest">Your Creatives</h1>
          <p className="font-body text-[14px] text-slate font-light mt-1">See how your edits are performing</p>
        </div>

        {/* Hero Metrics Row */}
        {!isLoading && (
          <div className="bg-white border border-border-light rounded-[8px] flex items-stretch divide-x divide-border-light overflow-hidden">
            {/* Total Creatives */}
            <div className="flex-1 px-6 py-5 flex items-start gap-3">
              <div className="mt-0.5 h-8 w-8 rounded-[6px] bg-sage-light flex items-center justify-center flex-shrink-0">
                <Film className="h-4 w-4 text-verdant" />
              </div>
              <div>
                <p className="font-label text-[10px] uppercase tracking-[0.08em] text-sage font-medium">Active Creatives</p>
                <p className="font-data text-[32px] font-semibold text-charcoal tabular-nums leading-tight">{heroMetrics.total}</p>
                <p className="font-body text-[11px] text-sage mt-0.5">with spend this period</p>
              </div>
            </div>
            {/* Avg ROAS */}
            <div className="flex-1 px-6 py-5 flex items-start gap-3">
              <div className="mt-0.5 h-8 w-8 rounded-[6px] bg-sage-light flex items-center justify-center flex-shrink-0">
                <TrendingUp className="h-4 w-4 text-verdant" />
              </div>
              <div>
                <p className="font-label text-[10px] uppercase tracking-[0.08em] text-sage font-medium">Avg ROAS</p>
                <p className={cn("font-data text-[32px] font-semibold tabular-nums leading-tight", roasColor(heroMetrics.avgRoas))}>
                  {heroMetrics.avgRoas.toFixed(2)}x
                </p>
                <p className="font-body text-[11px] text-sage mt-0.5">across all your work</p>
              </div>
            </div>
            {/* Best Performer */}
            <div className="flex-1 px-6 py-5 flex items-start gap-3">
              <div className="mt-0.5 h-8 w-8 rounded-[6px] bg-sage-light flex items-center justify-center flex-shrink-0">
                <Award className="h-4 w-4 text-verdant" />
              </div>
              <div className="min-w-0">
                <p className="font-label text-[10px] uppercase tracking-[0.08em] text-sage font-medium">Best Performer</p>
                {heroMetrics.best ? (
                  <>
                    <p className="font-data text-[20px] font-semibold text-verdant tabular-nums leading-tight">
                      {(Number(heroMetrics.best.roas) || 0).toFixed(2)}x
                    </p>
                    <p className="font-body text-[11px] text-charcoal truncate mt-0.5 max-w-[160px]">{heroMetrics.best.ad_name}</p>
                  </>
                ) : (
                  <p className="font-data text-[20px] font-semibold text-sage tabular-nums leading-tight">—</p>
                )}
              </div>
            </div>
            {/* % Above 2x ROAS */}
            <div className="flex-1 px-6 py-5 flex items-start gap-3">
              <div className="mt-0.5 h-8 w-8 rounded-[6px] bg-sage-light flex items-center justify-center flex-shrink-0">
                <Percent className="h-4 w-4 text-verdant" />
              </div>
              <div>
                <p className="font-label text-[10px] uppercase tracking-[0.08em] text-sage font-medium">Above 2x ROAS</p>
                <p className={cn("font-data text-[32px] font-semibold tabular-nums leading-tight", heroMetrics.above2x >= 50 ? "text-verdant" : heroMetrics.above2x >= 25 ? "text-[#92730F]" : "text-charcoal")}>
                  {heroMetrics.above2x.toFixed(0)}%
                </p>
                <p className="font-body text-[11px] text-sage mt-0.5">of your creatives winning</p>
              </div>
            </div>
          </div>
        )}

        {/* Loading state for hero */}
        {isLoading && (
          <div className="bg-white border border-border-light rounded-[8px] flex items-stretch divide-x divide-border-light overflow-hidden">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex-1 px-6 py-5">
                <div className="h-3 w-24 bg-cream-dark rounded animate-pulse mb-3" />
                <div className="h-8 w-20 bg-cream-dark rounded animate-pulse mb-2" />
                <div className="h-2.5 w-32 bg-cream-dark rounded animate-pulse" />
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-sage" />
            <Input
              placeholder="Search your creatives..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 font-body text-[13px] pl-8 placeholder:text-sage"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 h-8 font-body text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Creatives</SelectItem>
              <SelectItem value="winning">Winning (≥ 2x)</SelectItem>
              <SelectItem value="needs_work">Needs Work (&lt; 1x)</SelectItem>
            </SelectContent>
          </Select>
          {!isLoading && (
            <p className="font-body text-[12px] text-sage ml-auto">
              {filteredCreatives.length} creative{filteredCreatives.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>

        {/* Creative Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-white border border-border-light rounded-[8px] overflow-hidden">
                <div className="w-full aspect-video bg-cream-dark animate-pulse" />
                <div className="p-3.5 space-y-2">
                  <div className="h-3 w-3/4 bg-cream-dark rounded animate-pulse" />
                  <div className="flex gap-4">
                    <div className="h-6 w-16 bg-cream-dark rounded animate-pulse" />
                    <div className="h-6 w-12 bg-cream-dark rounded animate-pulse" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : filteredCreatives.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Film className="h-12 w-12 text-sage mb-4" />
            <h3 className="font-heading text-[20px] text-forest mb-1">No creatives here yet</h3>
            <p className="font-body text-[14px] text-slate max-w-xs">
              {search
                ? "Try a different search term."
                : statusFilter === "winning"
                ? "None of your creatives are at 2x ROAS yet — keep pushing."
                : statusFilter === "needs_work"
                ? "Nothing below 1x — that's actually great news."
                : "Your creatives will appear here once data comes in."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredCreatives.map((c: any) => {
              const roas = Number(c.roas) || 0;
              const spend = Number(c.spend) || 0;
              const ctr = Number(c.ctr) || 0;
              const thumbStop = Number(c.thumb_stop_rate) || 0;
              const status = roasStatusLabel(roas);
              return (
                <div
                  key={c.ad_id}
                  className="bg-white border border-border-light rounded-[8px] shadow-card hover:shadow-card-hover transition-all duration-150 cursor-pointer group"
                  onClick={() => setSelectedCreative(c)}
                >
                  {/* Thumbnail */}
                  <div className="relative overflow-hidden rounded-t-[6px]">
                    {c.thumbnail_url ? (
                      <img
                        src={c.thumbnail_url}
                        alt=""
                        className="w-full aspect-video object-cover group-hover:scale-[1.02] transition-transform duration-200"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full aspect-video bg-cream-dark flex items-center justify-center">
                        <LayoutGrid className="h-6 w-6 text-sage" />
                      </div>
                    )}
                    {/* Video badge */}
                    {(c.video_views > 0 || (c.video_url && c.video_url !== "no-video")) && (
                      <div className="absolute top-1.5 left-1.5 bg-charcoal/80 rounded-[3px] px-1.5 py-0.5 flex items-center gap-0.5">
                        <Video className="h-3 w-3 text-white" />
                        <span className="font-label text-[9px] font-semibold uppercase tracking-wide text-white">Video</span>
                      </div>
                    )}
                    {/* Status dot */}
                    <div className={cn("absolute top-2 right-2 h-3 w-3 rounded-full shadow-sm ring-2 ring-white", roasDotColor(roas))} />
                    {/* Play hint overlay */}
                    {c.video_url && c.video_url !== "no-video" && (
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-150 flex items-center justify-center opacity-0 group-hover:opacity-100">
                        <div className="h-10 w-10 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                          <Play className="h-4 w-4 text-charcoal ml-0.5" />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Card body */}
                  <div className="px-3.5 py-3">
                    <p className="font-body text-[13px] font-semibold text-charcoal truncate mb-2.5">{c.ad_name}</p>

                    {/* Core metrics */}
                    <div className="flex items-end gap-4 mb-2.5">
                      <div>
                        <p className="font-label text-[9px] uppercase tracking-[0.06em] text-sage">ROAS</p>
                        <p className={cn("font-data text-[20px] font-semibold tabular-nums leading-tight", roasColor(roas))}>
                          {roas.toFixed(2)}x
                        </p>
                      </div>
                      <div>
                        <p className="font-label text-[9px] uppercase tracking-[0.06em] text-sage">Spend</p>
                        <p className="font-data text-[14px] font-medium text-charcoal tabular-nums">{fmt$(spend)}</p>
                      </div>
                      <div>
                        <p className="font-label text-[9px] uppercase tracking-[0.06em] text-sage">CTR</p>
                        <p className="font-data text-[14px] font-medium text-charcoal tabular-nums">{fmtPct(ctr)}</p>
                      </div>
                    </div>

                    {/* Hook rate */}
                    {thumbStop > 0 && (
                      <div className="mb-2.5">
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-label text-[9px] uppercase tracking-[0.06em] text-sage">Thumb Stop</p>
                          <p className="font-label text-[9px] text-sage">{fmtPct(thumbStop)}</p>
                        </div>
                        <div className="h-1 bg-cream-dark rounded-full overflow-hidden">
                          <div
                            className={cn("h-full rounded-full transition-all duration-300", thumbStop >= 25 ? "bg-verdant" : thumbStop >= 15 ? "bg-gold" : "bg-red-400")}
                            style={{ width: `${Math.min(thumbStop, 60)}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Status badge */}
                    <span className={cn("inline-block font-label text-[9px] font-semibold uppercase tracking-[0.08em] px-2 py-0.5 rounded-[3px]", status.cls)}>
                      {status.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Creative Detail Modal */}
      <EditorCreativeDetailModal
        creative={selectedCreative}
        open={!!selectedCreative}
        onClose={() => setSelectedCreative(null)}
      />
    </AppLayout>
  );
};

function EditorCreativeDetailModal({
  creative, open, onClose,
}: { creative: any; open: boolean; onClose: () => void }) {
  const [showVideo, setShowVideo] = useState(false);
  const [videoError, setVideoError] = useState(false);

  const handleClose = useCallback(() => {
    setShowVideo(false);
    setVideoError(false);
    onClose();
  }, [onClose]);

  if (!creative) return null;

  const roas = Number(creative.roas) || 0;
  const hasVideo = !!creative.video_url && creative.video_url !== "no-video";
  const status = roasStatusLabel(roas);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-[8px] shadow-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span className="font-body text-[16px] font-semibold text-charcoal">{creative.ad_name}</span>
            <span className={cn("font-label text-[10px] font-semibold uppercase tracking-[0.08em] px-2 py-0.5 rounded-[3px]", status.cls)}>
              {status.label}
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Media player */}
        <div className="bg-cream-dark rounded-[8px] overflow-hidden relative group">
          {hasVideo && showVideo ? (
            videoError ? (
              <div className="w-full h-[300px] flex flex-col items-center justify-center gap-3 text-slate">
                <AlertCircle className="h-8 w-8 text-sage" />
                <p className="font-body text-[13px] text-sage">This video can't be played directly here.</p>
                {creative.preview_url && (
                  <a href={creative.preview_url} target="_blank" rel="noopener noreferrer">
                    <button className="flex items-center gap-1.5 font-body text-[13px] font-medium text-verdant underline underline-offset-2">
                      <Video className="h-4 w-4" /> Watch on Facebook
                    </button>
                  </a>
                )}
                <button
                  onClick={() => { setShowVideo(false); setVideoError(false); }}
                  className="font-body text-[12px] text-sage underline mt-1"
                >
                  Back to thumbnail
                </button>
              </div>
            ) : (
              <video
                src={creative.video_url}
                controls
                autoPlay
                className="w-full max-h-[420px]"
                poster={creative.thumbnail_url}
                onError={() => setVideoError(true)}
              />
            )
          ) : creative.thumbnail_url ? (
            <div className="relative w-full">
              <img src={creative.thumbnail_url} alt="" className="w-full max-h-[420px] object-contain" />
              {hasVideo && (
                <button
                  onClick={() => { setShowVideo(true); setVideoError(false); }}
                  className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                >
                  <div className="h-14 w-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                    <Play className="h-6 w-6 text-charcoal ml-0.5" />
                  </div>
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-14">
              <ImageIcon className="h-8 w-8 text-sage" />
              <span className="font-body text-[13px] text-sage">No preview available</span>
            </div>
          )}
        </div>

        {/* Performance metrics */}
        <div>
          <p className="font-label text-[10px] font-semibold uppercase tracking-[0.08em] text-slate mb-2 pb-1.5 border-b border-border-light">
            Performance
          </p>
          <div className="grid grid-cols-3 gap-px bg-border-light rounded-[4px] overflow-hidden">
            {EDITOR_METRICS.map((m) => {
              const val = Number(creative[m.key]) || 0;
              const isRoas = m.key === "roas";
              return (
                <div key={m.key} className="bg-white py-3.5 px-2.5 text-center">
                  <p className="font-label text-[9px] uppercase tracking-[0.06em] text-sage">{m.label}</p>
                  <p className={cn(
                    "font-data text-[18px] font-semibold mt-0.5 tabular-nums",
                    isRoas ? roasColor(val) : "text-charcoal"
                  )}>
                    {m.fmt(val)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Thumb stop bar */}
        {(Number(creative.thumb_stop_rate) || 0) > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="font-label text-[10px] font-semibold uppercase tracking-[0.08em] text-slate">Thumb Stop Rate</p>
              <p className="font-data text-[13px] font-medium text-charcoal">{fmtPct(Number(creative.thumb_stop_rate) || 0)}</p>
            </div>
            <div className="h-2 bg-cream-dark rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full", (Number(creative.thumb_stop_rate) || 0) >= 25 ? "bg-verdant" : (Number(creative.thumb_stop_rate) || 0) >= 15 ? "bg-gold" : "bg-red-400")}
                style={{ width: `${Math.min(Number(creative.thumb_stop_rate) || 0, 60)}%` }}
              />
            </div>
            <p className="font-body text-[11px] text-sage mt-1">
              {(Number(creative.thumb_stop_rate) || 0) >= 25
                ? "Great hook — people are stopping to watch."
                : (Number(creative.thumb_stop_rate) || 0) >= 15
                ? "Decent hook rate — room to improve the opening seconds."
                : "Low hook rate — the first 3 seconds need work."}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default EditorOverviewPage;
