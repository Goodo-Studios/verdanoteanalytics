---
id: verdanote-sync-logs-multi-writer-filter-real-syncs
title: Verdanote sync_logs is multi-writer — filter meta_api_calls>0 for real syncs; trust last_synced_at, not next_sync_at, for sync health
scope: repo
trigger: diagnosing Verdanote data-sync health, answering "when did accounts last sync", or reading the sync_logs table / SyncHistory UI
enforcement: soft
public: false
version: 1
created: 2026-06-02
updated: 2026-06-02
source: session-learning
applies_to: [supabase]
---

## Rule

The `sync_logs` table has **more than one writer**, so a row's existence does NOT mean a real Meta data sync happened:

- **Genuine Meta sync** (the `sync` edge function): `meta_api_calls > 0`, `duration_ms > 0`, `current_phase` 1–5, `api_errors` is a JSON-array string, `creatives_upserted` reflects real Meta fetches. `last_synced_at` on `ad_accounts` is stamped only at **phase 5** of this function.
- **Coda name-mapping run** (`sync-coda-names`): inserts rows with `sync_type='coda_names'` (was `'daily'` before the 2026-06-02 fix), `meta_api_calls=0`, `duration_ms=0`, `current_phase=0`, `api_errors` a plain number, `completed_at≈started_at`. These do **no** Meta work and never touch `last_synced_at`.

Rules when assessing sync health:

1. To find genuine syncs, **filter `meta_api_calls=gt.0`** (or `current_phase=gt.0`). Raw `sync_logs` counts are polluted by coda-names rows and will make a dead pipeline look healthy.
2. **Trust `ad_accounts.last_synced_at`** (stamped at sync phase 5) as the source of truth for "last real sync". It does not lie — if it looks stale, the sync genuinely stopped; it is not a stamping bug.
3. **Do NOT trust `next_sync_at`** as a liveness signal — it freezes whenever the scheduler or its claim RPC is broken (it sat at `2026-03-15` for months during the outage).
4. Keep `sync_type` distinct per writer (`'coda_names'` vs scheduled/manual/api) so the ledger stays honest.

## Rationale

On 2026-06-02 the data sync had been dead since a 2026-05-31 manual bulk run, but `sync_logs` showed `sync_type='daily'` rows every morning that looked like successful daily syncs. Those were `sync-coda-names` phantom rows (0 Meta calls, 0 duration, phase 0). The outage was only visible after filtering `meta_api_calls=gt.0`, which showed the last genuine syncs were all `sync_type='manual'` on May 31. `last_synced_at = May 31` had been accurate the entire time; the apparent staleness was a real multi-bug outage, not drift in the stamp.
