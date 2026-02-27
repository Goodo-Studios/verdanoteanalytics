/**
 * Client-side anomaly detection engine.
 * Runs against creatives + creative_daily_metrics data.
 */

export type AnomalyCategory = "urgent" | "opportunity" | "watch";
export type AnomalyType =
  | "spend_spike"
  | "roas_crash"
  | "zero_spend"
  | "outlier_performer"
  | "frequency_spike";

export interface Anomaly {
  type: AnomalyType;
  category: AnomalyCategory;
  adId: string;
  adName: string;
  accountId: string;
  description: string;
  /** Icon character */
  icon: string;
}

interface DailyRow {
  ad_id: string;
  date: string;
  spend: number;
  roas: number;
  frequency: number;
  impressions: number;
  purchase_value: number;
}

const CATEGORY_MAP: Record<AnomalyType, AnomalyCategory> = {
  spend_spike: "watch",
  roas_crash: "urgent",
  zero_spend: "urgent",
  outlier_performer: "opportunity",
  frequency_spike: "watch",
};

const ICON_MAP: Record<AnomalyCategory, string> = {
  urgent: "🔴",
  opportunity: "🟢",
  watch: "⚠️",
};

/**
 * Detect anomalies from creatives and their daily metrics.
 */
export function detectAnomalies(
  creatives: any[],
  dailyMetrics: DailyRow[],
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  if (!creatives.length || !dailyMetrics.length) return anomalies;

  // Index daily metrics by ad_id, sorted by date desc
  const byAd: Record<string, DailyRow[]> = {};
  for (const row of dailyMetrics) {
    if (!byAd[row.ad_id]) byAd[row.ad_id] = [];
    byAd[row.ad_id].push(row);
  }
  for (const key of Object.keys(byAd)) {
    byAd[key].sort((a, b) => b.date.localeCompare(a.date));
  }

  // Compute account-level average ROAS
  const accountRoas: Record<string, { totalPV: number; totalSpend: number }> = {};
  for (const c of creatives) {
    const spend = Number(c.spend) || 0;
    const pv = Number(c.purchase_value) || 0;
    if (spend <= 0) continue;
    if (!accountRoas[c.account_id]) accountRoas[c.account_id] = { totalPV: 0, totalSpend: 0 };
    accountRoas[c.account_id].totalPV += pv;
    accountRoas[c.account_id].totalSpend += spend;
  }
  const accountAvgRoas: Record<string, number> = {};
  for (const [id, v] of Object.entries(accountRoas)) {
    accountAvgRoas[id] = v.totalSpend > 0 ? v.totalPV / v.totalSpend : 0;
  }

  // Today reference
  const today = new Date();
  const daysAgo = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const sevenDaysAgo = daysAgo(7);
  const fourteenDaysAgo = daysAgo(14);

  const seen = new Set<string>();

  for (const creative of creatives) {
    const adId = creative.ad_id;
    const adName = creative.ad_name || adId;
    const accountId = creative.account_id;
    const rows = byAd[adId];
    if (!rows || rows.length === 0) continue;

    const last7 = rows.filter((r) => r.date >= sevenDaysAgo);
    const prev7 = rows.filter((r) => r.date >= fourteenDaysAgo && r.date < sevenDaysAgo);

    // 1. SPEND SPIKE: daily spend >3x the 7-day avg
    if (last7.length > 0) {
      const avgSpend7 = last7.reduce((s, r) => s + (Number(r.spend) || 0), 0) / Math.max(last7.length, 1);
      if (avgSpend7 > 0) {
        const maxDay = last7.reduce((max, r) => (Number(r.spend) || 0) > max.spend ? { date: r.date, spend: Number(r.spend) || 0 } : max, { date: "", spend: 0 });
        if (maxDay.spend > avgSpend7 * 3 && maxDay.spend > 50) {
          const key = `spend_spike_${adId}`;
          if (!seen.has(key)) {
            seen.add(key);
            anomalies.push({
              type: "spend_spike",
              category: "watch",
              adId, adName, accountId,
              icon: ICON_MAP.watch,
              description: `Daily spend of $${maxDay.spend.toFixed(0)} on ${maxDay.date} is ${(maxDay.spend / avgSpend7).toFixed(1)}x the 7-day average ($${avgSpend7.toFixed(0)}).`,
            });
          }
        }
      }
    }

    // 2. ROAS CRASH: >40% drop week-over-week with >$500 spend
    const totalSpend = Number(creative.spend) || 0;
    if (totalSpend > 500 && prev7.length > 0 && last7.length > 0) {
      const prevPV = prev7.reduce((s, r) => s + (Number(r.purchase_value) || Number(r.spend) * (Number(r.roas) || 0)), 0);
      const prevSpend = prev7.reduce((s, r) => s + (Number(r.spend) || 0), 0);
      const currPV = last7.reduce((s, r) => s + (Number(r.purchase_value) || Number(r.spend) * (Number(r.roas) || 0)), 0);
      const currSpend = last7.reduce((s, r) => s + (Number(r.spend) || 0), 0);
      const prevRoas = prevSpend > 0 ? prevPV / prevSpend : 0;
      const currRoas = currSpend > 0 ? currPV / currSpend : 0;
      if (prevRoas > 0 && currRoas < prevRoas * 0.6) {
        const drop = ((1 - currRoas / prevRoas) * 100).toFixed(0);
        const key = `roas_crash_${adId}`;
        if (!seen.has(key)) {
          seen.add(key);
          anomalies.push({
            type: "roas_crash",
            category: "urgent",
            adId, adName, accountId,
            icon: ICON_MAP.urgent,
            description: `ROAS dropped ${drop}% this week (${currRoas.toFixed(2)}x → from ${prevRoas.toFixed(2)}x) with $${totalSpend.toFixed(0)} total spend.`,
          });
        }
      }
    }

    // 3. ZERO SPEND: had spend last week, now 3+ consecutive $0 days
    if (prev7.length > 0 && last7.length >= 3) {
      const prevHadSpend = prev7.some((r) => (Number(r.spend) || 0) > 0);
      if (prevHadSpend) {
        // Count consecutive zero-spend days from most recent
        const sortedLast7 = [...last7].sort((a, b) => b.date.localeCompare(a.date));
        let consecutiveZero = 0;
        for (const row of sortedLast7) {
          if ((Number(row.spend) || 0) === 0) consecutiveZero++;
          else break;
        }
        if (consecutiveZero >= 3) {
          const key = `zero_spend_${adId}`;
          if (!seen.has(key)) {
            seen.add(key);
            anomalies.push({
              type: "zero_spend",
              category: "urgent",
              adId, adName, accountId,
              icon: ICON_MAP.urgent,
              description: `Was active last week but has had $0 spend for ${consecutiveZero} consecutive days.`,
            });
          }
        }
      }
    }

    // 4. OUTLIER PERFORMER: ROAS >3x account average
    const creativeRoas = Number(creative.roas) || 0;
    const acctAvg = accountAvgRoas[accountId] || 0;
    if (creativeRoas > 0 && acctAvg > 0 && creativeRoas > acctAvg * 3 && totalSpend > 100) {
      const key = `outlier_${adId}`;
      if (!seen.has(key)) {
        seen.add(key);
        anomalies.push({
          type: "outlier_performer",
          category: "opportunity",
          adId, adName, accountId,
          icon: ICON_MAP.opportunity,
          description: `ROAS of ${creativeRoas.toFixed(2)}x is ${(creativeRoas / acctAvg).toFixed(1)}x the account average (${acctAvg.toFixed(2)}x). Consider scaling.`,
        });
      }
    }

    // 5. FREQUENCY SPIKE: frequency >5.0 in last 7 days with >$1000 spend
    if (totalSpend > 1000 && last7.length > 0) {
      const avgFreq = last7.reduce((s, r) => s + (Number(r.frequency) || 0), 0) / last7.length;
      if (avgFreq > 5.0) {
        const key = `freq_spike_${adId}`;
        if (!seen.has(key)) {
          seen.add(key);
          anomalies.push({
            type: "frequency_spike",
            category: "watch",
            adId, adName, accountId,
            icon: ICON_MAP.watch,
            description: `Average frequency of ${avgFreq.toFixed(1)} in the last 7 days exceeds the 5.0 threshold ($${totalSpend.toFixed(0)} spend).`,
          });
        }
      }
    }
  }

  // Sort: urgent first, then opportunity, then watch
  const order: Record<AnomalyCategory, number> = { urgent: 0, opportunity: 1, watch: 2 };
  anomalies.sort((a, b) => order[a.category] - order[b.category]);

  return anomalies;
}

/**
 * Build a set of ad_ids that have anomalies for quick lookup.
 */
export function anomalyAdIds(anomalies: Anomaly[]): Set<string> {
  return new Set(anomalies.map((a) => a.adId));
}
