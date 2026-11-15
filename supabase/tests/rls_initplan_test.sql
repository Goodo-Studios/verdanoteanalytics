-- RLS initPlan rewrite (migration 20261216100001).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Two things are proved here.
--   1. Guard: no policy in public calls auth.uid(), auth.role(), auth.jwt() or
--      has_role(...) bare. A bare call is re-evaluated for every row; wrapped as
--      (select ...) it runs once per statement. The detector is itself tested on a
--      probe table, so the guard cannot quietly go blind.
--   2. Access is unchanged: on creatives, creative_daily_metrics and sync_logs,
--      staff (builder and employee) read every account, a client reads only its own
--      linked account and cannot write, and anon reads nothing. Exception: since
--      20261216120001 a client reads no sync_logs at all.
-- All rows are made up and rolled back.

BEGIN;
SELECT plan(20);

-- ---------------------------------------------------------------- detector self-test (1-2)
CREATE TABLE public.rit_probe (id int PRIMARY KEY, user_id uuid);
ALTER TABLE public.rit_probe ENABLE ROW LEVEL SECURITY;
CREATE POLICY rit_probe_bare ON public.rit_probe FOR SELECT USING (auth.uid() = user_id);

CREATE FUNCTION pg_temp.unwrapped_count(p_table text) RETURNS int AS $$
  SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND (p_table IS NULL OR tablename = p_table)
     AND (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
         ~* '(?<!select )(auth\.(uid|role|jwt)\(\)|has_role\()'
$$ LANGUAGE sql;

SELECT is(pg_temp.unwrapped_count('rit_probe'), 1,
  'detector flags a policy that calls auth.uid() bare');

ALTER POLICY rit_probe_bare ON public.rit_probe USING ((select auth.uid()) = user_id);
SELECT is(pg_temp.unwrapped_count('rit_probe'), 0,
  'detector accepts the same policy once auth.uid() is wrapped in a select');
DROP TABLE public.rit_probe;

-- ---------------------------------------------------------------- guard (3-4)
SELECT is((SELECT count(*)::int FROM pg_policies
            WHERE schemaname = 'public'
              AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* '(?<!select )auth\.(uid|role|jwt)\(\)'), 0,
  'no public policy calls auth.uid(), auth.role() or auth.jwt() unwrapped');
SELECT is((SELECT count(*)::int FROM pg_policies
            WHERE schemaname = 'public'
              AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* '(?<!select )(public\.)?has_role\('), 0,
  'no public policy calls has_role() unwrapped');

-- ---------------------------------------------------------------- seed
INSERT INTO auth.users (id, email) VALUES
  ('b1700000-0000-4000-8000-000000000001', 'rit-builder@example.test'),
  ('b1700000-0000-4000-8000-000000000002', 'rit-employee@example.test'),
  ('b1700000-0000-4000-8000-000000000003', 'rit-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('b1700000-0000-4000-8000-000000000001', 'builder'),
  ('b1700000-0000-4000-8000-000000000002', 'employee'),
  ('b1700000-0000-4000-8000-000000000003', 'client');
INSERT INTO public.ad_accounts (id, name) VALUES ('act_rit_a', 'RIT A'), ('act_rit_b', 'RIT B');
INSERT INTO public.user_accounts (user_id, account_id) VALUES
  ('b1700000-0000-4000-8000-000000000003', 'act_rit_a');
INSERT INTO public.creatives (ad_id, account_id, ad_name) VALUES
  ('rit_ad_a', 'act_rit_a', 'RIT ad A'), ('rit_ad_b', 'act_rit_b', 'RIT ad B');
INSERT INTO public.creative_daily_metrics (ad_id, account_id, date, impressions, spend, clicks, purchases, purchase_value) VALUES
  ('rit_ad_a', 'act_rit_a', current_date, 100, 1, 1, 1, 5),
  ('rit_ad_b', 'act_rit_b', current_date, 100, 1, 1, 1, 5);
INSERT INTO public.sync_logs (account_id, sync_state) VALUES
  ('act_rit_a', '{}'::jsonb), ('act_rit_b', '{}'::jsonb);

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END
$$ LANGUAGE plpgsql;

-- anon outcomes are recorded while acting as anon and asserted afterwards, so the
-- assertions run as the test owner. A table anon cannot read at all counts as 0 rows.
CREATE TEMP TABLE rit_anon (tbl text, n int);
GRANT ALL ON rit_anon TO anon;

-- ---------------------------------------------------------------- staff (5-10)
SELECT pg_temp.as_user('b1700000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.creatives WHERE ad_id LIKE 'rit_ad_%'), 2,
  'builder reads creatives of every account');
SELECT is((SELECT count(*)::int FROM public.creative_daily_metrics WHERE ad_id LIKE 'rit_ad_%'), 2,
  'builder reads daily metrics of every account');
SELECT is((SELECT count(*)::int FROM public.sync_logs WHERE account_id LIKE 'act_rit_%'), 2,
  'builder reads sync logs of every account');
RESET ROLE;

SELECT pg_temp.as_user('b1700000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.creatives WHERE ad_id LIKE 'rit_ad_%'), 2,
  'employee reads creatives of every account');
SELECT is((SELECT count(*)::int FROM public.creative_daily_metrics WHERE ad_id LIKE 'rit_ad_%'), 2,
  'employee reads daily metrics of every account');
SELECT is((SELECT count(*)::int FROM public.sync_logs WHERE account_id LIKE 'act_rit_%'), 2,
  'employee reads sync logs of every account');
RESET ROLE;

-- ---------------------------------------------------------------- client (11-17)
SELECT pg_temp.as_user('b1700000-0000-4000-8000-000000000003');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.creatives WHERE ad_id = 'rit_ad_a'), 1,
  'client reads creatives of its linked account');
SELECT is((SELECT count(*)::int FROM public.creatives WHERE ad_id = 'rit_ad_b'), 0,
  'client does not read creatives of another account');
SELECT is((SELECT count(*)::int FROM public.creative_daily_metrics WHERE ad_id = 'rit_ad_a'), 1,
  'client reads daily metrics of its linked account');
SELECT is((SELECT count(*)::int FROM public.creative_daily_metrics WHERE ad_id = 'rit_ad_b'), 0,
  'client does not read daily metrics of another account');
-- Clients lost sync_logs access in 20261216120001 (audit plan 0.1): the only reader is the
-- builder-only Data Health section, and api_errors could carry a Meta token.
SELECT is((SELECT count(*)::int FROM public.sync_logs WHERE account_id = 'act_rit_a'), 0,
  'client does not read sync logs, not even of its linked account');
SELECT is((SELECT count(*)::int FROM public.sync_logs WHERE account_id = 'act_rit_b'), 0,
  'client does not read sync logs of another account');
SELECT throws_ok(
  $$INSERT INTO public.creatives (ad_id, account_id, ad_name) VALUES ('rit_ad_x', 'act_rit_a', 'client write')$$,
  '42501', NULL, 'client cannot write creatives, not even on its own account');
RESET ROLE;

-- ---------------------------------------------------------------- anon (18-20)
SELECT set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'anon', true);
SET LOCAL ROLE anon;
DO $$
DECLARE n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM public.creatives WHERE ad_id LIKE 'rit_ad_%';
  EXCEPTION WHEN insufficient_privilege THEN n := 0;
  END;
  INSERT INTO rit_anon VALUES ('creatives', n);
  BEGIN
    SELECT count(*) INTO n FROM public.creative_daily_metrics WHERE ad_id LIKE 'rit_ad_%';
  EXCEPTION WHEN insufficient_privilege THEN n := 0;
  END;
  INSERT INTO rit_anon VALUES ('creative_daily_metrics', n);
  BEGIN
    SELECT count(*) INTO n FROM public.sync_logs WHERE account_id LIKE 'act_rit_%';
  EXCEPTION WHEN insufficient_privilege THEN n := 0;
  END;
  INSERT INTO rit_anon VALUES ('sync_logs', n);
END $$;
RESET ROLE;

SELECT is((SELECT n FROM rit_anon WHERE tbl = 'creatives'), 0, 'anon reads no creatives');
SELECT is((SELECT n FROM rit_anon WHERE tbl = 'creative_daily_metrics'), 0, 'anon reads no daily metrics');
SELECT is((SELECT n FROM rit_anon WHERE tbl = 'sync_logs'), 0, 'anon reads no sync logs');

SELECT * FROM finish();
ROLLBACK;
