---
id: verdanote-progressive-cache-skip-gate-in-query
title: Progressive cache/enrichment workers must bake the skip-gate into the SQL query, not into worker code
scope: repo
trigger: building or modifying any sync/enrich/cache worker that processes a finite backlog in batches (enrich-thumbnails, video caching, AI classification, embedding backfills)
enforcement: soft
public: false
version: 1
created: 2026-05-27
updated: 2026-05-27
source: session-learning
---

## Rule

ALWAYS: When a worker progressively drains a backlog (e.g. cache N rows per sync, enrich N rows per sync, classify N rows per sync), the WHERE clause must already exclude rows that have been processed. The worker fetches only outstanding work — never fetches-then-filters in code.

For the `ad-videos` storage cache in `enrich-thumbnails`, this means the query that selects rows to cache must include all of:
- `video_url IS NOT NULL` (the row actually has a CDN URL)
- `video_url NOT LIKE '<sentinel>'` (skip known terminal sentinels)
- `video_url NOT LIKE '%/storage/v1/object/public/ad-videos/%'` (skip rows whose URL already points at our Supabase storage bucket)

The third clause is the skip-gate. If it lives in worker code (`if (row.video_url.includes(BUCKET_PATH)) continue;`), every sync still pays the fetch cost for already-cached rows and re-queues them inside the LIMIT window — choking out genuinely new work. Pushed into the query, already-cached rows are invisible to the worker and the LIMIT slot goes to fresh URLs.

## Rationale

Verdanote's 2026-05-27 incident pattern: the original video caching pass fetched the top-N `video_url IS NOT NULL` rows ordered by spend, then filtered in TypeScript. Within two syncs the top-N slots were monopolized by rows whose `video_url` had already been rewritten to a Supabase storage URL — meaning the worker was "doing 20 rows per sync" but actually processing zero new rows. Adding the storage-URL exclusion to the WHERE clause fixed the drain rate immediately (46 cached in the next smoke test, 686 CDN URLs remaining in the queue, all real).

Architectural implications:

- **Worker code should be stateless about progress.** Progress lives in the database (which rows have been rewritten, marked, sentinel'd, etc.). The query is the cursor; the worker is the executor. Mixing those concerns creates phantom-throughput bugs where the per-sync count looks healthy but the backlog never shrinks.
- **Ordering matters separately from filtering.** `ORDER BY spend DESC` decides priority among eligible rows; the WHERE clause decides eligibility. Conflating the two ("just take the top 20") guarantees that any row already-touched but still high-spend will be re-fetched forever.
- **Test by counting two things separately**: how many rows did this sync touch, and how many of those produced new state? If the second number is much smaller than the first, the skip-gate is in the wrong place.

Companion: see [[verdanote-stop-retrying-confirmed-terminal-sentinels]] for the same lesson applied to sentinel rows that should never re-enter the query at all.
