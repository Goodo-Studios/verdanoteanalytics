---
id: verdanote-sync-metafetch-handle-rate-limit-pause
title: Every metaFetch consumer must handle the resumable-pause outcome or pauses read as completion
scope: repo
trigger: editing sync/index.ts pagination loops, metaFetch, or any helper that returns a resumable cursor alongside success/error outcomes
enforcement: hard
public: false
version: 1
created: 2026-06-09
updated: 2026-06-09
source: session-learning
applies_to: [supabase]
---

## Rule

ALWAYS: `metaFetch` in `supabase/functions/sync/index.ts` returns a three-way outcome — success, terminal error (`error: true`), and resumable pause (`rateLimited: true` + `retriableUrl`). Every pagination loop that consumes it MUST explicitly handle the pause case by saving the cursor (`retriableUrl`) into sync state and returning. A loop that only checks `error` lets the pause fall through as `data: null` / `next: null`, which exits the loop looking like "phase complete."

ALWAYS: Treat partially-fetched prerequisite data as unusable. Never persist a partial campaign list (restart the list fetch on the next continue instead), and never filter by a partially-fetched spend set (fall back to unfiltered). A partial prerequisite silently excludes everything in the unfetched pages.

When adding a new outcome field to a shared fetch helper, audit EVERY call site for that outcome in the same change — the helper change is not done until all consumers handle it.

## Rationale

This was the root cause of the June 2026 Meta sync data drift. Phase 2 and Phase 4 of the sync pipeline checked only `result.error`; when a rate-limit backoff timed out or retries were exhausted, the pause outcome fell through the loop exit as completion. Phase 2 then bumped `last_data_sync`, so subsequent incremental runs never looked back at the unfetched pages — turning a transient rate limit into a permanent, silent data gap that surfaced as spend discrepancies against Meta Ads Manager. The same pattern dropped campaigns from Phase 1 when the campaign-list fetch or spend pre-filter was interrupted mid-pagination. Fixed 2026-06-09 (commits on verdanoteanalytics main ending 58fa3b0) with regression tests in `supabase/functions/sync/index.test.ts` covering metaFetch cursor semantics.
