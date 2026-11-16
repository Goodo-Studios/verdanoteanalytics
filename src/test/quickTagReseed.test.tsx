// Audit Batch 9 (lint, react-hooks/exhaustive-deps): QuickTagMode seeded its form from the
// current creative only when the index or ad_id changed. When the same creative's stored tags
// changed while it was on screen (a sync, a CSV import, another teammate's save arriving through
// the query cache), the form kept the old values and "Save & Next" wrote them back over the new
// ones.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuickTagMode } from "@/components/tagging/QuickTagMode";

vi.mock("@/hooks/useCreatives", () => ({
  useUpdateCreative: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

const base = { ad_id: "ad-1", ad_name: "Ad one", ad_type: null, person: null, style: null, product: null, theme: null };

describe("QuickTagMode re-seeds when the creative's stored tags change", () => {
  it("shows the new hook after the same creative is refreshed", () => {
    const { rerender } = render(
      <QuickTagMode creatives={[{ ...base, hook: "old hook" }]} onExit={() => {}} />,
    );
    expect(screen.getByLabelText("Hook")).toHaveValue("old hook");

    rerender(<QuickTagMode creatives={[{ ...base, hook: "new hook" }]} onExit={() => {}} />);
    expect(screen.getByLabelText("Hook")).toHaveValue("new hook");
  });

  it("keeps an unsaved edit when a refresh brings the same stored values", () => {
    const creative = { ...base, hook: "stored" };
    const { rerender } = render(<QuickTagMode creatives={[creative]} onExit={() => {}} />);
    const input = screen.getByLabelText("Hook") as HTMLInputElement;
    input.focus();
    // Simulate typing through React's change handler.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "typed");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(input).toHaveValue("typed");

    rerender(<QuickTagMode creatives={[{ ...creative }]} onExit={() => {}} />);
    expect(screen.getByLabelText("Hook")).toHaveValue("typed");
  });
});
