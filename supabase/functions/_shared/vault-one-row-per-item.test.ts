// Audit plan item 4.3: every write to inspiration_transcripts / inspiration_frameworks upserts on
// item_id, so re-analysis and a repeated Apify webhook keep one row per item.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const FILES = [
  "../vault-analyze/index.ts",
  "../vault-extract-webhook/index.ts",
  "../vault-transcribe/index.ts",
];

for (const file of FILES) {
  Deno.test(`${file} upserts transcripts and frameworks on item_id`, async () => {
    const src = await Deno.readTextFile(new URL(file, import.meta.url));
    const plainInsert = /from\("inspiration_(transcripts|frameworks)"\)\s*\.insert\(/;
    assertEquals(plainInsert.test(src), false, "no plain insert into inspiration_transcripts / inspiration_frameworks");
    const writes = src.match(/from\("inspiration_(transcripts|frameworks)"\)\s*\.upsert\(/g) ?? [];
    assertEquals(writes.length > 0, true, "writes through upsert");
    const onConflict = src.match(/onConflict: "item_id"/g) ?? [];
    assertEquals(onConflict.length >= writes.length, true, "each upsert targets item_id");
  });
}
