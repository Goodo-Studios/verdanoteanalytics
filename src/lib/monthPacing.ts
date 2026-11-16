/**
 * Month to date and spend pacing for the agency dashboard (audit plan item 6.5, part 2).
 *
 * Days are UTC calendar days, the same "today" the server's reporting windows use.
 */
import { format, getDaysInMonth, startOfMonth } from "date-fns";
import { utcToday } from "@/lib/dateRange";

/** The 1st of this month to today, as "yyyy-MM-dd". */
export function monthToDateRange(now: Date = new Date()): { from: string; to: string } {
  const today = utcToday(now);
  return { from: format(startOfMonth(today), "yyyy-MM-dd"), to: format(today, "yyyy-MM-dd") };
}

/**
 * Month-to-date spend over the share of the monthly target due by now
 * (target x days elapsed / days in month, today counted as elapsed). 1 means on pace.
 * null when there is no target.
 */
export function paceVsTarget(mtdSpend: number, monthlyTarget: number, now: Date = new Date()): number | null {
  if (!(monthlyTarget > 0)) return null;
  const today = utcToday(now);
  const due = monthlyTarget * (today.getDate() / getDaysInMonth(today));
  return (Number(mtdSpend) || 0) / due;
}
