-- Fix: claim_due_sync_accounts threw `column reference "sync_frequency" is
-- ambiguous` (SQLSTATE 42702), causing scheduled-sync to return HTTP 500 on
-- every invocation. The unqualified column names in the WHERE and RETURNING
-- clauses collided with the identically-named RETURNS TABLE output columns
-- (id, name, sync_frequency, ...), which are in scope as OUT parameters.
--
-- This is why automated syncing never ran and next_sync_at stayed frozen:
-- the claim RPC errored, scheduled-sync caught a non-PGRST202 error and bailed.
--
-- Fix: alias the target table and fully qualify every column reference so the
-- planner resolves them to the table, not the OUT params. Behaviour is
-- otherwise identical to the original definition in 20260519000001.
CREATE OR REPLACE FUNCTION public.claim_due_sync_accounts(cutoff timestamptz)
RETURNS TABLE (
  id text,
  name text,
  sync_frequency text,
  sync_hour integer,
  sync_timezone text,
  next_sync_at timestamptz,
  last_synced_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  claim_until timestamptz := now() + interval '6 hours';
BEGIN
  RETURN QUERY
  UPDATE public.ad_accounts AS a
  SET next_sync_at = claim_until
  WHERE a.is_active = true
    AND a.sync_frequency <> 'manual'
    AND (a.next_sync_at IS NULL OR a.next_sync_at <= cutoff)
  RETURNING a.id, a.name, a.sync_frequency, a.sync_hour,
            a.sync_timezone, a.next_sync_at, a.last_synced_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_due_sync_accounts(timestamptz) TO service_role;
