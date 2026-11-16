/**
 * Vault item page: editable text never overwrites the real transcript or analysis
 * (audit plan item 4.2).
 *
 * The page set its text drafts once and saved on blur whenever the draft differed from the server.
 * Opening an item while it was still processing and clicking in and out of a field saved an empty
 * transcript over the real one; after a re-analyze, a blur wrote the old text back; and the drafts
 * carried over to the next item. useServerDraft follows the server while the field is not being
 * edited, saves on blur only when the user typed, and resets when the item changes.
 */
import { act, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { useServerDraft } from "@/features/vault/hooks/useServerDraft";

type Props = { server: string | null; item: string };
const setup = (initial: Props) =>
  renderHook(({ server, item }: Props) => useServerDraft(server, item), { initialProps: initial });

describe("useServerDraft", () => {
  it("follows the server while the field is not being edited (processing finishes)", () => {
    const { result, rerender } = setup({ server: null, item: "a" });
    expect(result.current.value).toBe("");
    rerender({ server: "real transcript", item: "a" });
    expect(result.current.value).toBe("real transcript");
  });

  it("clicking in and out without typing never saves, even if the field was empty at first", () => {
    const save = vi.fn();
    const { result, rerender } = setup({ server: null, item: "a" });
    act(() => result.current.onFocus());
    rerender({ server: "real transcript", item: "a" });
    act(() => result.current.onBlur(save));
    expect(save).not.toHaveBeenCalled();
    expect(result.current.value).toBe("real transcript");
  });

  it("saves what the user typed on blur", () => {
    const save = vi.fn();
    const { result } = setup({ server: "old", item: "a" });
    act(() => result.current.onFocus());
    act(() => result.current.onChange("edited"));
    act(() => result.current.onBlur(save));
    expect(save).toHaveBeenCalledWith("edited");
  });

  it("does not save when the user typed and then restored the server text", () => {
    const save = vi.fn();
    const { result } = setup({ server: "same", item: "a" });
    act(() => result.current.onFocus());
    act(() => result.current.onChange("same!"));
    act(() => result.current.onChange("same"));
    act(() => result.current.onBlur(save));
    expect(save).not.toHaveBeenCalled();
  });

  it("after a re-analyze the new text shows, and a blur does not write the old text back", () => {
    const save = vi.fn();
    const { result, rerender } = setup({ server: "first analysis", item: "a" });
    rerender({ server: "second analysis", item: "a" });
    expect(result.current.value).toBe("second analysis");
    act(() => result.current.onFocus());
    act(() => result.current.onBlur(save));
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps what the user is typing if the server changes mid-edit", () => {
    const { result, rerender } = setup({ server: "v1", item: "a" });
    act(() => result.current.onFocus());
    act(() => result.current.onChange("my edit"));
    rerender({ server: "v2", item: "a" });
    expect(result.current.value).toBe("my edit");
  });

  it("resets to the new item's text when moving to another item", () => {
    const save = vi.fn();
    const { result, rerender } = setup({ server: "item A text", item: "a" });
    act(() => result.current.onFocus());
    act(() => result.current.onChange("unsaved A edit"));
    rerender({ server: "item B text", item: "b" });
    expect(result.current.value).toBe("item B text");
    act(() => result.current.onBlur(save));
    expect(save).not.toHaveBeenCalled();
  });
});

describe("item page wiring", () => {
  const page = readFileSync(join(process.cwd(), "src/features/vault/ItemDetailPage.tsx"), "utf8");
  it("uses useServerDraft for the three editable fields and no one-time initialisation", () => {
    expect(page.match(/useServerDraft\(/g)?.length).toBe(3);
    expect(page).not.toMatch(/hasInitialized/);
  });
});
