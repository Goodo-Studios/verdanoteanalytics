CREATE OR REPLACE FUNCTION public.snapshot_prior_roas(_account_id text)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH updated AS (
    UPDATE public.creatives
    SET prior_roas = roas
    WHERE account_id = _account_id AND roas IS NOT NULL
    RETURNING 1
  )
  SELECT count(*)::integer FROM updated;
$$;