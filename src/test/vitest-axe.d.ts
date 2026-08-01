// vitest-axe 0.1.0 only augments the legacy `Vi` namespace, which modern Vitest
// no longer reads — so `expect(results).toHaveNoViolations()` fails typecheck
// without this. Augment Vitest's own Assertion interfaces with the axe matchers
// (the approach vitest-axe's README documents for Vitest ≥1).
import type { AxeMatchers } from "vitest-axe/matchers";

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- interface-merging augmentation
  interface Assertion<T = unknown> extends AxeMatchers {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- interface-merging augmentation
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
