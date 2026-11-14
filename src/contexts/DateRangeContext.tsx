import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from "react";
import { useAccountContext } from "@/contexts/AccountContext";
import { DEFAULT_PRESET_ID, isRollingPresetId, rollingPresetRange } from "@/lib/dateRange";

interface DateRangeContextType {
  dateFrom: string | undefined;
  dateTo: string | undefined;
  /**
   * Set the shared range. Pass the rolling preset's id as the third argument when the range came
   * from a preset: the id is saved instead of the dates, so the window moves forward with the
   * calendar. A range with no preset id is a custom range and is saved as fixed dates.
   */
  setDateRange: (dateFrom?: string, dateTo?: string, presetId?: string) => void;
}

interface StoredRange {
  dateFrom?: string;
  dateTo?: string;
  /** Set for a rolling preset. The dates are then recomputed on load. */
  preset?: string;
}

// App-wide default: last 14 days → yesterday. This was the most common existing
// per-page default (Analytics, Overview, and Creatives all used it) and matches
// what the dashboard already showed, so unifying every page onto it causes the
// least visual surprise. Some pages had wider defaults (Creative Rotation: 90d;
// Agency Dashboard: start-of-month) — those now inherit the shared range, and
// the user can widen it once and it sticks per account. "Today" is the UTC date, the
// same calendar the server builds its windows on.
function defaultRange(): { dateFrom: string; dateTo: string } {
  return rollingPresetRange(DEFAULT_PRESET_ID)!;
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

/** What is saved for this key, with a rolling preset turned back into today's dates. */
function loadRange(key: string): { dateFrom?: string; dateTo?: string } {
  const stored = localStorage.getItem(key);
  if (stored !== null) {
    try {
      const parsed = JSON.parse(stored) as StoredRange;
      if (isRollingPresetId(parsed.preset)) {
        const rolled = rollingPresetRange(parsed.preset);
        if (rolled) return rolled;
      }
      // A custom range, or an explicitly cleared one ({}), comes back exactly as saved.
      return { dateFrom: parsed.dateFrom, dateTo: parsed.dateTo };
    } catch {
      // corrupt value, so fall through to the default
    }
  }
  return defaultRange();
}

/**
 * App-wide, per-account, persisted date range. The selected range is shared
 * across every page (dashboard, analytics, matrix, …) and persisted to
 * localStorage keyed by the app-selected account id, so each account remembers
 * its own window. When the selected account changes, the stored range for that
 * account is reloaded (falling back to the shared default when none is stored).
 *
 * A rolling preset (Last 7 days, This Month, …) is saved as its id and worked out again each
 * time it is loaded, so it does not freeze at the dates it had when it was picked. A custom
 * range is saved as fixed dates.
 *
 * Must render inside AccountProvider — it reads the app-selected account id.
 */
export function DateRangeProvider({ children }: { children: ReactNode }) {
  const { selectedAccountId } = useAccountContext();
  const key = storageKey(selectedAccountId);
  // The range the user set in this session, tagged with the account it was set for. The range for
  // the current account is worked out during render, so the first render after an account switch
  // already has the new account's range and never pairs it with the previous one's.
  const [chosen, setChosen] = useState<{ key: string; range: { dateFrom?: string; dateTo?: string } } | null>(null);
  const range = useMemo(
    () => (chosen && chosen.key === key ? chosen.range : loadRange(key)),
    [chosen, key],
  );

  const setDateRange = useCallback(
    (dateFrom?: string, dateTo?: string, presetId?: string) => {
      const rolling = isRollingPresetId(presetId) ? presetId : undefined;
      const next = rolling ? (rollingPresetRange(rolling) ?? { dateFrom, dateTo }) : { dateFrom, dateTo };
      setChosen({ key, range: next });
      const saved: StoredRange = rolling ? { preset: rolling, ...next } : { dateFrom, dateTo };
      localStorage.setItem(key, JSON.stringify(saved));
    },
    [key],
  );

  const value = useMemo(
    () => ({ dateFrom: range.dateFrom, dateTo: range.dateTo, setDateRange }),
    [range, setDateRange],
  );

  return <DateRangeContext.Provider value={value}>{children}</DateRangeContext.Provider>;
}

export function useDateRangeContext() {
  return useContext(DateRangeContext);
}
