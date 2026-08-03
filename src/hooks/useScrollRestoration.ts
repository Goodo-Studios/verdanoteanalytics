import { useEffect, useRef } from "react";

/**
 * Restores and continuously saves the scroll position of the app's shared
 * `<main id="app-scroll-container">` (see AppLayout.tsx) across route
 * unmount/remount.
 *
 * Why this is needed: `<main>` uses `overflow-auto` (not the window), and
 * browser-native scroll restoration only ever restores `window` scroll — it
 * never touches an arbitrary internal scroll container. Worse, when a list
 * page (e.g. the Vault library grid) unmounts to navigate into a detail
 * route, the container's content shrinks, which clamps its `scrollTop` to 0;
 * nothing restores it when the list re-mounts, so returning to the page
 * always looks like it "reset" even though no hard page reload occurred.
 *
 * `ready` gates the restore until the page's real content has rendered
 * (e.g. after its data has loaded) — restoring against an empty/loading
 * placeholder would just scroll to the wrong offset once content arrives.
 *
 * The save/listen effect and the restore effect are deliberately SEPARATE.
 * `ready` flips false→true on every normal page load (once data finishes
 * loading) — if the listener effect depended on `ready`, that transition
 * would re-run its cleanup first, saving the current (still-zero,
 * nothing-scrolled-yet) position and clobbering the value this hook is
 * trying to restore, before the restore ever got a chance to read it. Only
 * a real unmount (leaving the page) should trigger the save-on-cleanup path.
 */
export function useScrollRestoration(key: string, ready = true) {
  const storageKey = `scroll:${key}`;
  const restoredRef = useRef(false);

  // Save on scroll + on real unmount. Deliberately NOT keyed by `ready`.
  useEffect(() => {
    const container = document.getElementById("app-scroll-container");
    if (!container) return;

    let raf: number | null = null;
    const onScroll = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        sessionStorage.setItem(storageKey, String(container.scrollTop));
      });
    };
    container.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      container.removeEventListener("scroll", onScroll);
      if (raf !== null) cancelAnimationFrame(raf);
      // Save the final position on unmount too — a scroll immediately
      // followed by navigating away can otherwise race the debounced save.
      sessionStorage.setItem(storageKey, String(container.scrollTop));
    };
  }, [storageKey]);

  // Restore once, the first time `ready` is true.
  useEffect(() => {
    if (!ready || restoredRef.current) return;
    const container = document.getElementById("app-scroll-container");
    if (!container) return;
    restoredRef.current = true;

    const saved = sessionStorage.getItem(storageKey);
    if (!saved) return;
    const y = Number(saved);
    if (!Number.isFinite(y)) return;
    // Wait a frame so the just-rendered content has real height to scroll
    // into before we set scrollTop.
    requestAnimationFrame(() => {
      container.scrollTop = y;
    });
  }, [storageKey, ready]);
}
