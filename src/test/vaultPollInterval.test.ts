/**
 * Regression: the Vault library list used to poll every 5s unconditionally,
 * for as long as the page stayed open — re-downloading the whole filtered
 * `inspiration_items` list (plus its two joins) even when nothing in it was
 * still processing. `vaultListPollInterval` is the pure decision LibraryPage
 * now feeds to React Query's `refetchInterval`; these tests pin it directly.
 */
import { describe, it, expect } from "vitest";
import { vaultListPollInterval } from "@/features/vault/types/vault";

describe("vaultListPollInterval", () => {
  it("returns false for an empty or undefined list — nothing to poll for", () => {
    expect(vaultListPollInterval(undefined)).toBe(false);
    expect(vaultListPollInterval([])).toBe(false);
  });

  it("returns false when every item has reached a terminal status", () => {
    expect(
      vaultListPollInterval([{ status: "ready" }, { status: "error" }, { status: "ready" }]),
    ).toBe(false);
  });

  it("polls at 5s when at least one item is still processing", () => {
    for (const status of ["pending", "extracting", "transcribing", "analyzing"]) {
      expect(vaultListPollInterval([{ status: "ready" }, { status }])).toBe(5000);
    }
  });
});
