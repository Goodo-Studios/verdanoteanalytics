-- Fix: claim_sync_continue.p_sync_id was typed uuid, but sync_logs.id is bigint.
--
-- Regression introduced by 20260526000001_rpc_claim_sync_continue.sql. Every
-- /sync/continue call passes the bigint sync_logs.id into the uuid parameter.
-- PostgREST coerces the JSON number toward uuid and Postgres raises
-- "invalid input syntax for type uuid" (no implicit bigint -> uuid cast), so the
-- continue handler sets claimError and returns before runSyncPhase ever runs.
-- The sync never advances past phase 1 (meta_api_calls stays 0, no heartbeat),
-- cleanup-stuck-syncs requeues it, and it loops until MAX_RETRIES / the 2h
-- wall-clock cap marks it "Sync timed out (auto-cleanup)". This froze every
-- account's last_synced_at on 2026-05-26 (the day this migration shipped).
--
-- CREATE OR REPLACE cannot change an existing argument's type — Postgres keys
-- functions by their argument-type signature, so replacing with a bigint param
-- would CREATE a second overload and leave the broken (uuid, text, text) one in
-- place. Drop the uuid overload first so only the correct signature remains.

DROP FUNCTION IF EXISTS claim_sync_continue(uuid, text, text);

CREATE OR REPLACE FUNCTION claim_sync_continue(
  p_sync_id   bigint,
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
