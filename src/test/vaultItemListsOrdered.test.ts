/**
 * The Vault item page reads the first transcript and framework of each item (audit plan item 4.3).
 * The lists came back in no set order, so with more than one row the page showed whichever came
 * first. The database now keeps one row per item, and the page also sorts newest first.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newestFirst } from "@/features/vault/newestFirst";

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
  });
});

describe("Vault item page", () => {
  const page = readFileSync(join(process.cwd(), "src/features/vault/ItemDetailPage.tsx"), "utf8");
  it.each(["inspiration_transcripts", "inspiration_frameworks"])("sorts %s newest first", (table) => {
    expect(page).toContain(`row.${table} = newestFirst(row.${table})`);
  });
});
