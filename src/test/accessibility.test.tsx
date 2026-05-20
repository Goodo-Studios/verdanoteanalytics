/**
 * Accessibility baseline tests using axe-core.
 * These catch WCAG violations early — missing labels, low contrast, bad ARIA.
 * Add a test here for every new component that renders standalone UI.
 */
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { axe } from "./setup";
import { GradeBadge } from "@/components/creatives/GradeBadge";
import { TagSourceBadge } from "@/components/TagSourceBadge";

describe("Accessibility — GradeBadge", () => {
  const grades = ["A", "B", "C", "D", "F"] as const;

  it.each(grades)("grade %s has no axe violations", async (grade) => {
    const { container } = render(<GradeBadge grade={grade} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe("Accessibility — TagSourceBadge", () => {
  const sources = ["parsed", "csv_match", "manual", "inferred", "untagged"];

  it.each(sources)("source %s has no axe violations", async (source) => {
    const { container } = render(<TagSourceBadge source={source} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
