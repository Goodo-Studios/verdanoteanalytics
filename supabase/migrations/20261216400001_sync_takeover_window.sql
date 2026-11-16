-- Audit 8.4: a second run could take over a sync that was still working.
--
-- claim_sync_continue let a fresh kick (p_old_claim NULL) take over a running sync after
-- 90 seconds without activity. A rate-limit wait in sync's metaFetch could last up to the
-- 110-second phase budget without touching last_activity, and Phase 5 never updated it,
-- so a healthy sync looked dead and two runs worked the same sync at once.
--
-- The sync function now heartbeats during rate-limit waits and through Phase 5 (same
-- release). This migration also widens the takeover window to 180 seconds, longer than
-- one phase budget, so a single quiet stretch inside a live invocation can never trigger
-- a takeover. A chain that has really died is still recovered after 3 minutes.
--
-- Same signature; CREATE OR REPLACE keeps grants. search_path stays pinned (20261214100002).

CREATE OR REPLACE FUNCTION public.claim_sync_continue(
  p_sync_id   bigint,
  p_old_claim text,   -- NULL = fresh kick (cron/monitor); non-null = chain continuation
  p_new_claim text
)
RETURNS SETOF public.sync_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.sync_logs
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
        OR (sync_state->>'last_activity')::timestamptz < now() - interval '180 seconds'
      ))
    )
  RETURNING *;
END;
$$;
