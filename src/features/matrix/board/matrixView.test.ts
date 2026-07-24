// US-008: unit tests for the pure inner-grid (hook × body) view helpers. No
// React, no I/O — mirrors the discipline of the RPC-shaping module they cover.
// Spend-first coloring is exercised via spendColor; these focus on the new
// keying / lookup / ads-filtering helpers.

import { describe, expect, it } from "vitest";
import {
  adsForInnerCell,
  indexInnerCells,
  innerCellDisplay,
  innerCellKey,
  maxInnerCellSpend,
  tagLabel,
} from "./matrixView";
import type { MatrixAtomicAd, MatrixInnerCell } from "./api";

function inner(partial: Partial<MatrixInnerCell>): MatrixInnerCell {
  return {
    hook: null,
    body: null,
    is_untagged_hook: false,
    is_untagged_body: false,
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
    body: null,
    is_untagged_hook: false,
    is_untagged_body: false,
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

describe("tagLabel", () => {
  it("labels null as the explicit Untagged bucket", () => {
    expect(tagLabel(null)).toBe("Untagged");
    expect(tagLabel("Bold claim")).toBe("Bold claim");
  });
});

describe("innerCellKey / indexInnerCells", () => {
  it("keys tagged and untagged (hook, body) pairs distinctly", () => {
    expect(innerCellKey("Bold claim", "Problem-solution")).not.toBe(innerCellKey(null, null));
    // null on either axis stays distinct from a tagged value on that axis.
    expect(innerCellKey(null, "Problem-solution")).not.toBe(
      innerCellKey("Bold claim", "Problem-solution"),
    );
    expect(innerCellKey("Bold claim", null)).not.toBe(innerCellKey("Bold claim", "Problem-solution"));
  });

  it("indexes cells for O(1) lookup by (hook, body)", () => {
    const cells = [
      inner({ hook: "Bold claim", body: "Problem-solution", total_spend: 400, n_ads: 2 }),
      inner({ hook: null, body: null, is_untagged_hook: true, is_untagged_body: true, total_spend: 100, n_ads: 1 }),
    ];
    const idx = indexInnerCells(cells);
    expect(idx.get(innerCellKey("Bold claim", "Problem-solution"))?.total_spend).toBe(400);
    expect(idx.get(innerCellKey(null, null))?.n_ads).toBe(1);
    expect(idx.get(innerCellKey("missing", "combo"))).toBeUndefined();
  });
});

describe("maxInnerCellSpend", () => {
  it("returns the largest cell spend (the color-scale denominator)", () => {
    expect(
      maxInnerCellSpend([inner({ total_spend: 100 }), inner({ total_spend: 400 }), inner({ total_spend: 250 })]),
    ).toBe(400);
    expect(maxInnerCellSpend([])).toBe(0);
  });
});

describe("innerCellDisplay", () => {
  it("shows spend money when the cell has ads, whitespace otherwise", () => {
    expect(innerCellDisplay(inner({ total_spend: 400, n_ads: 2 }))).toBe("$400");
    expect(innerCellDisplay(inner({ total_spend: 0, n_ads: 0 }))).toBe("");
    expect(innerCellDisplay(undefined)).toBe("");
  });
});

describe("adsForInnerCell", () => {
  const ads = [
    ad({ ad_id: "a1", hook: "Bold claim", body: "Problem-solution", total_spend: 300 }),
    ad({ ad_id: "a2", hook: "Bold claim", body: "Problem-solution", total_spend: 100 }),
    ad({ ad_id: "a3", hook: null, body: null, is_untagged_hook: true, is_untagged_body: true, total_spend: 100 }),
  ];

  it("returns only the ads in the (hook, body) combo, spend order preserved", () => {
    const rows = adsForInnerCell(ads, "Bold claim", "Problem-solution");
    expect(rows.map((r) => r.ad_id)).toEqual(["a1", "a2"]);
  });

  it("surfaces untagged hook/body ads (null matches the untagged bucket)", () => {
    const rows = adsForInnerCell(ads, null, null);
    expect(rows.map((r) => r.ad_id)).toEqual(["a3"]);
  });

  it("does not conflate a tagged value with the untagged bucket", () => {
    expect(adsForInnerCell(ads, "Bold claim", null)).toHaveLength(0);
  });
});
