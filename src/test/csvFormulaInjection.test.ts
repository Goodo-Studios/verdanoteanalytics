/**
 * CSV exports cannot run formulas when opened in a spreadsheet (audit plan item 2.4).
 *
 * Ad names, campaign names and tags come from Meta and from users. A cell that starts with
 * =, +, -, @, tab or carriage return is read as a formula by Excel and Sheets, so it gets a
 * leading apostrophe. Real numbers, including negative ones, are left alone so they stay numbers.
 */
import { describe, expect, it } from "vitest";
import { escapeCsvCell } from "@/lib/csv";

describe("escapeCsvCell", () => {
  it("neutralises text that a spreadsheet would run as a formula", () => {
    expect(escapeCsvCell("=HYPERLINK(\"http://x\",\"y\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\",\"\"y\"\")\"");
    expect(escapeCsvCell("+cmd")).toBe("'+cmd");
    expect(escapeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeCsvCell("-2+3+cmd|' /C calc'!A0")).toBe("'-2+3+cmd|' /C calc'!A0");
    expect(escapeCsvCell("\tTab")).toBe("'\tTab");
    expect(escapeCsvCell("\rCR")).toBe("'\rCR");
  });

  it("leaves numbers, including negative ones, as numbers", () => {
    expect(escapeCsvCell("-12.5")).toBe("-12.5");
    expect(escapeCsvCell("0")).toBe("0");
    expect(escapeCsvCell("1e3")).toBe("1e3");
    expect(escapeCsvCell("+3")).toBe("+3");
  });

  it("still quotes commas, quotes and new lines", () => {
    expect(escapeCsvCell("a,b")).toBe("\"a,b\"");
    expect(escapeCsvCell("say \"hi\"")).toBe("\"say \"\"hi\"\"\"");
    expect(escapeCsvCell("line\nbreak")).toBe("\"line\nbreak\"");
    expect(escapeCsvCell(null as unknown as string)).toBe("");
  });
});
