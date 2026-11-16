/**
 * Settings and Tagging CSV uploads (audit plan item 5.9, part 1: the browser parser).
 *
 * Settings split each line on commas, so a quoted value with a comma shifted every
 * later column. Both pages split the file on "\n", so a line break inside a quoted
 * value broke the row in two. Both now use one whole-file parser that also checks
 * every row before anything is sent.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as csv from "@/lib/csv";

const HEADER = "UniqueCode,Type,Person,Style,Product,Hook,Theme";

describe("parseCsv (whole file)", () => {
  it("keeps a quoted comma inside one value", () => {
    expect(csv.parseCsv(`a,"b, c",d`)).toEqual([["a", "b, c", "d"]]);
  });

  it("keeps a line break inside a quoted value in one row", () => {
    expect(csv.parseCsv(`a,"line one\nline two",c\nx,y,z`)).toEqual([
      ["a", "line one\nline two", "c"],
      ["x", "y", "z"],
    ]);
  });

  it("handles Windows line endings, a byte-order mark and blank lines", () => {
    expect(csv.parseCsv(`\uFEFFa,b\r\n\r\nc,d\r\n`)).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("reads escaped quotes", () => {
    expect(csv.parseCsv(`"He said ""hi""",b`)).toEqual([['He said "hi"', "b"]]);
  });
});

describe("parseTagMappingsCsv", () => {
  it("maps rows by header, including a quoted comma", () => {
    const out = csv.parseTagMappingsCsv(`${HEADER}\nGS1,Video,Creator,UGC,"Socks, wool",Hook A,Cozy`);
    expect(out.fatal).toBeNull();
    expect(out.errors).toEqual([]);
    expect(out.rows).toEqual([
      { UniqueCode: "GS1", Type: "Video", Person: "Creator", Style: "UGC", Product: "Socks, wool", Hook: "Hook A", Theme: "Cozy" },
    ]);
  });

  it("reports missing columns as a file error", () => {
    const out = csv.parseTagMappingsCsv("UniqueCode,Type\nGS1,Video");
    expect(out.fatal).toMatch(/Missing columns: Person, Style, Product, Hook, Theme/);
    expect(out.rows).toEqual([]);
  });

  it("reports row errors with their line numbers", () => {
    const out = csv.parseTagMappingsCsv(
      `${HEADER}\n,Video,Creator,UGC,P,H,T\nGS2,Video,Creator,UGC,P,H\nGS3,Video,Creator,UGC,P,H,T\nGS3,Image,Creator,UGC,P,H,T`,
    );
    expect(out.errors).toEqual([
      { line: 2, message: "UniqueCode is empty" },
      { line: 3, message: "Expected 7 values, found 6" },
      { line: 5, message: "UniqueCode GS3 appears more than once (first on line 4)" },
    ]);
  });

  it("needs at least one data row", () => {
    expect(csv.parseTagMappingsCsv(HEADER).fatal).toMatch(/at least one row/);
  });
});

describe("both upload screens use the shared parser", () => {
  const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");
  it("Settings and Tagging", () => {
    for (const file of ["../hooks/useSettingsPageState.ts", "../pages/TaggingPage.tsx"]) {
      const src = read(file);
      expect(src, file).toContain("parseTagMappingsCsv(");
      expect(src, file).not.toMatch(/\.split\("\\n"\)/);
    }
  });
});
