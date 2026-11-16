-- Audit 8.5: the preview-capture drain lock is held for the whole chain.
--
-- preview-capture-drain released its single-flight lock (apify_drain_state) in `finally`
-- even after firing a self-chain, so the 10-minute cron saw the lock free and started a
-- second, parallel chain. The drain now keeps the lock while it chains and only the link
-- that stops chaining releases it (same release).
--
-- A long chain can outlive the 15-minute stale timeout, so each chain link refreshes
-- running_since with this function. It only refreshes a lock that is already held; it
-- never claims a free one. The stale timeout stays, so a chain that dies mid-way frees
-- the lock after 15 minutes.

CREATE OR REPLACE FUNCTION public.touch_apify_drain_singleflight()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
BEGIN
  UPDATE public.apify_drain_state
     SET running_since = now()
   WHERE id = true
     AND running_since IS NOT NULL
  RETURNING true INTO v_ok;
  RETURN COALESCE(v_ok, false);
END;
$$;

COMMENT ON FUNCTION public.touch_apify_drain_singleflight() IS
  'Audit 8.5: refresh running_since on the held preview-capture drain lock so a long self-chain keeps it past the stale timeout. Never claims a free lock. Returns true when the lock was held.';

REVOKE ALL ON FUNCTION public.touch_apify_drain_singleflight() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_apify_drain_singleflight() TO service_role;
