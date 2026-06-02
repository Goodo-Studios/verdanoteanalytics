// US-002: Unit tests for the frame-retention curve parser.
//
// Meta's `video_play_curve_actions` nests a per-interval retention array under
// `value` (fractions in [0,1]) — NOT the flat {action_type, value} shape used by
// other aggregates. The parser must:
//   - normalize the full curve to TRUE percentages in [0,100] (pct-fields policy)
//   - derive retention_p25/p50/p75/p100 in the same pass (consistent with the JSONB)
//   - return all-null for non-video / missing / malformed input (NO zero-fill)
import { describe, it, expect } from "vitest";
import { parsePlayCurve } from "../../supabase/functions/_shared/play-curve";

describe("parsePlayCurve", () => {
  it("parses a realistic nested video_play_curve_actions payload to true percentages + derived thresholds", () => {
    // 9-point curve so the 25/50/75 marks land on exact indices (lastIdx=8):
    //   p25 -> idx 2, p50 -> idx 4, p75 -> idx 6, p100 -> idx 8
    const field = [
      {
        action_type: "video_view",
        value: ["1", "0.9", "0.8", "0.7", "0.6", "0.5", "0.4", "0.3", "0.2"],
      },
    ];

    const result = parsePlayCurve(field);

    // Full curve normalized to [0,100].
    expect(result.play_curve).toEqual([100, 90, 80, 70, 60, 50, 40, 30, 20]);

    // Derived thresholds (true percentages, not [0,1]).
    expect(result.retention_p25).toBeCloseTo(80, 6); // idx 2
    expect(result.retention_p50).toBeCloseTo(60, 6); // idx 4
    expect(result.retention_p75).toBeCloseTo(40, 6); // idx 6
    expect(result.retention_p100).toBeCloseTo(20, 6); // completion (last idx)

    // Source fractions [0,1] must be scaled to percentages, never left as fractions.
    expect(Math.max(...(result.play_curve as number[]))).toBeGreaterThan(1);
  });

  it("interpolates thresholds when marks fall between curve indices", () => {
    // 5-point curve (lastIdx=4): p25 -> pos 1.0 (idx1), p50 -> pos 2.0 (idx2),
    // p75 -> pos 3.0 (idx3). Use a non-uniform curve to confirm exact reads.
    const field = [{ action_type: "video_view", value: [1, 0.85, 0.6, 0.3, 0.1] }];
    const result = parsePlayCurve(field);
    expect(result.play_curve).toEqual([100, 85, 60, 30, 10]);
    expect(result.retention_p25).toBeCloseTo(85, 6);
    expect(result.retention_p50).toBeCloseTo(60, 6);
    expect(result.retention_p75).toBeCloseTo(30, 6);
    expect(result.retention_p100).toBeCloseTo(10, 6);
  });

  it("normalizes already-percentage-scaled Meta values (index 0 = 100), not just fractions", () => {
    // Regression: some accounts return video_play_curve_actions already on a
    // 0–100 scale. The old parser multiplied by 100 → values like 10000 and a
    // p50 of 200. Normalizing against index 0 must yield a true [0,100] curve.
    const field = [{ action_type: "video_view", value: ["100", "60", "26", "16", "12"] }];
    const result = parsePlayCurve(field);
    expect(result.play_curve).toEqual([100, 60, 26, 16, 12]);
    expect(Math.max(...(result.play_curve as number[]))).toBeLessThanOrEqual(100);
    expect(result.retention_p25).toBeCloseTo(60, 6); // idx 1
    expect(result.retention_p50).toBeCloseTo(26, 6); // idx 2
    expect(result.retention_p100).toBeCloseTo(12, 6); // completion
  });

  it("normalizes raw play-count curves the same as fraction/percentage curves", () => {
    // Raw counts (index 0 = total plays) must collapse to the same retention %.
    const field = [{ action_type: "video_view", value: [10000, 6000, 2600, 1600, 1200] }];
    const result = parsePlayCurve(field);
    expect(result.play_curve).toEqual([100, 60, 26, 16, 12]);
    expect(Math.max(...(result.play_curve as number[]))).toBeLessThanOrEqual(100);
  });

  it("clamps intervals that exceed the at-start value to 100 (rewatch spikes)", () => {
    const field = [{ action_type: "video_view", value: [1, 2, 0.5] }];
    const result = parsePlayCurve(field);
    expect(result.play_curve).toEqual([100, 100, 50]);
  });

  it("falls back to the series max when the first interval is zero", () => {
    const field = [{ action_type: "video_view", value: [0, 50, 100, 25] }];
    const result = parsePlayCurve(field);
    expect(result.play_curve).toEqual([0, 50, 100, 25]);
  });

  it("returns all-null when every interval is zero (no usable denominator)", () => {
    const field = [{ action_type: "video_view", value: [0, 0, 0] }];
    const result = parsePlayCurve(field);
    expect(result.play_curve).toBeNull();
    expect(result.retention_p50).toBeNull();
  });

  it("returns all-null for a non-video / missing field (no crash, NO zero-fill)", () => {
    for (const missing of [undefined, null, [], {}, "", 0]) {
      const result = parsePlayCurve(missing as unknown);
      expect(result.play_curve).toBeNull();
      expect(result.retention_p25).toBeNull();
      expect(result.retention_p50).toBeNull();
      expect(result.retention_p75).toBeNull();
      expect(result.retention_p100).toBeNull();
    }
  });

  it("returns all-null when the action entry carries no nested value array", () => {
    // Flat-shaped (wrong) payload — must not be mistaken for a curve.
    const field = [{ action_type: "video_view", value: "0.42" }];
    const result = parsePlayCurve(field);
    expect(result.play_curve).toBeNull();
    expect(result.retention_p100).toBeNull();
  });

  it("bails out (null) on a malformed interval rather than emitting a partial/zero-filled curve", () => {
    const field = [{ action_type: "video_view", value: ["1", "0.9", "not-a-number", "0.5"] }];
    const result = parsePlayCurve(field);
    expect(result.play_curve).toBeNull();
    expect(result.retention_p50).toBeNull();
  });
});
