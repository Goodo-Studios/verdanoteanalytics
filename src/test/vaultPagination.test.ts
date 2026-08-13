import { describe, it, expect, vi } from "vitest";
import { fillVaultPage } from "@/features/vault/utils/pagination";

/** Fake table of `total` rows; every `staticEvery`-th row is a static image. */
function fakeTable(total: number, staticEvery = 0) {
  const rows = Array.from({ length: total }, (_, i) => ({
    id: `it${i}`,
    file_path: staticEvery && i % staticEvery === 0 ? `a/${i}.jpg` : `a/${i}.mp4`,
  }));
  const fetchRange = vi.fn(async (from: number, to: number) => rows.slice(from, to + 1));
  return { rows, fetchRange };
}

const isVideo = (r: { file_path: string }) => !r.file_path.endsWith(".jpg");

describe("fillVaultPage", () => {
  it("fetches exactly one range when nothing is filtered out", async () => {
    const { fetchRange } = fakeTable(500);

    const page = await fillVaultPage({
      fetchRange,
      matches: () => true,
      startOffset: 0,
      pageSize: 48,
    });

    expect(fetchRange).toHaveBeenCalledTimes(1);
    expect(fetchRange).toHaveBeenCalledWith(0, 47);
    expect(page.items).toHaveLength(48);
    expect(page.nextOffset).toBe(48);
  });

  it("walks forward until the page is full of MATCHING rows", async () => {
    // Every 2nd row is a static image, so a 48-row read yields 24 videos.
    const { fetchRange } = fakeTable(500, 2);

    const page = await fillVaultPage({
      fetchRange,
      matches: isVideo,
      startOffset: 0,
      pageSize: 48,
    });

    // One read would have returned a half-empty page; it must keep going.
    expect(fetchRange.mock.calls.length).toBeGreaterThan(1);
    expect(page.items).toHaveLength(48);
    expect(page.items.every(isVideo)).toBe(true);
    // And the next page resumes after everything already scanned — no repeats.
    expect(page.nextOffset).toBe(96);
  });

  it("reports exhaustion instead of offering a next page that would be empty", async () => {
    const { fetchRange } = fakeTable(20);

    const page = await fillVaultPage({
      fetchRange,
      matches: () => true,
      startOffset: 0,
      pageSize: 48,
    });

    expect(page.items).toHaveLength(20);
    expect(page.nextOffset).toBeNull();
  });

  it("treats an exactly-full final read as exhausted on the following page", async () => {
    const { fetchRange } = fakeTable(48);

    const first = await fillVaultPage({
      fetchRange,
      matches: () => true,
      startOffset: 0,
      pageSize: 48,
    });
    // 48 rows back from a 48-row window — indistinguishable from "more to come",
    // so it must offer a next page rather than silently dropping data.
    expect(first.nextOffset).toBe(48);

    const second = await fillVaultPage({
      fetchRange,
      matches: () => true,
      startOffset: first.nextOffset!,
      pageSize: 48,
    });
    expect(second.items).toHaveLength(0);
    expect(second.nextOffset).toBeNull();
  });

  it("resumes from startOffset for later pages", async () => {
    const { fetchRange } = fakeTable(500);

    const page = await fillVaultPage({
      fetchRange,
      matches: () => true,
      startOffset: 96,
      pageSize: 48,
    });

    expect(fetchRange).toHaveBeenCalledWith(96, 143);
    expect(page.items[0].id).toBe("it96");
    expect(page.nextOffset).toBe(144);
  });

  it("gives up after maxScan rather than walking the whole table for a rare filter", async () => {
    const { fetchRange } = fakeTable(10_000);

    const page = await fillVaultPage({
      fetchRange,
      matches: (r) => r.id === "never",
      startOffset: 0,
      pageSize: 48,
      maxScan: 96,
    });

    expect(fetchRange).toHaveBeenCalledTimes(2);
    expect(page.items).toHaveLength(0);
    // Bounded, but not a dead end — "Load more" can continue the scan.
    expect(page.nextOffset).toBe(96);
  });
});
