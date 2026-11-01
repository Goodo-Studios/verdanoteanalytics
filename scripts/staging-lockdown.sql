-- STAGING ONLY. Never run this against production.
--
-- Applied by the deploy-staging CI job after every `supabase db push` to the
-- staging project (the __STAGING_REF__ token is replaced with the staging project
-- ref by the job). Migrations written for production schedule cron jobs and
-- hard-code the production project URL. This script makes staging safe again
-- after each push:
--
--   1. Removes every pg_cron job, so nothing runs on a timer in staging.
--   2. Rewrites the production project ref to the staging ref inside database
--      functions, so a trigger or helper can only call staging functions.
--   3. Points the settings rows that functions read at the staging project.
--   4. Fails the run (and the CI job) if any production reference is left.
--
-- Safe to run repeatedly.

DO $lockdown$
DECLARE
  prod_ref    constant text := 'gwyxaqoaldnaavkjqquv';
  staging_ref constant text := '__STAGING_REF__';
  r record;
  def text;
  leftover int;
BEGIN
  IF staging_ref = prod_ref OR staging_ref LIKE '\_\_%' THEN
    RAISE EXCEPTION 'staging-lockdown: refusing to run, staging ref is "%"', staging_ref;
  END IF;

  -- 1. Every cron job off.
  FOR r IN SELECT jobid FROM cron.job LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;

  -- 2. Rewrite production URLs inside function bodies.
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.prosrc LIKE '%' || prod_ref || '%'
  LOOP
    def := replace(pg_get_functiondef(r.oid), prod_ref, staging_ref);
    EXECUTE def;
  END LOOP;

  -- 3. Settings rows read by trigger helpers (only if the table exists).
  IF to_regclass('public.settings') IS NOT NULL THEN
    UPDATE public.settings
       SET value = 'https://' || staging_ref || '.supabase.co'
     WHERE key = 'supabase_url';
  END IF;

  -- 4. Nothing may still reference production.
  SELECT count(*) INTO leftover
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosrc LIKE '%' || prod_ref || '%';
  IF leftover > 0 THEN
    RAISE EXCEPTION 'staging-lockdown: % function(s) still reference the production project', leftover;
  END IF;

  SELECT count(*) INTO leftover FROM cron.job;
  IF leftover > 0 THEN
    RAISE EXCEPTION 'staging-lockdown: % cron job(s) still scheduled', leftover;
  END IF;
END
$lockdown$;
