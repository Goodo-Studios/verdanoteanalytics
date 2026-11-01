---
id: verdanoteanalytics-supabase-query-filters-before-terminal-range-limit
title: Build the full Supabase filter chain BEFORE calling the terminal .range()/.limit() — never after
scope: repo
trigger: writing or reviewing a verdanoteanalytics Supabase PostgREST query that conditionally adds a filter (e.g. an optional account_id scope) alongside pagination
when: verdanoteanalytics && (supabase || postgrest || query || range || limit)
enforcement: soft
public: false
version: 1
created: 2026-08-02
updated: 2026-08-02
source: back-pressure-failure
applies_to: [supabase]
---

## Rule

ALWAYS apply every `.eq()` / `.not()` / other filter to a Supabase query BEFORE
the terminal `.range()` or `.limit()` call. `.range()`/`.limit()` execute the
query (they return a thenable, not a further-chainable builder in the patterns
this repo uses), so any filter attached after it is either silently dropped or
throws, depending on the client/mock in play.

NEVER write a conditional filter as a re-assignment tacked on after pagination:

```ts
// WRONG — filter is applied AFTER the terminal call
let query = supabase.from("t").select("*").range(offset, offset + PAGE - 1);
if (scopeId) query = query.eq("account_id", scopeId);
const { data } = await query;
```

```ts
// RIGHT — build the full filter chain, then paginate last
let query = supabase.from("t").select("*");
if (scopeId) query = query.eq("account_id", scopeId);
const { data } = await query.range(offset, offset + PAGE - 1);
```

ALWAYS write a test that asserts filter-before-pagination ordering directly
(e.g. find the index of the `eq` call and the `range` call in a recording mock
and assert `eqIdx < rangeIdx`) rather than only asserting the final row set —
a test recorder that returns the same fixture regardless of call order can pass
even when the ordering bug is present.

## Rationale

Written while adding `backfill-thumbnail-storage-path`: the handler built
`.select().not().order().range(offset, offset + PAGE - 1)` and only THEN did
`if (body.account_id) query = query.eq(...)`. Against the test's recording
mock, `.range()` returns a resolved Promise, so calling `.eq()` on it threw
`query.eq is not a function` — caught immediately by a scoping test written
before commit. Against a real client this class of bug can instead silently
drop the filter rather than throw, which is worse: the query still "works" but
scopes nothing, and a backfill or report meant to touch one account touches
all of them.
