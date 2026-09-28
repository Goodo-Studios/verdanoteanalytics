// Unit tests for the pure Creative Matrix view helpers: fixed Creative Type row
// order, (creative type, theme) cell keying, spend-first display, and the hook
// split inside a cell. No React, no I/O.

import { describe, expect, it } from "vitest";
import {
  adsForHook,
  boardRows,
  cellDisplay,
  cellKey,
  creativeTypeLabel,
  hookKey,
  hookRowDisplay,
  indexCells,
  maxCellSpend,
  tagLabel,
  VIEW_MODES,
} from "./matrixView";
import type { MatrixAtomicAd, MatrixCell, MatrixCellHook, MatrixCreativeType } from "./api";

function cell(partial: Partial<MatrixCell>): MatrixCell {
  return {
    creative_type: null,
    is_other_type: false,
    theme: null,
    is_untagged_theme: false,
    total_spend: 0,
    n_ads: 0,
    roas: 0,
    cpa: 0,
    ctr: 0,
    cpm: 0,
    purchases: 0,
    total_purchase_value: 0,
    result_count: 0,
    cost_per_result: 0,
    spend_rank: 0,
    ...partial,
  };
}

function hook(partial: Partial<MatrixCellHook>): MatrixCellHook {
  return {
    hook: null,
    is_untagged: false,
    total_spend: 0,
    n_ads: 0,
    roas: 0,
    cpa: 0,
    ctr: 0,
    cpm: 0,
    purchases: 0,
    total_purchase_value: 0,
    result_count: 0,
    cost_per_result: 0,
    spend_rank: 0,
    ...partial,
  };
}

function ad(partial: Partial<MatrixAtomicAd>): MatrixAtomicAd {
  return {
    ad_id: "ad",
    ad_name: null,
    ad_status: null,
    thumbnail_url: null,
    preview_url: null,
    video_url: null,
    hook: null,
    is_untagged_hook: false,
    total_spend: 0,
    roas: 0,
    cpa: 0,
    ctr: 0,
    cpm: 0,
    purchases: 0,
    total_purchase_value: 0,
    result_count: 0,
    cost_per_result: 0,
    ...partial,
  };
}

const type = (creative_type: string | null, total_spend = 0): MatrixCreativeType => ({
  creative_type,
  is_other: creative_type === null,
  total_spend,
  n_ads: total_spend > 0 ? 1 : 0,
});

describe("boardRows — fixed Creative Type row order", () => {
  it("always renders the 4 Creative Types in naming-convention order, whatever order the payload has", () => {
    const rows = boardRows([type("Lifestyle", 50), type("UGC Native", 900), type("Text Forward", 10)]);
    expect(rows.map((r) => r.creative_type)).toEqual([
      "UGC Native",
      "Studio Clean",
      "Text Forward",
      "Lifestyle",
    ]);
    // Totals carry from the payload; a type absent from the payload is zero.
    expect(rows[0].total_spend).toBe(900);
    expect(rows[1].total_spend).toBe(0);
    expect(rows[1].n_ads).toBe(0);
  });

  it("appends the Other / untagged row last, only when the payload has it", () => {
    expect(boardRows([type("UGC Native", 1)])).toHaveLength(4);
    const rows = boardRows([type(null, 70), type("Studio Clean", 5)]);
    expect(rows).toHaveLength(5);
    expect(rows[4].creative_type).toBeNull();
    expect(rows[4].is_other).toBe(true);
    expect(rows[4].total_spend).toBe(70);
  });

  it("labels the null row Other / untagged", () => {
    expect(creativeTypeLabel(null)).toBe("Other / untagged");
    expect(creativeTypeLabel("Text Forward")).toBe("Text Forward");
  });
});

describe("cellKey / indexCells — Creative Type × Theme", () => {
  it("keys tagged, Other and untagged pairs distinctly", () => {
    expect(cellKey("UGC Native", "Tired By 3pm")).not.toBe(cellKey(null, null));
    expect(cellKey(null, "Tired By 3pm")).not.toBe(cellKey("UGC Native", "Tired By 3pm"));
    expect(cellKey("UGC Native", null)).not.toBe(cellKey("UGC Native", "Tired By 3pm"));
  });

  it("indexes cells for lookup by (creative type, theme)", () => {
    const idx = indexCells([
      cell({ creative_type: "UGC Native", theme: "Busy Parents", total_spend: 400, n_ads: 2 }),
      cell({ creative_type: null, theme: null, is_other_type: true, is_untagged_theme: true, total_spend: 100, n_ads: 1 }),
    ]);
    expect(idx.get(cellKey("UGC Native", "Busy Parents"))?.total_spend).toBe(400);
    expect(idx.get(cellKey(null, null))?.n_ads).toBe(1);
    expect(idx.get(cellKey("Lifestyle", "Busy Parents"))).toBeUndefined();
  });
});

describe("cellDisplay — spend-first view modes", () => {
  const c = cell({ creative_type: "UGC Native", theme: "Busy Parents", total_spend: 600, n_ads: 5 });

  it("has no Status mode (theme is free text, no test status)", () => {
    expect(VIEW_MODES.map((m) => m.key)).toEqual(["performance", "coverage", "volume", "winrate"]);
  });

  it("shows spend, coverage, volume and the theme spend share", () => {
    expect(cellDisplay(c, "performance", 800)).toBe("$600");
    expect(cellDisplay(c, "coverage", 800)).toBe("●");
    expect(cellDisplay(c, "volume", 800)).toBe("5");
    expect(cellDisplay(c, "winrate", 800)).toBe("75%");
    expect(cellDisplay(c, "winrate", 0)).toBe("0%");
  });

  it("renders whitespace for an empty cell (0 in volume mode)", () => {
    expect(cellDisplay(undefined, "performance", 0)).toBe("");
    expect(cellDisplay(undefined, "volume", 0)).toBe("0");
  });

  it("maxCellSpend returns the colour-scale denominator", () => {
    expect(maxCellSpend([cell({ total_spend: 100 }), cell({ total_spend: 400 })])).toBe(400);
    expect(maxCellSpend([])).toBe(0);
  });
});

describe("hook split inside a cell", () => {
  it("labels null as the explicit Untagged bucket", () => {
    expect(tagLabel(null)).toBe("Untagged");
    expect(tagLabel("Tired By 3pm")).toBe("Tired By 3pm");
  });

  it("keys hooks by exact text, untagged distinct", () => {
    expect(hookKey("Tired By 3pm")).not.toBe(hookKey(null));
    expect(hookKey("Tired By 3pm")).not.toBe(hookKey("tired by 3pm"));
  });

  it("shows hook spend when it has ads, whitespace otherwise", () => {
    expect(hookRowDisplay(hook({ hook: "Tired By 3pm", total_spend: 400, n_ads: 2 }))).toBe("$400");
    expect(hookRowDisplay(hook({ n_ads: 0 }))).toBe("");
    expect(hookRowDisplay(undefined)).toBe("");
  });

  const ads = [
    ad({ ad_id: "a1", hook: "Tired By 3pm", total_spend: 300 }),
    ad({ ad_id: "a2", hook: "Tired By 3pm", total_spend: 100 }),
    ad({ ad_id: "a3", hook: "Tired by 3pm", total_spend: 90 }),
    ad({ ad_id: "a4", hook: null, is_untagged_hook: true, total_spend: 50 }),
  ];

  it("returns only ads with that exact hook, spend order preserved (no clustering)", () => {
    expect(adsForHook(ads, "Tired By 3pm").map((r) => r.ad_id)).toEqual(["a1", "a2"]);
    expect(adsForHook(ads, "Tired by 3pm").map((r) => r.ad_id)).toEqual(["a3"]);
  });

  it("surfaces untagged-hook ads under the null bucket", () => {
    expect(adsForHook(ads, null).map((r) => r.ad_id)).toEqual(["a4"]);
  });
});
