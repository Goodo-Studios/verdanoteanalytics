// US-002: Frame-retention curve parser.
//
// Meta's `video_play_curve_actions` insight is NOT the flat {action_type, value}
// shape used by aggregates like `actions` / `video_thruplay_watched_actions`.
// Instead it nests a per-interval retention array under `value`:
//
//   "video_play_curve_actions": [
//     {
//       "action_type": "video_view",
//       "value": ["1", "0.91", "0.82", ... ]   // 0-based, fractions in [0,1]
//     }
//   ]
//
// Each element is the fraction of plays still watching at that interval. Meta
// reports the curve in 1/30 increments (index 0 = start, index 29 = 100%).
// We normalize to TRUE PERCENTAGES in [0,100] (pct-fields policy) and derive
// the four quartile-threshold scalars in the SAME single pass so the JSONB
// `play_curve` and US-001's scalar columns (`retention_p25/50/75/100`) stay
// consistent.
//
// Non-video creatives (field absent / empty / malformed) → all-null. We never
// zero-fill: a zero curve would distort downstream denominators and read as a
// real "everyone dropped off" signal rather than "no data".

export interface PlayCurveResult {
  /** Full normalized retention curve as true percentages in [0,100], or null. */
  play_curve: number[] | null;
  /** % of plays still watching at the 25% mark, or null. */
  retention_p25: number | null;
  /** % of plays still watching at the 50% mark, or null. */
  retention_p50: number | null;
  /** % of plays still watching at the 75% mark, or null. */
  retention_p75: number | null;
  /** % of plays still watching at the 100% (completion) mark, or null. */
  retention_p100: number | null;
}

const NULL_RESULT: PlayCurveResult = {
  play_curve: null,
  retention_p25: null,
  retention_p50: null,
  retention_p75: null,
  retention_p100: null,
};

/**
 * Extract + normalize Meta's nested `video_play_curve_actions` field.
 *
 * @param field the raw `row.video_play_curve_actions` value (array of action
 *   objects, each with a nested `value` array). Anything else → null result.
 */
export function parsePlayCurve(field: unknown): PlayCurveResult {
  if (!Array.isArray(field) || field.length === 0) return { ...NULL_RESULT };

  // Prefer the video_view action; fall back to the first entry that carries a
  // nested array under `value` (Meta only ever returns one row here in practice).
  const entry =
    (field as any[]).find((a) => a?.action_type === "video_view" && Array.isArray(a?.value)) ??
    (field as any[]).find((a) => Array.isArray(a?.value));

  if (!entry || !Array.isArray(entry.value) || entry.value.length === 0) {
    return { ...NULL_RESULT };
  }

  const raw: unknown[] = entry.value;
  const curve: number[] = [];
  for (const v of raw) {
    const n = typeof v === "number" ? v : parseFloat(String(v));
    if (!Number.isFinite(n)) {
      // Malformed interval → bail out entirely rather than emit a partial /
      // zero-filled curve that would distort downstream denominators.
      return { ...NULL_RESULT };
    }
    // Source fractions are in [0,1]; convert to true percentages in [0,100].
    curve.push(n * 100);
  }

  // Derive quartile thresholds from fractional positions across the curve.
  // index 0 = play start, last index = 100% completion. The 25/50/75 marks are
  // interpolated by position; p100 is the final (completion) value.
  const lastIdx = curve.length - 1;
  const at = (fraction: number): number => {
    const pos = fraction * lastIdx;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return curve[lo];
    const t = pos - lo;
    return curve[lo] * (1 - t) + curve[hi] * t;
  };

  return {
    play_curve: curve,
    retention_p25: at(0.25),
    retention_p50: at(0.5),
    retention_p75: at(0.75),
    retention_p100: curve[lastIdx],
  };
}
