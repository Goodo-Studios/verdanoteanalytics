import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKillScaleLogic, type KillScaleConfig } from "@/lib/killScaleLogic";

const defaultConfig: KillScaleConfig = {
  winnerKpi: "roas",
  winnerKpiDirection: "gte",
  scaleAt: 3.0,
  killAt: 1.0,
  spendThreshold: 50,
};

const creative = (ad_id: string, roas: number, spend: number) => ({
  ad_id,
  roas,
  spend,
});

describe("useKillScaleLogic (gte direction — ROAS)", () => {
  it("kills a creative clearly below kill threshold", () => {
    const creatives = [creative("bad", 0.4, 200)];
    const { result } = renderHook(() => useKillScaleLogic(creatives, defaultConfig));
    expect(result.current.kill).toHaveLength(1);
    expect(result.current.kill[0].ad_id).toBe("bad");
  });

  it("scales a creative clearly above scale threshold", () => {
    const creatives = [creative("winner", 5.0, 200)];
    const { result } = renderHook(() => useKillScaleLogic(creatives, defaultConfig));
    expect(result.current.scale).toHaveLength(1);
    expect(result.current.scale[0].ad_id).toBe("winner");
  });

  it("watches a creative between kill and scale thresholds", () => {
    const creatives = [creative("mid", 1.5, 200)];
    const { result } = renderHook(() => useKillScaleLogic(creatives, defaultConfig));
    expect(result.current.watch).toHaveLength(1);
    expect(result.current.watch[0].ad_id).toBe("mid");
  });

  it("watches a creative at exactly scale threshold boundary", () => {
    const creatives = [creative("at_scale", 3.0, 200)];
    const { result } = renderHook(() => useKillScaleLogic(creatives, defaultConfig));
    // exactly at scaleAt (>=) should scale
    expect(result.current.scale).toHaveLength(1);
  });

  it("watches a creative with 0 spend (insufficient data)", () => {
    const creatives = [creative("new", 0, 0)];
    const { result } = renderHook(() => useKillScaleLogic(creatives, defaultConfig));
    expect(result.current.watch[0].reason).toMatch(/insufficient/i);
  });

  it("returns empty arrays when creatives list is empty", () => {
    const { result } = renderHook(() => useKillScaleLogic([], defaultConfig));
    expect(result.current.scale).toHaveLength(0);
    expect(result.current.kill).toHaveLength(0);
    expect(result.current.watch).toHaveLength(0);
  });
});

describe("useKillScaleLogic (lte direction — CPA)", () => {
  const cpaConfig: KillScaleConfig = {
    winnerKpi: "cpa",
    winnerKpiDirection: "lte",
    scaleAt: 20,   // scale if CPA <= $20
    killAt: 60,    // kill if CPA > $60
    spendThreshold: 50,
  };

  it("scales a creative with low CPA", () => {
    const creatives = [{ ad_id: "efficient", cpa: 15, spend: 200 }];
    const { result } = renderHook(() => useKillScaleLogic(creatives, cpaConfig));
    expect(result.current.scale).toHaveLength(1);
  });

  it("kills a creative with high CPA", () => {
    const creatives = [{ ad_id: "expensive", cpa: 80, spend: 200 }];
    const { result } = renderHook(() => useKillScaleLogic(creatives, cpaConfig));
    expect(result.current.kill).toHaveLength(1);
  });
});
