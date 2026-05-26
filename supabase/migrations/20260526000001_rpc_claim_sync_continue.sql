-- Atomic claim for /sync/continue to prevent concurrent chain duplication.
--
-- Two concurrent /continue callers both see status='running' before either writes.
-- This function turns the CAS into an exclusive claim: only one caller can match because
-- Postgres serializes concurrent UPDATEs on the same row — the second caller
-- re-evaluates the WHERE after the first commits and sees a different claim_id, so
-- it returns 0 rows and the stale chain self-terminates.
--
-- p_old_claim IS NOT NULL → chain continuation: exact UUID match required.
-- p_old_claim IS NULL     → fresh start or recovery: accepted only when the row has
--                           no existing claim_id, OR when last_activity went stale
--                           (>90s, chain died without firing selfContinue).

CREATE OR REPLACE FUNCTION claim_sync_continue(
  p_sync_id   uuid,
  p_old_claim text,   -- NULL = fresh kick (cron/monitor); non-null = chain continuation
  p_new_claim text
)
RETURNS SETOF sync_logs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  UPDATE sync_logs
  SET sync_state = jsonb_set(
    COALESCE(sync_state, '{}'::jsonb),
    '{claim_id}',
    to_jsonb(p_new_claim)
  )
  WHERE id = p_sync_id
    AND status = 'running'
    AND (
      -- Chain continuation: exact claim_id match
      (p_old_claim IS NOT NULL AND sync_state->>'claim_id' = p_old_claim)
      OR
      -- Fresh start / dead-chain recovery: no active claim or chain went silent
      (p_old_claim IS NULL AND (
        sync_state->>'claim_id' IS NULL
        OR (sync_state->>'last_activity')::timestamptz < now() - interval '90 seconds'
      ))
    )
  RETURNING *;
END;
$$;
