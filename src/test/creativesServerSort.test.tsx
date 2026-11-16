/**
 * The Creatives page asks the server to sort (audit plan item 7.1, part 1).
 *
 * Clicking a column header only re-sorted the 100 rows already loaded, so "sort by ROAS"
 * showed the best ROAS among the top-spend page rather than the best overall. The sort now
 * travels with the list request, and a new sort goes back to page one.
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
import { SERVER_SORT_FIELDS } from "@/lib/creativeServerSort";

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

describe("Creatives page sort is sent to the server", () => {
  it("sends the column and direction with the list request", () => {
    const { result } = renderHook(() => useCreativesPageState(), { wrapper });
    act(() => result.current.handleSort("roas"));
    expect(result.current.allFilters).toMatchObject({ sort: "roas", sort_dir: "asc" });
    act(() => result.current.handleSort("roas"));
    expect(result.current.allFilters).toMatchObject({ sort: "roas", sort_dir: "desc" });
  });

  it("maps the column key to the field the server sorts by", () => {
    const { result } = renderHook(() => useCreativesPageState(), { wrapper });
    act(() => result.current.handleSort("hook_rate"));
    expect(result.current.allFilters).toMatchObject({ sort: "thumb_stop_rate" });
    act(() => result.current.handleSort("creative"));
    expect(result.current.allFilters).toMatchObject({ sort: "ad_name" });
  });

  it("goes back to page one when the sort changes", () => {
    const { result } = renderHook(() => useCreativesPageState(), { wrapper });
    act(() => result.current.setPage(3));
    act(() => result.current.handleSort("spend"));
    expect(result.current.page).toBe(0);
  });

  it("sends no sort for columns the server cannot order (grade, CPMr)", () => {
    const { result } = renderHook(() => useCreativesPageState(), { wrapper });
    act(() => result.current.handleSort("grade"));
    expect(result.current.allFilters).not.toHaveProperty("sort");
  });
});

describe("server sort whitelist", () => {
  it("matches the fields creatives_list_page accepts", () => {
    const sql = readFileSync(
      resolve(__dirname, "../../supabase/migrations/20261216320001_creatives_list_server_sort.sql"), "utf8");
    const list = (name: string) => {
      const m = sql.match(new RegExp(`${name} constant text\\[\\] := ARRAY\\[([^\\]]*)\\]`));
      expect(m, `${name} not found`).toBeTruthy();
      return [...m![1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
    };
    expect([...list("v_num_sorts"), ...list("v_text_sorts")].sort()).toEqual([...SERVER_SORT_FIELDS].sort());
  });
});
