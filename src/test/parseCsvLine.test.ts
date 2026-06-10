import { describe, it, expect } from "vitest";
import { parseCsvLine } from "@/lib/csv";

// Regression tests for the TaggingPage CSV-upload parser (moved to src/lib/csv.ts).
// The original inline implementation left quote handling broken: boundary quotes
// leaked into values and RFC 4180 escaped quotes ("") collapsed to nothing.
describe("parseCsvLine", () => {
  it("parses plain unquoted fields", () => {
    expect(parseCsvLine("UniqueCode,Type,Person")).toEqual(["UniqueCode", "Type", "Person"]);
  });

  it("strips boundary quotes from a quoted field containing a comma", () => {
    expect(parseCsvLine('AB123,"Style, Modern",Hook1')).toEqual(["AB123", "Style, Modern", "Hook1"]);
  });

  it("does not keep quote characters in quoted values", () => {
    // Regression: previously '"Style, Modern"' parsed to '"Style, Modern"' (quotes retained)
    expect(parseCsvLine('"Style, Modern"')).toEqual(["Style, Modern"]);
  });

  it('treats escaped quotes ("") inside a quoted field as a literal quote', () => {
    expect(parseCsvLine('"He said ""hi""",b')).toEqual(['He said "hi"', "b"]);
  });

  it("handles a field that is only an escaped quote", () => {
    expect(parseCsvLine('""""')).toEqual(['"']);
  });

  it("handles empty fields", () => {
    expect(parseCsvLine("a,,c,")).toEqual(["a", "", "c", ""]);
  });

  it("handles an empty quoted field", () => {
    expect(parseCsvLine('a,"",c')).toEqual(["a", "", "c"]);
  });

  it("round-trips values escaped by downloadCSV's escape convention", () => {
    // downloadCSV (same module) escapes with "" — the parser must invert it.
    expect(parseCsvLine('"Style, ""Bold"", Modern",plain')).toEqual(['Style, "Bold", Modern', "plain"]);
  });
});
