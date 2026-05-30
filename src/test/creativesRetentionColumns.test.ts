/**
 * US-005 — Sortable retention threshold columns in the creatives table.
 *
 * Verifies that retention_p25/p50/p75/p100:
 *   - are registered in every lookup map that drives the data-driven table
 *     (TABLE_COLUMNS, SORT_FIELD_MAP, HEAD_LABELS, NUMERIC_COLS,
 *     MOBILE_HIDDEN_COLS, CELL_CONFIG),
 *   - format as whole-percent values (e.g. "73%") via CELL_CONFIG + fmt, and
 *     render the neutral "—" placeholder for null (non-video / not-yet-backfilled)
 *     rather than a misleading "0%",
 *   - sort through the SAME shared comparator as the other numeric columns, with
 *     null values always sorting LAST regardless of asc/desc direction.
 */
import { describe, it, expect } from "vitest";
import {
  TABLE_COLUMNS,
  SORT_FIELD_MAP,
  HEAD_LABELS,
  NUMERIC_COLS,
  MOBILE_HIDDEN_COLS,
  CELL_CONFIG,
  compareCreativesBy,
  fmt,
} from "@/components/creatives/constants";

const RETENTION_KEYS = [
  "retention_p25",
  "retention_p50",
  "retention_p75",
  "retention_p100",
] as const;

describe("retention threshold columns (US-005)", () => {
  it("registers all four columns in the Engagement group of TABLE_COLUMNS", () => {
    for (const key of RETENTION_KEYS) {
      const col = TABLE_COLUMNS.find((c) => c.key === key);
      expect(col, `TABLE_COLUMNS missing ${key}`).toBeTruthy();
      expect(col!.group).toBe("Engagement");
    }
  });

  it("defaults p50 + p100 visible and leaves p25 + p75 toggleable", () => {
    const visible = (k: string) => TABLE_COLUMNS.find((c) => c.key === k)!.defaultVisible;
    expect(visible("retention_p50")).toBe(true);
    expect(visible("retention_p100")).toBe(true);
    expect(visible("retention_p25")).toBe(false);
    expect(visible("retention_p75")).toBe(false);
  });

  it("registers each column in every driving lookup map", () => {
    for (const key of RETENTION_KEYS) {
      expect(SORT_FIELD_MAP[key], `SORT_FIELD_MAP missing ${key}`).toBe(key);
      expect(HEAD_LABELS[key], `HEAD_LABELS missing ${key}`).toBeTruthy();
      expect(NUMERIC_COLS.has(key), `NUMERIC_COLS missing ${key}`).toBe(true);
      expect(MOBILE_HIDDEN_COLS.has(key), `MOBILE_HIDDEN_COLS missing ${key}`).toBe(true);
      expect(CELL_CONFIG[key], `CELL_CONFIG missing ${key}`).toBeTruthy();
    }
  });

  it("formats retention values as whole percentages via CELL_CONFIG + fmt", () => {
    for (const key of RETENTION_KEYS) {
      const cfg = CELL_CONFIG[key];
      expect(cfg.format?.suffix).toBe("%");
      expect(cfg.format?.decimals).toBe(0);
      // 73 -> "73%" (whole percent, consistent with the chart/modal).
      expect(fmt(73, cfg.format?.prefix, cfg.format?.suffix, cfg.format?.decimals)).toBe("73%");
    }
  });

  it("renders the neutral em-dash placeholder for null, never a misleading 0%", () => {
    const cfg = CELL_CONFIG.retention_p50;
    expect(fmt(null, cfg.format?.prefix, cfg.format?.suffix, cfg.format?.decimals)).toBe("—");
    expect(fmt(undefined, cfg.format?.prefix, cfg.format?.suffix, cfg.format?.decimals)).toBe("—");
  });

  it("sorts retention columns numerically through the shared comparator", () => {
    const rows = [
      { retention_p50: 22 },
      { retention_p50: 81 },
      { retention_p50: 58 },
    ];
    const asc = [...rows].sort((a, b) => compareCreativesBy(a, b, "retention_p50", "asc"));
    expect(asc.map((r) => r.retention_p50)).toEqual([22, 58, 81]);
    const desc = [...rows].sort((a, b) => compareCreativesBy(a, b, "retention_p50", "desc"));
    expect(desc.map((r) => r.retention_p50)).toEqual([81, 58, 22]);
  });

  it("sorts null retention values LAST regardless of direction", () => {
    const rows = [
      { ad_name: "a", retention_p100: 40 },
      { ad_name: "b", retention_p100: null },
      { ad_name: "c", retention_p100: 12 },
    ];

    const asc = [...rows].sort((a, b) => compareCreativesBy(a, b, "retention_p100", "asc"));
    expect(asc.map((r) => r.retention_p100)).toEqual([12, 40, null]);

    const desc = [...rows].sort((a, b) => compareCreativesBy(a, b, "retention_p100", "desc"));
    expect(desc.map((r) => r.retention_p100)).toEqual([40, 12, null]);
  });
});
