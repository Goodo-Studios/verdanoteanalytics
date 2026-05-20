import "@testing-library/jest-dom";
import { configureAxe } from "vitest-axe";
import { toHaveNoViolations } from "vitest-axe/matchers";
import { expect } from "vitest";

expect.extend({ toHaveNoViolations });

export const axe = configureAxe({
  rules: {
    // region rule fires in jsdom but is a false positive outside a full browser page
    region: { enabled: false },
  },
});
