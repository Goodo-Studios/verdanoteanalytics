-- US-007 (Phase C, Feature #4): fix briefs idempotency upsert (error 42P10).
--
-- BUG
-- Migration 20260530000003 created the idempotency index as a PARTIAL unique
-- index:
--   CREATE UNIQUE INDEX ... ON public.briefs (account_id, generation_key)
--     WHERE generation_key IS NOT NULL;
-- The write-brief edge function upserts with
--   .upsert(row, { onConflict: "account_id,generation_key" })
-- which PostgREST/Postgres resolve via `ON CONFLICT (account_id, generation_key)`.
-- Postgres CANNOT use a partial unique index to infer an ON CONFLICT target
-- unless the conflict clause RESTATES the index predicate (... WHERE
-- generation_key IS NOT NULL). Neither supabase-js `.upsert({onConflict})` nor
-- the PostgREST `on_conflict=` param emits that predicate, so every keyed write
-- failed with:
--   42P10  there is no unique or exclusion constraint matching the
--          ON CONFLICT specification
-- (confirmed live against prod gwyxaqoaldnaavkjqquv during US-007 E2E).
--
-- FIX
-- Replace the partial index with a NON-partial unique index on the same columns.
-- This is inferable by `ON CONFLICT (account_id, generation_key)`. Behavior for
-- the dedup goal is UNCHANGED: Postgres treats NULLs as DISTINCT in unique
-- indexes (default, pre-15 NULLS DISTINCT semantics), so null-key rows still
-- never collide with each other — the in-app create path and existing rows that
-- supply no generation_key are unaffected, exactly as before.
--
-- Regression coverage: supabase/functions/write-brief/index.test.ts asserts the
-- briefs idempotency index is non-partial (no WHERE clause) so a partial index
-- can never silently reintroduce the 42P10 failure.

DROP INDEX IF EXISTS public.briefs_account_generation_key_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS briefs_account_generation_key_uidx
  ON public.briefs (account_id, generation_key);
