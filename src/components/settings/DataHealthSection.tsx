import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useMutationWithToast } from "@/hooks/useMutationWithToast";

interface AccountHealth {
  id: string;
  name: string;
  creative_count: number;
  last_synced_at: string | null;
  with_spend: number;
  thumb_coverage: number;
  video_coverage: number;
  video_fill_rate: number;
  video_ads_total: number;
  last_sync_status: string | null;
}

function useDataHealth() {
  return useQuery({
    queryKey: ["data-health"],
    queryFn: async () => {
      // Fetch accounts
      const { data: accounts, error: accErr } = await supabase
        .from("ad_accounts")
        .select("id, name, creative_count, last_synced_at")
        .order("name");
      if (accErr) throw accErr;

      // Fetch creative coverage stats per account
      const { data: creatives, error: crErr } = await supabase
        .from("creatives")
        .select("account_id, spend, thumbnail_url, video_url, ad_format");
      if (crErr) throw crErr;

      // Fetch last sync status per account
      const { data: syncLogs, error: slErr } = await supabase
        .from("sync_logs")
        .select("account_id, status")
        .order("started_at", { ascending: false });
      if (slErr) throw slErr;

      const lastSyncStatus: Record<string, string> = {};
      for (const log of syncLogs || []) {
        if (!lastSyncStatus[log.account_id]) {
          lastSyncStatus[log.account_id] = log.status;
        }
      }

      // Aggregate per account
      const stats: Record<string, { withSpend: number; withThumb: number; withVideo: number; videoAdsTotal: number; videoAdsWithUrl: number }> = {};
      for (const c of creatives || []) {
        if (!stats[c.account_id]) stats[c.account_id] = { withSpend: 0, withThumb: 0, withVideo: 0, videoAdsTotal: 0, videoAdsWithUrl: 0 };
        const hasSpend = (c.spend || 0) > 0;
        if (hasSpend) {
          stats[c.account_id].withSpend++;
          if (c.thumbnail_url && c.thumbnail_url !== "no-thumbnail") {
            stats[c.account_id].withThumb++;
          }
          if (c.video_url && c.video_url !== "no-video") {
            stats[c.account_id].withVideo++;
          }
        }
        if (c.ad_format === "video") {
          stats[c.account_id].videoAdsTotal++;
          if (c.video_url && c.video_url !== "no-video") {
            stats[c.account_id].videoAdsWithUrl++;
          }
        }
      }

      return (accounts || []).map((acc): AccountHealth => {
        const s = stats[acc.id] || { withSpend: 0, withThumb: 0, withVideo: 0, videoAdsTotal: 0, videoAdsWithUrl: 0 };
        return {
          id: acc.id,
          name: acc.name,
          creative_count: acc.creative_count,
          last_synced_at: acc.last_synced_at,
          with_spend: s.withSpend,
          thumb_coverage: s.withSpend > 0 ? (s.withThumb / s.withSpend) * 100 : 0,
          video_coverage: s.withSpend > 0 ? (s.withVideo / s.withSpend) * 100 : 0,
          video_fill_rate: s.videoAdsTotal > 0 ? (s.videoAdsWithUrl / s.videoAdsTotal) * 100 : 0,
          video_ads_total: s.videoAdsTotal,
          last_sync_status: lastSyncStatus[acc.id] || null,
        };
      });
    },
  });
}

function CoverageCell({ pct }: { pct: number }) {
  const rounded = Math.round(pct);
  if (rounded >= 100) {
    return (
      <span className="flex items-center gap-1 font-data text-[17px] text-emerald-700">
        <CheckCircle className="h-3.5 w-3.5" /> 100%
      </span>
    );
  }
  if (rounded >= 80) {
    return <span className="font-data text-[17px] text-charcoal">{rounded}%</span>;
  }
  if (rounded >= 50) {
    return (
      <span className="flex items-center gap-1 font-data text-[17px] text-amber-600">
        <AlertTriangle className="h-3.5 w-3.5" /> {rounded}%
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 font-data text-[17px] text-red-600">
      <XCircle className="h-3.5 w-3.5" /> {rounded}%
    </span>
  );
}

function SyncStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="font-data text-[12px] text-sage">—</span>;
  const map: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    completed: { label: "Completed", variant: "secondary" },
    completed_with_errors: { label: "Errors", variant: "destructive" },
    running: { label: "Running", variant: "outline" },
    failed: { label: "Failed", variant: "destructive" },
  };
  const m = map[status] || { label: status, variant: "outline" as const };
  return <Badge variant={m.variant} className="font-label text-[10px] uppercase tracking-wide">{m.label}</Badge>;
}

export function DataHealthSection() {
  const { data: health, isLoading } = useDataHealth();

  const refreshMedia = useMutationWithToast({
    mutationFn: (params: { account_id?: string }) =>
      apiFetch("refresh-thumbnails", "", { method: "POST", body: JSON.stringify(params) }),
    invalidateKeys: [["data-health"]],
    successMessage: (data: any) =>
      data?.account_id ? "Media refresh started" : "Media refresh started for all accounts",
    errorMessage: "Failed to start refresh",
  });

  const formatDate = (d: string | null) => {
    if (!d) return "Never";
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <section className="glass-panel p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-[20px] text-forest">Data Health</h2>
          <p className="font-body text-[13px] text-slate font-light mt-1">Media coverage and sync status across all accounts.</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refreshMedia.mutate({})}
          disabled={refreshMedia.isPending}
          className="gap-1.5"
        >
          {refreshMedia.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh All Media
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-label text-[11px] uppercase tracking-wide text-slate">Account</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-wide text-slate text-right">Creatives</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-wide text-slate text-right">w/ Spend</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-wide text-slate text-right">Thumbnails</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-wide text-slate text-right">Videos</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-wide text-slate text-right" title="Of all video-format ads, % with a populated video_url">Fill Rate</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-wide text-slate">Last Sync</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-wide text-slate">Status</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-wide text-slate"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(health || []).map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-body text-[13px] font-medium text-charcoal">{row.name}</TableCell>
                <TableCell className="font-data text-[17px] text-charcoal text-right">{row.creative_count}</TableCell>
                <TableCell className="font-data text-[17px] text-charcoal text-right">{row.with_spend}</TableCell>
                <TableCell className="text-right"><CoverageCell pct={row.thumb_coverage} /></TableCell>
                <TableCell className="text-right"><CoverageCell pct={row.video_coverage} /></TableCell>
                <TableCell className="text-right">
                  {row.video_ads_total > 0 ? (
                    <span className="font-body text-[12px] text-muted-foreground">
                      <CoverageCell pct={row.video_fill_rate} />
                      <span className="block font-data text-[10px] text-muted-foreground/60">{row.video_ads_total} video ads</span>
                    </span>
                  ) : (
                    <span className="font-data text-[12px] text-muted-foreground/40">—</span>
                  )}
                </TableCell>
                <TableCell className="font-data text-[12px] text-slate">{formatDate(row.last_synced_at)}</TableCell>
                <TableCell><SyncStatusBadge status={row.last_sync_status} /></TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => refreshMedia.mutate({ account_id: row.id })}
                    disabled={refreshMedia.isPending}
                    title="Re-sync thumbnails"
                  >
                    {refreshMedia.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
