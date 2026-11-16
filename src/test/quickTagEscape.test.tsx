/**
 * Quick Tag and the Escape key (audit plan item 5.10, part 4).
 *
 * Escape closed Quick Tag even while typing in a free-text tag field, so a half-typed
 * hook or theme was lost. Now Escape in a field only leaves the field; Escape elsewhere
 * still closes Quick Tag.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/hooks/useCreatives", () => ({ useUpdateCreative: () => ({ mutate: vi.fn() }) }));

import { QuickTagMode } from "@/components/tagging/QuickTagMode";

const creative = { ad_id: "1", ad_name: "GS1_Video_Test", tag_source: "untagged" };

describe("Quick Tag Escape", () => {
  it("Escape while typing in a tag field does not close Quick Tag", () => {
    const onExit = vi.fn();
    const { container } = render(<QuickTagMode creatives={[creative]} onExit={onExit} />);
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input).not.toBeNull();
    input.focus();
    fireEvent.change(input, { target: { value: "half typed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onExit).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(input);
  });

  it("Escape outside a field still closes Quick Tag", () => {
    const onExit = vi.fn();
    render(<QuickTagMode creatives={[creative]} onExit={onExit} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByRole("textbox").length).toBeGreaterThan(0);
  });
});
