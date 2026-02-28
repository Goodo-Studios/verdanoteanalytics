/**
 * Fatigue Forecasting — predicts WHEN a creative will hit fatigue thresholds.
 *
 * Uses last 14 days of creative_daily_metrics to compute a daily fatigue proxy,
 * fits a linear trend, and projects forward.
 */

export interface DailyFatiguePoint {
  day: number; // 0-based index
  date: string;
  score: number;
}

export interface FatigueForecast {
  historical: DailyFatiguePoint[];
  projected: DailyFatiguePoint[];
  slope: number; // per-day change
  currentScore: number;
  daysToWarning: number | null; // days until score hits 60
  daysToCritical: number | null; // days until score hits 80
  status: "rising" | "stable" | "already_warning" | "already_critical";
}

const WARNING_THRESHOLD = 60;
const CRITICAL_THRESHOLD = 80;

/**
 * Compute a daily fatigue proxy score from a single day's metrics.
 * Combines frequency pressure + efficiency decay signals.
 */
function dailyFatigueProxy(row: any): number {
  let score = 0;
  const freq = Number(row.frequency) || 0;
  const ctr = Number(row.ctr) || 0;
  const roas = Number(row.roas) || 0;

  // Frequency component (0-50)
  if (freq > 5) score += 50;
  else if (freq > 3) score += 30;
  else if (freq > 2) score += 15;
  else score += freq * 5;

  // Low CTR penalty (0-25)
  if (ctr < 0.5) score += 25;
  else if (ctr < 1.0) score += 15;
  else if (ctr < 1.5) score += 5;

  // Low ROAS penalty (0-25)
  if (roas < 0.5) score += 25;
  else if (roas < 1.0) score += 15;
  else if (roas < 1.5) score += 5;

  return Math.min(100, score);
}

/**
 * Simple linear regression: y = slope * x + intercept
 */
function linearRegression(points: { x: number; y: number }[]): { slope: number; intercept: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }

  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

/**
 * Build a fatigue forecast from the last 14 days of daily metrics for one creative.
 */
export function computeFatigueForecast(dailyRows: any[]): FatigueForecast | null {
  if (!dailyRows || dailyRows.length < 3) return null;

  // Sort by date ascending
  const sorted = [...dailyRows]
    .filter((r) => (Number(r.spend) || 0) > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14);

  if (sorted.length < 3) return null;

  // Compute daily fatigue scores
  const historical: DailyFatiguePoint[] = sorted.map((row, i) => ({
    day: i,
    date: row.date,
    score: dailyFatigueProxy(row),
  }));

  // Fit linear trend
  const regressionPoints = historical.map((p) => ({ x: p.day, y: p.score }));
  const { slope, intercept } = linearRegression(regressionPoints);

  const currentScore = historical[historical.length - 1].score;
  const lastDay = historical.length - 1;

  // Already in zones?
  if (currentScore >= CRITICAL_THRESHOLD) {
    // Project 14 days forward for visualization
    const projected = buildProjection(lastDay, slope, intercept, 14);
    return { historical, projected, slope, currentScore, daysToWarning: 0, daysToCritical: 0, status: "already_critical" };
  }
  if (currentScore >= WARNING_THRESHOLD) {
    const daysToCritical = slope > 0.1 ? Math.ceil((CRITICAL_THRESHOLD - (slope * lastDay + intercept)) / slope) : null;
    const projected = buildProjection(lastDay, slope, intercept, 14);
    return { historical, projected, slope, currentScore, daysToWarning: 0, daysToCritical: daysToCritical && daysToCritical > 0 ? daysToCritical : null, status: "already_warning" };
  }

  if (slope <= 0.1) {
    const projected = buildProjection(lastDay, slope, intercept, 14);
    return { historical, projected, slope, currentScore, daysToWarning: null, daysToCritical: null, status: "stable" };
  }

  // Calculate days to thresholds from last data point
  const currentTrend = slope * lastDay + intercept;
  const daysToWarning = Math.ceil((WARNING_THRESHOLD - currentTrend) / slope);
  const daysToCritical = Math.ceil((CRITICAL_THRESHOLD - currentTrend) / slope);

  const projected = buildProjection(lastDay, slope, intercept, 14);

  return {
    historical,
    projected,
    slope,
    currentScore,
    daysToWarning: daysToWarning > 0 ? daysToWarning : null,
    daysToCritical: daysToCritical > 0 ? daysToCritical : null,
    status: "rising",
  };
}

function buildProjection(lastDay: number, slope: number, intercept: number, days: number): DailyFatiguePoint[] {
  const points: DailyFatiguePoint[] = [];
  for (let i = 1; i <= days; i++) {
    const day = lastDay + i;
    const score = Math.min(100, Math.max(0, slope * day + intercept));
    const date = futureDate(i);
    points.push({ day, date, score });
  }
  return points;
}

function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split("T")[0];
}

/**
 * Check if a creative is forecasted to hit warning within N days.
 */
export function isForecastedToFatigue(dailyRows: any[], withinDays = 7): boolean {
  const forecast = computeFatigueForecast(dailyRows);
  if (!forecast) return false;
  if (forecast.status === "already_warning" || forecast.status === "already_critical") return true;
  if (forecast.daysToWarning !== null && forecast.daysToWarning <= withinDays) return true;
  return false;
}
