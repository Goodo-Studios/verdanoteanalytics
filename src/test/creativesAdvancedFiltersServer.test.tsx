/**
 * The Creatives page sends its advanced filters to the server (audit plan item 7.1, part 3).
 *
 * The advanced filter panel filtered the 100 rows already loaded, so matching ads on other
 * pages never showed and the total ignored the filter. The conditions now travel with the
 * list request, and changing them goes back to page one.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/AccountContext", () => ({
  useAccountContext: () => ({ selectedAccountId: "act_1" }),
}));
vi.mock("@/contexts/DateRangeContext", () => ({
  useDateRangeContext: () => ({ dateFrom: "2026-11-01", dateTo: "2026-11-14", setDateRange: () => {} }),
}));

import { useCreativesPageState } from "@/hooks/useCreativesPageState";

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const roasOver3 = [{ id: "a", field: "roas", operator: "gt", value: "3" }];

describe("advanced filters go to the server", () => {
  it("sends the conditions with the list request", () => {
    const { result } = renderHook(() => useCreativesPageState(), { wrapper });
    act(() => result.current.setAdvancedConditions(roasOver3));
    const adv = (result.current.allFilters as Record<string, string>).adv;
    expect(adv).toBeTruthy();
    expect(JSON.parse(adv)).toEqual([{ field: "roas", operator: "gt", value: "3" }]);
  });

  it("sends nothing when there are no conditions", () => {
    const { result } = renderHook(() => useCreativesPageState(), { wrapper });
    expect(result.current.allFilters).not.toHaveProperty("adv");
  });

  it("goes back to page one when the conditions change", () => {
    const { result } = renderHook(() => useCreativesPageState(), { wrapper });
    act(() => result.current.setPage(2));
    act(() => result.current.setAdvancedConditions(roasOver3));
    expect(result.current.page).toBe(0);
  });

  it("the page no longer filters the loaded rows itself", () => {
    const src = readFileSync(resolve(__dirname, "../pages/CreativesPage.tsx"), "utf8");
    expect(src).not.toMatch(/applyAdvancedFilters\(/);
  });
});
