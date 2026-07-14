import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// US-005: On-demand long-range per-ad aggregates served from creative_daily_metrics.
//
// Long-range views (30/90/180/365d) are computed at query time by the
// get_creative_window_aggregates RPC — the same summable+derived contract as the
// US-003 snapshot rollup — instead of storing a wide per-window snapshot. This is
// what makes a full year cheap to hold: no stored 365d column, just a daily-grain
// sum backed by idx_daily_metrics_account_date.
//
// RETENTION_DAYS caps the requestable window; the RPC also enforces this
// server-side and rejects anything wider.
export const RETENTION_DAYS = 365;

// Common windows the UI can request directly. 365 is the full retained year.
export const WINDOW_PRESETS = [30, 90, 180, 365] as const;
export type WindowPreset = (typeof WINDOW_PRESETS)[number];

export interface CreativeWindowAggregate {
  ad_id: string;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchase_value: number;
  adds_to_cart: number;
  video_views: number;
  roas: number;
  cpa: number;
  ctr: number;
  cpm: number;
  cpc: number;
  cost_per_add_to_cart: number;
  thumb_stop_rate: number;
  hold_rate: number;
  video_avg_play_time: number;
  // APPROXIMATE: impression-weighted mean daily frequency (no local reach).
  frequency: number;
  retention_p25: number | null;
  retention_p50: number | null;
  retention_p75: number | null;
  retention_p100: number | null;
}

// Format a Date as a UTC YYYY-MM-DD `date` literal (matches the RPC's date args).
function toDateParam(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve a rolling window of `days` ending today (inclusive) into { from, to }
 * `date` params. `days` is clamped to [1, RETENTION_DAYS] so the UI can never
 * request beyond the retained year (the RPC also rejects over-wide windows).
 */
export function resolveWindowRange(
  days: number,
  now: Date = new Date()
): { from: string; to: string } {
  const clamped = Math.max(1, Math.min(RETENTION_DAYS, Math.floor(days)));
  const to = new Date(now);
  const from = new Date(now);
  // Inclusive endpoints: a `days`-long window spans (days - 1) prior days + today.
  from.setUTCDate(from.getUTCDate() - (clamped - 1));
  return { from: toDateParam(from), to: toDateParam(to) };
}

interface UseWindowAggregatesOptions {
  enabled?: boolean;
}

/**
 * Fetch per-ad aggregates for an arbitrary window (up to RETENTION_DAYS) served
 * from daily rows. Pass either a preset number of days (30/90/180/365, or any
 * value up to 365) — the hook resolves it to a from/to range and calls the
 * get_creative_window_aggregates RPC.
 */
export function useWindowAggregates(
  accountId: string | undefined,
  days: number,
  options: UseWindowAggregatesOptions = {}
) {
  const { from, to } = resolveWindowRange(days);
  const enabled = (options.enabled ?? true) && !!accountId;

  return useQuery<CreativeWindowAggregate[]>({
    queryKey: ["window-aggregates", accountId ?? "none", from, to],
    staleTime: 5 * 60 * 1000,
    enabled,
    queryFn: async () => {
      if (!accountId) return [];

      const { data, error } = await supabase.rpc("get_creative_window_aggregates", {
        p_account_id: accountId,
        p_from: from,
        p_to: to,
      });

      if (error) throw error;
      if (!data) return [];

      return (data as CreativeWindowAggregate[]).map((row) => ({
        ad_id: row.ad_id,
        spend: Number(row.spend) || 0,
        impressions: Number(row.impressions) || 0,
        clicks: Number(row.clicks) || 0,
        purchases: Number(row.purchases) || 0,
        purchase_value: Number(row.purchase_value) || 0,
        adds_to_cart: Number(row.adds_to_cart) || 0,
        video_views: Number(row.video_views) || 0,
        roas: Number(row.roas) || 0,
        cpa: Number(row.cpa) || 0,
        ctr: Number(row.ctr) || 0,
        cpm: Number(row.cpm) || 0,
        cpc: Number(row.cpc) || 0,
        cost_per_add_to_cart: Number(row.cost_per_add_to_cart) || 0,
        thumb_stop_rate: Number(row.thumb_stop_rate) || 0,
        hold_rate: Number(row.hold_rate) || 0,
        video_avg_play_time: Number(row.video_avg_play_time) || 0,
        frequency: Number(row.frequency) || 0,
        retention_p25: row.retention_p25 == null ? null : Number(row.retention_p25),
        retention_p50: row.retention_p50 == null ? null : Number(row.retention_p50),
        retention_p75: row.retention_p75 == null ? null : Number(row.retention_p75),
        retention_p100: row.retention_p100 == null ? null : Number(row.retention_p100),
      }));
    },
  });
}
