---
id: verdanoteanalytics-reset-retry-count-on-manual-requeue
title: Reset retry_count to 0 when manually re-queuing a Verdanote sync via SQL
scope: repo
trigger: manually re-queuing a Verdanote sync by updating sync_state via SQL (e.g. setting status back to queued or running)
enforcement: soft
public: false
version: 1
created: 2026-05-26
updated: 2026-05-26
source: session-learning
applies_to: [supabase]
---

## Rule

When manually re-queuing a Verdanote sync via SQL, ALWAYS reset `retry_count` to `0` inside `sync_state` using `jsonb_set(sync_state, '{retry_count}', '0'::jsonb)`. Do not leave the prior `retry_count` value in place.

## Rationale

`sync_state.retry_count` is incremented by the auto-retry cycle in `cleanup-stuck-syncs`. When a sync is manually re-queued without resetting the counter, the next cleanup pass can read a stale value at or near `MAX_RETRIES` and immediately move the sync to a terminal state — wasting the manual intervention. Resetting to `0` mirrors the state a freshly-queued sync would have and ensures the auto-retry budget applies fresh.

## Examples

**Correct:**

```sql
UPDATE accounts
SET sync_state = jsonb_set(
  jsonb_set(sync_state, '{status}', '"queued"'::jsonb),
  '{retry_count}', '0'::jsonb
)
WHERE id = '...';
```

**Incorrect:**

```sql
UPDATE accounts
SET sync_state = jsonb_set(sync_state, '{status}', '"queued"'::jsonb)
WHERE id = '...';
-- retry_count still carries a stale value from the prior auto-retry cycle
```
