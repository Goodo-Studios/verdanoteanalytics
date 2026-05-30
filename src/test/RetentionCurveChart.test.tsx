/**
 * US-004 — Frame-retention drop-off curve chart.
 *
 * Verifies the hand-rolled inline-SVG chart:
 *   - renders a single drop-off line (an <svg> with a <path>) for a creative
 *     WITH play_curve data, plus the p25/p50/p75/p100 marks and 0→100% axis,
 *   - shows a clean empty-state (NOT a chart) for a creative WITHOUT curve data,
 *   - never fabricates a chart from a malformed / single-point curve.
 */
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RetentionCurveChart } from "@/components/creative-detail/RetentionCurveChart";

type CurveProps = Parameters<typeof RetentionCurveChart>[0]["creative"];

const withCurve: CurveProps = {
  play_curve: [100, 92, 81, 70, 58, 47, 38, 30, 22],
  retention_p25: 81,
  retention_p50: 58,
  retention_p75: 38,
  retention_p100: 22,
};

const noCurve: CurveProps = {
  play_curve: null,
  retention_p25: null,
  retention_p50: null,
  retention_p75: null,
  retention_p100: null,
};

afterEach(() => cleanup());

describe("RetentionCurveChart (US-004)", () => {
  it("renders an inline-SVG drop-off line for a creative with play_curve data", () => {
    const { container } = render(<RetentionCurveChart creative={withCurve} />);

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();

    // A single drop-off line is drawn as an SVG <path> with a real M/L geometry.
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBeGreaterThan(0);
    const linePath = Array.from(paths).find((p) => (p.getAttribute("d") ?? "").startsWith("M"));
    expect(linePath).toBeTruthy();
    expect(linePath!.getAttribute("d")).toContain("L");

    // Empty-state must NOT be present when there is data.
    expect(screen.queryByTestId("retention-curve-empty")).toBeNull();
  });

  it("labels the playback-progress axis 0 → 100% and the p25/p50/p75/p100 marks", () => {
    const { container } = render(<RetentionCurveChart creative={withCurve} />);
    const text = container.textContent ?? "";
    // X-axis progress labels.
    expect(text).toContain("0%");
    expect(text).toContain("100%");
    // Threshold completion marks.
    expect(text).toContain("p25");
    expect(text).toContain("p50");
    expect(text).toContain("p75");
    expect(text).toContain("p100");
  });

  it("shows a clear empty-state (not a chart) when play_curve is null", () => {
    const { container } = render(<RetentionCurveChart creative={noCurve} />);
    expect(screen.getByTestId("retention-curve-empty")).toBeInTheDocument();
    expect(
      screen.getByText(/No retention curve — backfill pending or non-video/i),
    ).toBeInTheDocument();
    // No SVG chart rendered.
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders the empty-state for an empty or single-point curve rather than a degenerate chart", () => {
    for (const bad of [[], [100]]) {
      const { container, unmount } = render(
        <RetentionCurveChart creative={{ ...noCurve, play_curve: bad }} />,
      );
      expect(screen.getByTestId("retention-curve-empty")).toBeInTheDocument();
      expect(container.querySelector("svg")).toBeNull();
      unmount();
    }
  });
});
