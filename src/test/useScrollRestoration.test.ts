// Regression coverage for useScrollRestoration (src/hooks/useScrollRestoration.ts).
//
// Root bug: the Vault library grid lives inside the app's shared
// `<main id="app-scroll-container" class="overflow-auto">` (AppLayout.tsx), not
// the window. Opening a creative card is a route change to /ad-library/:id,
// which unmounts the grid; its content shrinking clamps the container's
// scrollTop to 0, and nothing restored it on the way back — so returning to
// the vault always looked like the page had "refreshed" back to the top, even
// though no hard navigation occurred. This hook saves the container's
// scrollTop (keyed by page) on scroll/unmount and restores it once the page's
// real content is ready.
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useScrollRestoration } from "../hooks/useScrollRestoration";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("useScrollRestoration", () => {
  let container: HTMLElement;

  beforeEach(() => {
    sessionStorage.clear();
    container = document.createElement("main");
    container.id = "app-scroll-container";
    // jsdom doesn't lay out real scrollable content — scrollTop is a plain
    // writable property on the element, which is all the hook depends on.
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("does nothing if the scroll container isn't in the DOM", () => {
    container.remove();
    expect(() => renderHook(() => useScrollRestoration("missing-container"))).not.toThrow();
  });

  it("saves scrollTop on scroll (debounced) and restores it on next mount", async () => {
    const { unmount } = renderHook(() => useScrollRestoration("vault-library", true));

    container.scrollTop = 240;
    act(() => {
      container.dispatchEvent(new Event("scroll"));
    });
    await sleep(50); // let the rAF-debounced save flush

    expect(Number(sessionStorage.getItem("scroll:vault-library"))).toBe(240);

    unmount();
    container.scrollTop = 0; // simulate the container remounting fresh (content shrank)

    renderHook(() => useScrollRestoration("vault-library", true));
    await sleep(50); // let the restore rAF flush

    expect(container.scrollTop).toBe(240);
  });

  it("does not restore until ready is true — avoids scrolling to the wrong offset before content loads", async () => {
    sessionStorage.setItem("scroll:vault-library", "500");

    const { rerender } = renderHook(({ ready }) => useScrollRestoration("vault-library", ready), {
      initialProps: { ready: false },
    });
    await sleep(50);
    expect(container.scrollTop).toBe(0);

    rerender({ ready: true });
    await sleep(50);
    expect(container.scrollTop).toBe(500);
  });

  it("saves the final position on unmount even without an intervening scroll event", async () => {
    const { unmount } = renderHook(() => useScrollRestoration("vault-library", true));
    container.scrollTop = 77;
    unmount();

    expect(Number(sessionStorage.getItem("scroll:vault-library"))).toBe(77);
  });

  it("keys storage per page so unrelated pages don't clobber each other's position", async () => {
    const a = renderHook(() => useScrollRestoration("vault-library", true));
    container.scrollTop = 10;
    a.unmount();

    const b = renderHook(() => useScrollRestoration("creatives-page", true));
    container.scrollTop = 90;
    b.unmount();

    expect(Number(sessionStorage.getItem("scroll:vault-library"))).toBe(10);
    expect(Number(sessionStorage.getItem("scroll:creatives-page"))).toBe(90);
  });
});
