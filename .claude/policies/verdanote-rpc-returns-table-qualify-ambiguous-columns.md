---
id: verdanote-rpc-returns-table-qualify-ambiguous-columns
title: Verdanote plpgsql RETURNS TABLE functions must alias the table and qualify columns to avoid 42702 ambiguity
scope: repo
trigger: writing or editing a Verdanote plpgsql function that uses RETURNS TABLE with output column names that match the underlying table's columns (e.g. claim_due_sync_accounts), or an edge function calling such an RPC returns 500 "column reference ... is ambiguous"
enforcement: soft
public: false
version: 1
created: 2026-06-02
updated: 2026-06-02
source: session-learning
applies_to: [supabase]
---

## Rule

In a plpgsql function declared `RETURNS TABLE (id, name, sync_frequency, ...)`, the output column names are **in scope as OUT parameters** inside the body. If the body's `WHERE`/`RETURNING` references those same names unqualified against a table that also has them, Postgres throws `column reference "<col>" is ambiguous` (SQLSTATE **42702**) — it cannot tell the OUT param from the table column.

ALWAYS **alias the target table and fully qualify every column** in WHERE/RETURNING when the `RETURNS TABLE` column names collide with table columns:

```sql
RETURN QUERY
UPDATE public.ad_accounts AS a
SET next_sync_at = claim_until
WHERE a.is_active = true
  AND a.sync_frequency <> 'manual'
  AND (a.next_sync_at IS NULL OR a.next_sync_at <= cutoff)
RETURNING a.id, a.name, a.sync_frequency, a.sync_hour,
          a.sync_timezone, a.next_sync_at, a.last_synced_at;
```

This is silent: the function definition applies fine; it only throws at call time. An edge function catching the error (anything other than `PGRST202`) will surface it as a 500 and abort.

## Rationale

`claim_due_sync_accounts` (the RPC `scheduled-sync` uses to atomically claim due accounts) had shipped with unqualified `sync_frequency` in WHERE/RETURNING colliding with its `RETURNS TABLE` OUT params. It threw 42702 on every call, so `scheduled-sync` returned 500 and `next_sync_at` never advanced — automated syncing was dead from the day the RPC was created. Migration `20260602000011` aliased the table (`ad_accounts AS a`) and qualified all columns; `scheduled-sync` then returned `200 {"triggered":4}` and `next_sync_at` advanced to the 12h cadence.
