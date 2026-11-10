/**
 * Shared formatting utilities used across pages and components.
 * Consolidates duplicated fmt$, fmtReport, fmtN, fmtPct, delta helpers.
 */

/** Format a dollar amount with k/M abbreviation */
export function fmt$(n: number): string {
  if (!isFinite(n)) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

/** Format a nullable number with optional prefix/suffix — used in reports and tables */
export function fmtMetric(v: number | null | undefined, prefix = "", suffix = "", decimals = 2): string {
  if (v === null || v === undefined) return "—";
  if (!isFinite(Number(v))) return "—";
  return `${prefix}${Number(v).toLocaleString("en-US", { maximumFractionDigits: decimals })}${suffix}`;
}

/** Format a number with commas */
export function fmtN(n: number): string {
  if (!isFinite(n)) return '—';
  return n.toLocaleString();
}

/** Format a percentage */
export function fmtPct(n: number): string {
  if (!isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}

/** Format a signed percentage change (e.g. +12% / -5%) */
export function fmtSignedPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(0)}%`;
}

/** Compute delta percentage between current and previous values */
export function delta(cur: number, prev: number | undefined): { value: number; positive: boolean } | undefined {
  if (prev == null || prev === 0) return undefined;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  return { value: Math.round(Math.abs(pct)), positive: pct >= 0 };
}

/** Inverse delta — positive when value decreases (e.g. CPA) */
export function deltaInverse(cur: number, prev: number | undefined): { value: number; positive: boolean } | undefined {
  const d = delta(cur, prev);
  if (!d) return undefined;
  return { ...d, positive: !d.positive };
}

/**
 * A date for display, e.g. "Nov 10, 2026". A date-only value ("2026-11-10")
 * or the date part of a timestamp is read as a calendar day, so it never shifts
 * a day with the viewer's time zone. Empty or unreadable values return the
 * fallback.
 */
export function fmtDate(value: string | null | undefined, fallback = "Not set"): string {
  if (!value) return fallback;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return fallback;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

/** A date and time for display, e.g. "Nov 10, 2026, 3:04 PM", in the viewer's time zone. */
export function fmtDateTime(value: string | null | undefined, fallback = "Not set"): string {
  if (!value) return fallback;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return fallback;
  return new Date(t).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * How long ago a timestamp was, in plain words: "just now", "5 minutes ago",
 * "2 hours ago", "3 days ago". Older than a week shows the date. Returns null
 * for an empty or unreadable value.
 */
export function fmtTimeAgo(value: string | null | undefined, now: Date = new Date()): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;
  const diff = Math.max(0, now.getTime() - t);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return `on ${new Date(t).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}`;
}

/**
 * When something happened, for job and sync lines: "never" for an empty value,
 * "unknown" for an unreadable one, otherwise the date and time ("Nov 10, 2026, 3:04 PM").
 */
export function fmtWhen(value: string | null | undefined): string {
  if (!value) return "never";
  if (!Number.isFinite(Date.parse(value))) return "unknown";
  return fmtDateTime(value);
}
