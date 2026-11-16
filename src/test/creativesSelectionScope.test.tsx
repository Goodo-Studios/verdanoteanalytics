/**
 * Creatives page: a bulk selection belongs to one account (audit plan item 3.2).
 *
 * Selecting creatives in account A and then switching to account B used to keep A's ids in the
 * selection, so "Tag", "Sync from name" and "Add to report" acted on A's creatives while the user
 * was looking at B. The selection now resets when the account changes, and the tag save tells the
 * server which account the user is working in, so the server can refuse a creative from another one.
 */
import { act, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("@/lib/api", () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { useScopedSelection } from "@/hooks/useScopedSelection";
import { creativeUpdatePath } from "@/hooks/useCreatives";

describe("useScopedSelection", () => {
  it("keeps the selection while the account stays the same", () => {
    const { result, rerender } = renderHook(({ scope }) => useScopedSelection(scope), { initialProps: { scope: "acct-a" as string | null } });
    act(() => result.current[1](new Set(["ad-1", "ad-2"])));
    rerender({ scope: "acct-a" });
    expect([...result.current[0]]).toEqual(["ad-1", "ad-2"]);
  });

  it("is empty as soon as the account changes, on the very first render", () => {
    const { result, rerender } = renderHook(({ scope }) => useScopedSelection(scope), { initialProps: { scope: "acct-a" as string | null } });
    act(() => result.current[1](new Set(["ad-1"])));
    rerender({ scope: "acct-b" });
    expect(result.current[0].size).toBe(0);
  });

  it("does not bring the old selection back when switching back", () => {
    const { result, rerender } = renderHook(({ scope }) => useScopedSelection(scope), { initialProps: { scope: "acct-a" as string | null } });
    act(() => result.current[1](new Set(["ad-1"])));
    rerender({ scope: "acct-b" });
    rerender({ scope: "acct-a" });
    expect(result.current[0].size).toBe(0);
  });

  it("an updater function sees only the current account's selection", () => {
    const { result, rerender } = renderHook(({ scope }) => useScopedSelection(scope), { initialProps: { scope: "acct-a" as string | null } });
    act(() => result.current[1](new Set(["ad-1"])));
    rerender({ scope: "acct-b" });
    act(() => result.current[1]((prev) => new Set([...prev, "ad-9"])));
    expect([...result.current[0]]).toEqual(["ad-9"]);
  });
});

describe("tag save carries the working account", () => {
  beforeEach(() => apiFetch.mockReset());

  it("adds account_id for a single account and leaves it off for all accounts or none", () => {
    expect(creativeUpdatePath("ad1", "acct a")).toBe("ad1?account_id=acct%20a");
    expect(creativeUpdatePath("ad1", "all")).toBe("ad1");
    expect(creativeUpdatePath("ad1", null)).toBe("ad1");
    expect(creativeUpdatePath("ad1")).toBe("ad1");
  });
});

describe("Creatives page wiring", () => {
  const page = readFileSync(join(process.cwd(), "src/pages/CreativesPage.tsx"), "utf8");
  const modal = readFileSync(join(process.cwd(), "src/components/creatives/BulkTagModal.tsx"), "utf8");

  it("scopes the bulk selection to the selected account", () => {
    expect(page).toMatch(/useScopedSelection\(selectedAccountId\)/);
    expect(page).not.toMatch(/useState<Set<string>>\(new Set\(\)\)/);
  });

  it("passes the account to the bulk tag modal, which sends it with each save", () => {
    expect(page).toMatch(/<BulkTagModal[\s\S]*?accountId=\{selectedAccountId\}/);
    expect(modal).toMatch(/mutateAsync\(\{ adId, updates, accountId \}\)/);
  });
});
