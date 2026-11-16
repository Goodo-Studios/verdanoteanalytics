/**
 * Narrowing the date range no longer strands the user on an empty page (audit plan item 7.2).
 *
 * The Creatives page went back to page one when filters or the account changed, but not when
 * the date range changed, so page 4 of a 30-day range became an empty page 4 of a 3-day
 * range. The page now resets on a date change, and a page past the end moves to the last
 * real page once the total is known.
 */
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const range = { dateFrom: "2026-10-16", dateTo: "2026-11-14" };
vi.mock("@/contexts/AccountContext", () => ({
  useAccountContext: () => ({ selectedAccountId: "act_1" }),
}));
vi.mock("@/contexts/DateRangeContext", () => ({
  useDateRangeContext: () => ({ ...range, setDateRange: () => {} }),
}));

import { useCreativesPageState } from "@/hooks/useCreativesPageState";
import { clampPage } from "@/lib/pagination";

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

describe("Creatives page number", () => {
  it("goes back to page one when the date range changes", () => {
    const { result, rerender } = renderHook(() => useCreativesPageState(), { wrapper });
    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);
    range.dateFrom = "2026-11-12";
    rerender();
    expect(result.current.page).toBe(0);
  });

  it("moves a page past the end to the last real page", () => {
    expect(clampPage(5, 2)).toBe(1);
    expect(clampPage(1, 2)).toBe(1);
    expect(clampPage(0, 0)).toBe(0);
    expect(clampPage(3, 0)).toBe(0);
  });
});
