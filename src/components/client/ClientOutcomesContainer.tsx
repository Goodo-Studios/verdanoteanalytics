import { useMemo } from "react";
import { usePeriodMetrics } from "@/hooks/usePeriodMetrics";
import { useDailyTrends } from "@/hooks/useDailyTrends";
import { useWoWTrends } from "@/hooks/useWoWTrends";
import {
  ClientOutcomesSection,
  type OutcomeDirection,
} from "@/components/client/ClientOutcomesSection";

/** Current calendar month as a fixed period (no date picker). */
function currentMonthRange(now = new Date()): {
  from: string;
  to: string;
  label: string;
} {
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-indexed
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0); // last day of this month
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  const label = first.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  return { from: iso(first), to: iso(last), label };
}

/**
 * Derive a single account-level "vs last week" direction from the per-ad WoW
 * map (spend-weighted ROAS this-week vs prior-week). Plain-language for clients.
 */
function deriveAccountWoW(
  wow: Map<string, { thisWeekRoas: number; priorWeekRoas: number; direction: string }> | undefined,
): { direction: OutcomeDirection; pctChange?: number } {
  if (!wow || wow.size === 0) return { direction: "insufficient" };

  // Average the comparable (non-insufficient) entries equally — a stable,
  // readable account-level signal without re-fetching raw rows.
  let twSum = 0;
  let pwSum = 0;
  let n = 0;
  for (const t of wow.values()) {
    if (t.direction === "insufficient") continue;
    twSum += t.thisWeekRoas;
    pwSum += t.priorWeekRoas;
    n += 1;
  }
  if (n === 0) return { direction: "insufficient" };

  const tw = twSum / n;
  const pw = pwSum / n;
  if (pw <= 0) return { direction: "insufficient" };

  const pct = (tw - pw) / pw;
  let direction: OutcomeDirection = "flat";
  if (pct > 0.1) direction = "up";
  else if (pct < -0.1) direction = "down";

  return { direction, pctChange: pct };
}

export function ClientOutcomesContainer({ accountId }: { accountId?: string }) {
  const { from, to, label } = useMemo(() => currentMonthRange(), []);

  const { data: metrics, isLoading } = usePeriodMetrics({
    accountId,
    dateFrom: from,
    dateTo: to,
  });

  const { data: trend } = useDailyTrends(accountId, { from, to });
  const { data: wow } = useWoWTrends(accountId);

  const { direction, pctChange } = useMemo(() => deriveAccountWoW(wow), [wow]);

  const safeMetrics = metrics ?? {
    totalSpend: 0,
    totalImpressions: 0,
    totalClicks: 0,
    totalPurchases: 0,
    totalPurchaseValue: 0,
    totalAddsToCart: 0,
    totalVideoViews: 0,
    activeCount: 0,
    avgRoas: 0,
    avgCpa: 0,
    avgCtr: 0,
  };

  return (
    <ClientOutcomesSection
      metrics={safeMetrics}
      periodLabel={label}
      trend={trend}
      wowDirection={direction}
      wowPctChange={pctChange}
      isLoading={isLoading}
    />
  );
}

export default ClientOutcomesContainer;
