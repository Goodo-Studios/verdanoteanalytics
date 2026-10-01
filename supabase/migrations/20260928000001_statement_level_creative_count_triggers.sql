-- Replace the per-row creative-count trigger with statement-level triggers.
--
-- Problem (2026-09-28, Cattasaurus, 9,346 creatives): trg_refresh_account_creative_counts
-- ran FOR EACH ROW on every INSERT/UPDATE/DELETE of public.creatives. Each firing
-- ran two count(*) queries over the account's creatives (~6ms) and updated the
-- ad_accounts row. The sync's Phase 5 rollup (rollup_creatives_from_daily) updates
-- every creative in the account in one statement, so it fired the trigger 9,346
-- times (~60s of counting plus 9,346 updates of one ad_accounts row). The rollup
-- hit the request timeout, and because the statement held the ad_accounts row
-- lock, the follow-up ad_accounts updates (last_data_sync, last_synced_at) hit
-- lock_timeout. The account's snapshot and "last synced" stayed stale.
--
-- Fix: three statement-level triggers with transition tables. Each statement
-- recounts once per affected account. The UPDATE trigger only recounts accounts
-- whose rows changed account_id or tag_source, so metric-only updates such as the
-- rollup do no counting and never touch ad_accounts.
--
-- Postgres allows transition tables only on single-event triggers, hence three.

DROP TRIGGER IF EXISTS trg_refresh_account_creative_counts ON public.creatives;

CREATE OR REPLACE FUNCTION public.refresh_account_creative_counts_for(p_account_ids text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_account_ids IS NULL OR cardinality(p_account_ids) = 0 THEN
    RETURN;
  END IF;

  UPDATE public.ad_accounts a
  SET creative_count = COALESCE(sub.total, 0),
      untagged_count = COALESCE(sub.untagged, 0)
  FROM (
    SELECT ids.id AS account_id,
           (SELECT count(*) FROM public.creatives c WHERE c.account_id = ids.id) AS total,
           (SELECT count(*) FROM public.creatives c WHERE c.account_id = ids.id AND c.tag_source = 'untagged') AS untagged
    FROM unnest(p_account_ids) AS ids(id)
  ) sub
  WHERE a.id = sub.account_id
    AND (a.creative_count IS DISTINCT FROM COALESCE(sub.total, 0)
         OR a.untagged_count IS DISTINCT FROM COALESCE(sub.untagged, 0));
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_account_creative_counts_ins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.refresh_account_creative_counts_for(
    ARRAY(SELECT DISTINCT account_id FROM new_rows WHERE account_id IS NOT NULL)
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_account_creative_counts_del()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.refresh_account_creative_counts_for(
    ARRAY(SELECT DISTINCT account_id FROM old_rows WHERE account_id IS NOT NULL)
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_account_creative_counts_upd()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only rows whose account or tag state changed affect the counts. ad_id is the
  -- primary key, so old and new rows pair on it.
  PERFORM public.refresh_account_creative_counts_for(ARRAY(
    SELECT DISTINCT x.account_id FROM (
      SELECT o.account_id FROM old_rows o JOIN new_rows n ON n.ad_id = o.ad_id
        WHERE o.account_id IS DISTINCT FROM n.account_id
           OR o.tag_source IS DISTINCT FROM n.tag_source
      UNION
      SELECT n.account_id FROM old_rows o JOIN new_rows n ON n.ad_id = o.ad_id
        WHERE o.account_id IS DISTINCT FROM n.account_id
           OR o.tag_source IS DISTINCT FROM n.tag_source
    ) x WHERE x.account_id IS NOT NULL
  ));
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_refresh_account_creative_counts_ins
AFTER INSERT ON public.creatives
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.refresh_account_creative_counts_ins();

CREATE TRIGGER trg_refresh_account_creative_counts_del
AFTER DELETE ON public.creatives
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.refresh_account_creative_counts_del();

CREATE TRIGGER trg_refresh_account_creative_counts_upd
AFTER UPDATE ON public.creatives
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.refresh_account_creative_counts_upd();

-- The old per-row function is no longer referenced.
DROP FUNCTION IF EXISTS public.refresh_account_creative_counts();

-- Internal helpers: not callable through the API.
REVOKE ALL ON FUNCTION public.refresh_account_creative_counts_for(text[]) FROM PUBLIC, anon, authenticated;
