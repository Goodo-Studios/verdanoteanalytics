import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useLatestRequest } from "@/hooks/useLatestRequest";
import { useBusy } from "@/hooks/useBusy";

describe("useLatestRequest", () => {
  it("only the most recent request is current", () => {
    const { result } = renderHook(() => useLatestRequest());
    const first = result.current.begin();
    const second = result.current.begin();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it("invalidate makes an in-flight request stale", () => {
    const { result } = renderHook(() => useLatestRequest());
    const check = result.current.begin();
    result.current.invalidate();
    expect(check()).toBe(false);
  });

  it("is stale after unmount", () => {
    const { result, unmount } = renderHook(() => useLatestRequest());
    const check = result.current.begin();
    unmount();
    expect(check()).toBe(false);
  });
});

describe("useBusy", () => {
  it("ignores a second run while the first is pending", async () => {
    const { result } = renderHook(() => useBusy());
    let release!: () => void;
    let calls = 0;
    const slow = () => {
      calls += 1;
      return new Promise<string>((resolve) => {
        release = () => resolve("done");
      });
    };
    let first!: Promise<string | undefined>;
    let second!: Promise<string | undefined>;
    await act(async () => {
      first = result.current.run(slow);
      second = result.current.run(slow);
    });
    expect(calls).toBe(1);
    expect(result.current.busy).toBe(true);
    await act(async () => {
      release();
      await first;
    });
    expect(await second).toBeUndefined();
    expect(result.current.busy).toBe(false);
    await act(async () => {
      await result.current.run(async () => "again");
    });
  });

  it("clears busy when the action throws", async () => {
    const { result } = renderHook(() => useBusy());
    await act(async () => {
      await result.current.run(async () => {
        throw new Error("boom");
      }).catch(() => undefined);
    });
    expect(result.current.busy).toBe(false);
  });
});

describe("useLatestRequest identity", () => {
  it("returns the same object on every render so it can sit in a dependency list", () => {
    const { result, rerender } = renderHook(() => useLatestRequest());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
