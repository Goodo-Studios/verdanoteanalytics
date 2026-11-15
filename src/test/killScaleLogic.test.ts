import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useKillScaleLogic, defaultKillScaleThresholds, type KillScaleConfig } from "@/lib/killScaleLogic";

const cpaCfg: KillScaleConfig = { winnerKpi: "cpa", winnerKpiDirection: "lte", scaleAt: 30, killAt: 60, spendThreshold: 50 };
const roasCfg: KillScaleConfig = { winnerKpi: "roas", winnerKpiDirection: "gte", scaleAt: 2, killAt: 1, spendThreshold: 50 };

function run(creatives: any[], cfg: KillScaleConfig) {
  return renderHook(() => useKillScaleLogic(creatives, cfg)).result.current;
}

describe("useKillScaleLogic, lte (CPA) direction", () => {
  it("kills an ad with real spend and zero purchases (CPA stored as 0)", () => {
    const r = run([{ ad_id: "a", spend: 200, cpa: 0 }], cpaCfg);
    expect(r.kill.map((c) => c.ad_id)).toEqual(["a"]);
    expect(r.watch).toHaveLength(0);
    expect(r.scale).toHaveLength(0);
  });

  it("kills a zero-CPA ad exactly at the spend threshold", () => {
    expect(run([{ ad_id: "a", spend: 50, cpa: 0 }], cpaCfg).kill).toHaveLength(1);
  });

  it("keeps a zero-CPA ad on Watch while spend is below the threshold", () => {
    const r = run([{ ad_id: "a", spend: 49, cpa: 0 }], cpaCfg);
    expect(r.watch).toHaveLength(1);
    expect(r.kill).toHaveLength(0);
  });

  it("scales a low CPA, kills a high CPA, watches in between", () => {
    const r = run(
      [
        { ad_id: "s", spend: 100, cpa: 20 },
        { ad_id: "k", spend: 100, cpa: 90 },
        { ad_id: "w", spend: 100, cpa: 45 },
      ],
      cpaCfg,
    );
    expect(r.scale.map((c) => c.ad_id)).toEqual(["s"]);
    expect(r.kill.map((c) => c.ad_id)).toEqual(["k"]);
    expect(r.watch.map((c) => c.ad_id)).toEqual(["w"]);
  });
});

describe("useKillScaleLogic, gte (ROAS) direction", () => {
  it("scales, kills and watches by threshold; zero ROAS with spend is a kill", () => {
    const r = run(
      [
        { ad_id: "s", spend: 100, roas: 3 },
        { ad_id: "k", spend: 100, roas: 0.5 },
        { ad_id: "z", spend: 100, roas: 0 },
        { ad_id: "w", spend: 100, roas: 1.5 },
        { ad_id: "low", spend: 10, roas: 0 },
      ],
      roasCfg,
    );
    expect(r.scale.map((c) => c.ad_id)).toEqual(["s"]);
    expect(r.kill.map((c) => c.ad_id).sort()).toEqual(["k", "z"]);
    expect(r.watch.map((c) => c.ad_id).sort()).toEqual(["low", "w"]);
  });
});

describe("defaultKillScaleThresholds", () => {
  it("derives ROAS defaults from the ROAS threshold", () => {
    expect(defaultKillScaleThresholds("roas", 2)).toEqual({ scaleAt: 2, killAt: 1 });
  });
  it("uses absolute CPA defaults (scale below kill)", () => {
    const d = defaultKillScaleThresholds("cpa", 2);
    expect(d.scaleAt).toBeLessThan(d.killAt);
    expect(d).toEqual({ scaleAt: 30, killAt: 60 });
  });
  it("uses percentage defaults for CTR and hook rate (scale above kill)", () => {
    expect(defaultKillScaleThresholds("ctr", 2)).toEqual({ scaleAt: 1.5, killAt: 0.8 });
    expect(defaultKillScaleThresholds("thumb_stop_rate", 2)).toEqual({ scaleAt: 30, killAt: 20 });
  });
  it("falls back to ROAS-style defaults for an unknown KPI", () => {
    expect(defaultKillScaleThresholds("mystery", 4)).toEqual({ scaleAt: 4, killAt: 2 });
  });
});
