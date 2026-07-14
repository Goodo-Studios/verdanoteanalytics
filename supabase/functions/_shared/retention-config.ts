// US-001: Long-horizon retention configuration.
//
// Single source of truth for the retention-window constants used across the
// long-horizon-retention workstream. Later stories MUST import these rather
// than hardcoding day counts per call site:
//   - US-002 (rolling incremental sync)   -> RECENT_WINDOW_DAYS
//   - US-004 (one-time historical backfill) -> RETENTION_DAYS
//   - US-006 (nightly retention trim)      -> TRIM_BUFFER_DAYS
//
// Global (no per-account override) per the project decision to keep 365 days of
// history for every account.

/**
 * Promised history window. Backfill (US-004) walks daily history back this far
 * (or to account creation, whichever is later); on-demand views (US-005) serve
 * windows up to this many days.
 */
export const RETENTION_DAYS = 365;

/**
 * Rolling window a scheduled daily sync re-pulls from Meta (US-002). Comfortably
 * exceeds the max gap between daily syncs plus the attribution-close buffer, so
 * late-arriving conversions still correct prior days without re-pulling the full
 * retention window.
 */
export const RECENT_WINDOW_DAYS = 28;

/**
 * Trim safety buffer (US-006). Nightly trim deletes creative_daily_metrics rows
 * older than this many days. 400 = the 365-day promise + a 35-day buffer, so the
 * full promised year is never at risk from the trim job.
 */
export const TRIM_BUFFER_DAYS = 400;
