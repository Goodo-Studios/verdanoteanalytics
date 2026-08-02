import "@testing-library/jest-dom";
import { configureAxe } from "vitest-axe";
// Import from dist directly: the package's "vitest-axe/matchers" typings are
// `export type *` (types-only), so the value import fails typecheck there even
// though it works at runtime. The dist typings export the real value.
import { toHaveNoViolations } from "vitest-axe/dist/matchers";
import { expect } from "vitest";

expect.extend({ toHaveNoViolations });

// jsdom exposes window.localStorage but the global `localStorage` reference
// (used by app code that runs in a real browser) is occasionally undefined in
// this environment. Provide an in-memory shim so tests exercise the real code
// paths (e.g. agency-home preference read) instead of throwing.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
  };
  Object.defineProperty(globalThis, "localStorage", { value: shim, configurable: true });
}

// Recharts sizes itself from its container via ResizeObserver + element box
// metrics. jsdom implements neither (every box is 0×0 and ResizeObserver is
// absent), so charts would mount with zero width and render nothing. Give the
// test environment a fixed, non-zero viewport so chart assertions exercise real
// SVG output rather than an empty container.
const TEST_CHART_WIDTH = 800;
const TEST_CHART_HEIGHT = 400;

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverShim implements ResizeObserver {
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      const contentRect = {
        width: TEST_CHART_WIDTH,
        height: TEST_CHART_HEIGHT,
        top: 0,
        left: 0,
        bottom: TEST_CHART_HEIGHT,
        right: TEST_CHART_WIDTH,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRectReadOnly;
      this.callback([{ target, contentRect } as ResizeObserverEntry], this);
    }
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", {
    value: ResizeObserverShim,
    configurable: true,
  });
}

for (const [prop, value] of [
  ["offsetWidth", TEST_CHART_WIDTH],
  ["offsetHeight", TEST_CHART_HEIGHT],
  ["clientWidth", TEST_CHART_WIDTH],
  ["clientHeight", TEST_CHART_HEIGHT],
] as const) {
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get() {
      return value;
    },
  });
}

export const axe = configureAxe({
  rules: {
    // region rule fires in jsdom but is a false positive outside a full browser page
    region: { enabled: false },
  },
});
