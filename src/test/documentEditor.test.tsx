/**
 * The document editor (src/features/knowledge/DocumentEditor.tsx) and its markdown helpers
 * (src/lib/markdownEdit.ts): toolbar buttons write markdown around the selection, Preview shows
 * the result, Save sends the text, a refused link address is explained.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocumentEditor } from "@/features/knowledge/DocumentEditor";
import { insertLink, normalizeUrl, setHeading, toggleBullets, wrapSelection } from "@/lib/markdownEdit";

function setup(initial = "Hello world", onSave = vi.fn(async () => null as string | null)) {
  const onCancel = vi.fn();
  render(<DocumentEditor initialText={initial} onSave={onSave} onCancel={onCancel} />);
  const area = screen.getByLabelText("Document text") as HTMLTextAreaElement;
  const select = (start: number, end: number) => { area.focus(); area.setSelectionRange(start, end); };
  return { area, select, onSave, onCancel };
}

describe("DocumentEditor", () => {
  it("bold and italic wrap the selection, and bold again unwraps it", () => {
    const { area, select } = setup("Hello world");
    select(6, 11);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(area.value).toBe("Hello **world**");
    expect(area.selectionStart).toBe(8);
    expect(area.selectionEnd).toBe(13);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(area.value).toBe("Hello world");
    select(0, 5);
    fireEvent.click(screen.getByRole("button", { name: "Italic" }));
    expect(area.value).toBe("_Hello_ world");
  });

  it("heading, subheading and bullet list work on the selected lines", () => {
    const { area, select } = setup("Title\nfirst\nsecond");
    select(0, 0);
    fireEvent.click(screen.getByRole("button", { name: "Heading" }));
    expect(area.value).toBe("# Title\nfirst\nsecond");
    select(8, 18);
    fireEvent.click(screen.getByRole("button", { name: "Bullet list" }));
    expect(area.value).toBe("# Title\n- first\n- second");
    fireEvent.click(screen.getByRole("button", { name: "Bullet list" }));
    expect(area.value).toBe("# Title\nfirst\nsecond");
    select(0, 0);
    fireEvent.click(screen.getByRole("button", { name: "Subheading" }));
    expect(area.value).toBe("## Title\nfirst\nsecond");
  });

  it("adds a link around the selection, and explains an address it cannot use", () => {
    const { area, select } = setup("See the docs now");
    select(8, 12);
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    fireEvent.change(screen.getByLabelText("Link address"), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a web address");
    expect(area.value).toBe("See the docs now");
    fireEvent.change(screen.getByLabelText("Link address"), { target: { value: "example.com/docs" } });
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    expect(area.value).toBe("See the [docs](https://example.com/docs) now");
    expect(screen.queryByLabelText("Link address")).toBeNull();
  });

  it("Preview shows formatted text, links included, and the toolbar waits until you go back to Write", () => {
    setup("# Heading\n\n- one\n- two\n\n**bold** [a link](https://example.test)");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const preview = screen.getByTestId("document-editor-preview");
    expect(within(preview).getByRole("heading", { name: "Heading" })).toBeTruthy();
    expect(preview.querySelectorAll("li")).toHaveLength(2);
    expect(preview.querySelector("strong")?.textContent).toBe("bold");
    expect(within(preview).getByRole("link", { name: "a link" })).toHaveProperty("href", "https://example.test/");
    expect(screen.getByRole("button", { name: "Bold" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Write" }));
    expect(screen.getByLabelText("Document text")).toHaveProperty("value", expect.stringContaining("# Heading"));
  });

  it("Save sends the text only when something changed and the text is not empty; a failure is shown", async () => {
    const onSave = vi.fn(async () => "It did not save.");
    const { area } = setup("Hello", onSave);
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.change(area, { target: { value: "   " } });
    expect(save).toBeDisabled();
    fireEvent.change(area, { target: { value: "Hello again" } });
    fireEvent.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Hello again"));
    expect(await screen.findByRole("alert")).toHaveTextContent("It did not save.");
  });

  it("Cancel calls onCancel", () => {
    const { onCancel, onSave } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("markdownEdit", () => {
  it("wrapSelection inserts a placeholder when nothing is selected and unwraps a selection that includes its marks", () => {
    expect(wrapSelection("ab", 1, 1, "**", "bold text")).toEqual({ text: "a**bold text**b", start: 3, end: 12 });
    expect(wrapSelection("a **b** c", 2, 7, "**", "x")).toEqual({ text: "a b c", start: 2, end: 3 });
  });

  it("setHeading replaces an existing level and toggles off the same level", () => {
    expect(setHeading("### Old", 0, 0, 1).text).toBe("# Old");
    expect(setHeading("# Same", 0, 0, 1).text).toBe("Same");
    expect(setHeading("a\nb", 0, 3, 2).text).toBe("## a\n## b");
  });

  it("toggleBullets leaves blank lines alone and does not double a bullet", () => {
    expect(toggleBullets("a\n\nb", 0, 4).text).toBe("- a\n\n- b");
    expect(toggleBullets("- a\nb", 0, 5).text).toBe("- a\n- b");
    expect(toggleBullets("* a\n- b", 0, 7).text).toBe("a\nb");
  });

  it("normalizeUrl keeps safe schemes, adds https and refuses the rest", () => {
    expect(normalizeUrl("https://a.test")).toBe("https://a.test");
    expect(normalizeUrl("mailto:me@a.test")).toBe("mailto:me@a.test");
    expect(normalizeUrl("#brain/playbooks/x")).toBe("#brain/playbooks/x");
    expect(normalizeUrl("a.test/x")).toBe("https://a.test/x");
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("data:text/html,x")).toBeNull();
    expect(normalizeUrl("two words")).toBeNull();
    expect(normalizeUrl("  ")).toBeNull();
  });

  it("insertLink uses the address as the text when nothing is selected", () => {
    expect(insertLink("x", 1, 1, "a.test")).toEqual({ text: "x[https://a.test](https://a.test)", start: 1, end: 33 });
    expect(insertLink("x", 0, 1, "nope nope")).toBeNull();
  });
});
