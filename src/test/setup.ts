import "@testing-library/jest-dom";
import { configureAxe } from "vitest-axe";
import { toHaveNoViolations } from "vitest-axe/matchers";
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

export const axe = configureAxe({
  rules: {
    // region rule fires in jsdom but is a false positive outside a full browser page
    region: { enabled: false },
  },
});
