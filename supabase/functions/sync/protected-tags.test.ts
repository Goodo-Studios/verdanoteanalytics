// Sync protects CSV-matched tags (audit plan item 5.11).
//
// Sync treated only tag_source "manual" and "csv" as user work to keep, but the accounts
// CSV match writes "csv_match". So the zero-spend cleanup deleted CSV-matched creatives
// (and their tags), and the Phase 1 lookup of protected ads was one unpaged select capped
// at 1,000 rows. Both now use one shared list that includes "csv_match", and the lookup
// is paged.
//
//   deno test -A supabase/functions/sync/protected-tags.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("the shared list of protected tag sources includes csv_match", async () => {
  const mod = await import("../_shared/protected-tag-sources.ts");
  assertEquals([...mod.PROTECTED_TAG_SOURCES].sort(), ["csv", "csv_match", "manual"]);
  assertEquals(mod.protectedTagSourcesInList(), '("manual","csv","csv_match")');
});

Deno.test("sync no longer hardcodes a protected list without csv_match", () => {
  assertEquals(src.includes('["manual", "csv"]'), false, 'Phase 1 lookup still uses ["manual", "csv"]');
  assertEquals(src.includes(`'("manual","csv")'`), false, "zero-spend cleanup still uses (manual,csv)");
});

// The zero-spend cleanup was removed by Matthew's decision 18 (see no-phase3-cleanup.test.ts),
// so the Phase 1 lookup is the only place sync uses the list.
Deno.test("sync uses the shared list in the Phase 1 lookup", () => {
  assert(src.includes('.in("tag_source", PROTECTED_TAG_SOURCES)'), "Phase 1 lookup must use PROTECTED_TAG_SOURCES");
});

Deno.test("the Phase 1 protected-ad lookup is paged past 1,000 rows", () => {
  const at = src.indexOf('.in("tag_source", PROTECTED_TAG_SOURCES)');
  assert(at > 0);
  const around = src.slice(Math.max(0, at - 600), at + 400);
  assert(/\.range\(/.test(around), "the protected-ad lookup must page with .range()");
});
