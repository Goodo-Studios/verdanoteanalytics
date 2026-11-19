/**
 * The Vault item page reads the first transcript and framework of each item (audit plan item 4.3).
 * The lists came back in no set order, so with more than one row the page showed whichever came
 * first. The database now keeps one row per item, and the page also sorts newest first.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { embeddedRows, firstEmbedded, newestFirst } from "@/features/vault/newestFirst";

describe("newestFirst", () => {
  it("puts the newest row first and undated rows last", () => {
    const rows = [
      { id: "old", created_at: "2026-01-01T00:00:00Z" },
      { id: "none", created_at: null },
      { id: "new", created_at: "2026-06-01T00:00:00Z" },
    ];
    expect(newestFirst(rows).map((r) => r.id)).toEqual(["new", "old", "none"]);
  });

  it("handles a missing list", () => {
    expect(newestFirst(undefined)).toEqual([]);
    expect(newestFirst(null)).toEqual([]);
  });

  // Regression: one transcript and one framework per item (unique key on item_id) makes the API
  // send each embedded relation as a single object. Spreading it threw "not iterable", so every
  // saved item opened as "Item not found".
  it("accepts the single object the API sends for a one-to-one embed", () => {
    const row = { id: "only", created_at: "2026-06-01T00:00:00Z" };
    expect(newestFirst(row)).toEqual([row]);
  });
});

describe("embeddedRows / firstEmbedded", () => {
  it("turns a list, an object or nothing into a list", () => {
    expect(embeddedRows([{ a: 1 }, { a: 2 }])).toEqual([{ a: 1 }, { a: 2 }]);
    expect(embeddedRows({ a: 1 })).toEqual([{ a: 1 }]);
    expect(embeddedRows(null)).toEqual([]);
    expect(embeddedRows(undefined)).toEqual([]);
  });

  it("returns the newest row, or null when there is none", () => {
    expect(firstEmbedded({ id: "x", created_at: "2026-06-01T00:00:00Z" })?.id).toBe("x");
    expect(firstEmbedded(null)).toBeNull();
  });
});

describe("Vault readers of embedded transcripts and frameworks", () => {
  it.each(["LibraryPage", "BoardDetailPage", "HooksPage"])("%s reads them through embeddedRows", (file) => {
    const src = readFileSync(join(process.cwd(), `src/features/vault/${file}.tsx`), "utf8");
    expect(src).toContain("embeddedRows(");
    expect(src).not.toMatch(/inspiration_(transcripts|frameworks)\?\.\[0\]/);
  });
});

describe("Vault item page", () => {
  const page = readFileSync(join(process.cwd(), "src/features/vault/ItemDetailPage.tsx"), "utf8");
  it.each(["inspiration_transcripts", "inspiration_frameworks"])("sorts %s newest first", (table) => {
    expect(page).toContain(`row.${table} = newestFirst(row.${table})`);
  });
});
