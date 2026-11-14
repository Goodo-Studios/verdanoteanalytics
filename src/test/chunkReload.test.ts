import { describe, it, expect, vi } from "vitest";
import { isChunkLoadError, reloadOnceForNewBuild } from "@/lib/chunkReload";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("isChunkLoadError", () => {
  it("recognises the browser messages for a missing chunk", () => {
    expect(isChunkLoadError(new Error("Failed to fetch dynamically imported module: https://x/assets/a.js"))).toBe(true);
    expect(isChunkLoadError(new Error("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new Error("Importing a module script failed."))).toBe(true);
  });
  it("ignores other errors", () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe("reloadOnceForNewBuild", () => {
  it("reloads the first time and not again within 30 seconds", () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    expect(reloadOnceForNewBuild(storage, reload, 1_000_000)).toBe(true);
    expect(reloadOnceForNewBuild(storage, reload, 1_010_000)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("reloads again after the window has passed", () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    reloadOnceForNewBuild(storage, reload, 1_000_000);
    expect(reloadOnceForNewBuild(storage, reload, 1_040_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
