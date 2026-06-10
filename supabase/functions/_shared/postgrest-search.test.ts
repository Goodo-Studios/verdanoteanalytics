// Regression tests for sanitizeSearchTerm — the guard that keeps a
// user-supplied ?search= value from injecting PostgREST filter clauses when
// interpolated into creatives' `.or(`ad_name.ilike.%${search}%,...`)` strings.
//
//   deno test supabase/functions/_shared/postgrest-search.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sanitizeSearchTerm } from "./postgrest-search.ts";

Deno.test("plain search text passes through unchanged", () => {
  assertEquals(sanitizeSearchTerm("summer sale hook"), "summer sale hook");
  assertEquals(sanitizeSearchTerm("UGC_Video_001"), "UGC_Video_001");
  // Characters that are safe inside an ilike operand are preserved.
  assertEquals(sanitizeSearchTerm("50% off!"), "50% off!");
  assertEquals(sanitizeSearchTerm("v2.3-final"), "v2.3-final");
});

Deno.test("strips PostgREST clause separators (commas) — injection vector", () => {
  // Without sanitization this would append a `spend.gte.0` clause to the or().
  assertEquals(sanitizeSearchTerm("x%,spend.gte.0"), "x% spend.gte.0");
});

Deno.test("strips logic-tree parens and quoted-literal delimiters", () => {
  assertEquals(sanitizeSearchTerm("a(b)c"), "a b c");
  assertEquals(sanitizeSearchTerm('say "hi"'), "say hi");
  assertEquals(sanitizeSearchTerm("back\\slash"), "back slash");
});

Deno.test("collapses whitespace and trims", () => {
  assertEquals(sanitizeSearchTerm("  hello   world  "), "hello world");
  // Pure-structural input sanitizes to empty (caller's `if (search)` skips it).
  assertEquals(sanitizeSearchTerm("(),\""), "");
});

Deno.test("handles null/undefined/empty", () => {
  assertEquals(sanitizeSearchTerm(null), "");
  assertEquals(sanitizeSearchTerm(undefined), "");
  assertEquals(sanitizeSearchTerm(""), "");
});
