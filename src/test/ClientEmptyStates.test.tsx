/**
 * Shared client empty-state coverage.
 *
 * The bespoke Client Home sections (Outcomes / Winners / Highlights) were retired
 * when the client hub superseded the single-page Client Home (#25/#29), so their
 * empty-state tests went with them. What remains here is coverage for the pieces
 * that are STILL live and shared by the hub:
 *   - `ClientEmptyState` — the shared, branded onboarding component every empty
 *     surface renders (never `return null` / a hidden section).
 *   - `ContentPipelineView` — the read-only content pipeline, which still renders
 *     a friendly "nothing in production" onboarding state via `ClientEmptyState`.
 */
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sparkles } from "lucide-react";

import { ClientEmptyState } from "@/components/client/ClientEmptyState";
import { ContentPipelineView } from "@/components/client/ContentPipeline";

// useCachedMedia touches IndexedDB; in jsdom we just echo the url back.
vi.mock("@/hooks/useCachedMedia", () => ({
  useCachedMedia: (url: string | null | undefined) => ({
    url: url ?? "/placeholder-creative.png",
    isLoading: false,
    error: null,
    retry: () => {},
  }),
}));

afterEach(() => cleanup());

describe("ClientEmptyState (shared component)", () => {
  it("is a real, rendered, brand-consistent component — icon + heading + subcopy", () => {
    const { container } = render(
      <ClientEmptyState
        icon={Sparkles}
        heading="Heading goes here"
        subcopy="Reassuring subcopy."
      />,
    );

    const root = screen.getByTestId("client-empty-state");
    expect(root).toBeInTheDocument();
    expect(screen.getByText("Heading goes here")).toBeInTheDocument();
    expect(screen.getByText("Reassuring subcopy.")).toBeInTheDocument();
    // Brand tokens / card surface — not a bare/hidden node.
    expect(root.className).toMatch(/bg-card/);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

describe("Content pipeline empty state", () => {
  it("nothing in flight shows 'Nothing in production right now — your strategist will queue the next round'", () => {
    render(<ContentPipelineView tasks={[]} isLoading={false} isError={false} />);
    expect(screen.getByTestId("client-empty-state")).toBeInTheDocument();
    expect(
      screen.getByText(/Nothing in production right now — your strategist will queue the next round/i),
    ).toBeInTheDocument();
  });
});
