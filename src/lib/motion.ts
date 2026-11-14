// Small motion (OS-025). The class names and timings that go with src/styles/goodo-os-motion.css.
// The timings are the War Room ones in goodo-os-tokens.css; these numbers only mirror them for code
// that has to know a duration. Motion never delays a state update: the new state is drawn first and
// the CSS animates from there.
import { useEffect, useMemo, useRef, useState } from "react";

export const MOTION = {
  bar: "gos-bar-fill",
  press: "gos-press",
  settle: "gos-settle",
  check: "gos-check",
  pulse: "gos-pulse-slow",
} as const;

/** Durations in ms, matching the CSS variables. */
export const MOTION_MS = {
  bar: 600, // --gos-dur-bar
  panel: 320, // --gos-dur-slow
} as const;

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** True while the person has asked for reduced motion. Follows changes to the setting. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(REDUCED_MOTION_QUERY);
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/**
 * Ids whose value changed since the last list this hook saw, for example a card whose status moved.
 * The first list marks nothing. The caller adds MOTION.settle to those ids; the change itself is
 * already drawn, the class only animates it into place.
 */
export function useChangedIds<T>(items: readonly T[] | undefined, id: (t: T) => string, value: (t: T) => unknown): ReadonlySet<string> {
  const seen = useRef<Map<string, unknown> | null>(null);
  const changed = useMemo(() => {
    const out = new Set<string>();
    const prev = seen.current;
    if (!prev || !items) return out;
    for (const t of items) {
      const k = id(t);
      if (prev.has(k) && prev.get(k) !== value(t)) out.add(k);
    }
    return out;
    // id and value are read fresh each list; only a new list should recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
  useEffect(() => {
    if (!items) return;
    seen.current = new Map(items.map((t) => [id(t), value(t)]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
  return changed;
}
