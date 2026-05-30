-- US-005 (Phase C, Feature #4): generation_key for idempotent brief writes.
--
-- PURPOSE
-- The write-brief service-role edge function (supabase/functions/write-brief)
-- persists HQ-synthesized briefs into public.briefs as status='draft'. To make
-- re-generating the same brief UPDATE the existing row rather than appending a
-- duplicate, the caller supplies a stable `generation_key`. The briefs table had
-- no suitable idempotency column, so this migration adds one + a partial unique
-- index that scopes uniqueness per (account_id, generation_key).
--
-- DESIGN
--   * generation_key is nullable so existing rows + the client-side
--     useBriefsApi.ts / in-app create path (which do not supply a key) are
--     unaffected — they keep inserting without participating in the upsert.
--   * The unique index is PARTIAL (WHERE generation_key IS NOT NULL) so only
--     keyed writes are deduplicated; null-key rows never collide.
--   * Uniqueness is on (account_id, generation_key) so the same generation_key
--     reused across different accounts does not collide — the write-brief
--     upsert targets exactly this conflict target.
--
-- This is the briefs analogue of the US-002 ingest idempotency (which used a
-- delete-then-insert batch sweep because those tables couldn't carry a key
-- column cleanly); here a real column + ON CONFLICT upsert is the better fit.

ALTER TABLE public.briefs
  ADD COLUMN IF NOT EXISTS generation_key text;

CREATE UNIQUE INDEX IF NOT EXISTS briefs_account_generation_key_uidx
  ON public.briefs (account_id, generation_key)
  WHERE generation_key IS NOT NULL;
