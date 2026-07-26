import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { format, subDays } from "date-fns";
import { useAccountContext } from "@/contexts/AccountContext";

interface DateRangeContextType {
  dateFrom: string | undefined;
  dateTo: string | undefined;
  setDateRange: (dateFrom?: string, dateTo?: string) => void;
}

// App-wide default: last 14 days → yesterday. This was the most common existing
// per-page default (Analytics, Overview, and Creatives all used it) and matches
// what the dashboard already showed, so unifying every page onto it causes the
// least visual surprise. Some pages had wider defaults (Creative Rotation: 90d;
// Agency Dashboard: start-of-month) — those now inherit the shared range, and
// the user can widen it once and it sticks per account.
function defaultRange(): { dateFrom: string; dateTo: string } {
  return {
    dateFrom: format(subDays(new Date(), 14), "yyyy-MM-dd"),
    dateTo: format(subDays(new Date(), 1), "yyyy-MM-dd"),
  };
}

// A default context value (mirrors AccountContext) so consumers rendered outside
// a provider — e.g. isolated component tests — still get a sensible range and
// never crash.
const DEFAULT = defaultRange();
const DateRangeContext = createContext<DateRangeContextType>({
  dateFrom: DEFAULT.dateFrom,
  dateTo: DEFAULT.dateTo,
  setDateRange: () => {},
});

function storageKey(accountId: string | null | undefined) {
  return `dateRange_${accountId ?? "none"}`;
}

/**
 * App-wide, per-account, persisted date range. The selected range is shared
 * across every page (dashboard, analytics, matrix, …) and persisted to
 * localStorage keyed by the app-selected account id, so each account remembers
 * its own window. When the selected account changes, the stored range for that
 * account is reloaded (falling back to the shared default when none is stored).
 *
 * Must render inside AccountProvider — it reads the app-selected account id.
 */
export function DateRangeProvider({ children }: { children: ReactNode }) {
  const { selectedAccountId } = useAccountContext();
  const [range, setRange] = useState<{ dateFrom?: string; dateTo?: string }>(() => defaultRange());

  // Reload the stored range whenever the app-selected account changes. An
  // explicitly-cleared range persists as {} and is faithfully restored (both
  // fields undefined) rather than snapping back to the default.
  useEffect(() => {
    const stored = localStorage.getItem(storageKey(selectedAccountId));
    if (stored !== null) {
      try {
        const parsed = JSON.parse(stored) as { dateFrom?: string; dateTo?: string };
        setRange({ dateFrom: parsed.dateFrom, dateTo: parsed.dateTo });
        return;
      } catch {
        // corrupt value — fall through to the default
      }
    }
    setRange(defaultRange());
  }, [selectedAccountId]);

  const setDateRange = useCallback(
    (dateFrom?: string, dateTo?: string) => {
      setRange({ dateFrom, dateTo });
      localStorage.setItem(storageKey(selectedAccountId), JSON.stringify({ dateFrom, dateTo }));
    },
    [selectedAccountId],
  );

  return (
    <DateRangeContext.Provider value={{ dateFrom: range.dateFrom, dateTo: range.dateTo, setDateRange }}>
      {children}
    </DateRangeContext.Provider>
  );
}

export function useDateRangeContext() {
  return useContext(DateRangeContext);
}
