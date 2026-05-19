-- Create the claim_due_sync_accounts RPC used by scheduled-sync/index.ts.
-- This function atomically claims accounts due for sync by updating their
-- next_sync_at to "now + 6 hours" in a single UPDATE...RETURNING, preventing
-- duplicate syncs under pg_cron's at-least-once delivery.
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
  UPDATE public.ad_accounts
  SET next_sync_at = claim_until
  WHERE is_active = true
    AND sync_frequency <> 'manual'
    AND (next_sync_at IS NULL OR next_sync_at <= cutoff)
  RETURNING id, name, sync_frequency, sync_hour, sync_timezone, next_sync_at, last_synced_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_due_sync_accounts(timestamptz) TO service_role;
