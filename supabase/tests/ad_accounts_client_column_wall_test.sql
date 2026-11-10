-- Client column wall on ad_accounts (migration 20261111060001).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- A client login must not read ad_accounts through the REST API, not even its own
-- linked account, because that returns staff-only columns (prompts, thresholds,
-- attribution notes, the TikTok access token). Clients read accounts through the
-- accounts edge function, which returns allow-listed columns only. Staff reads and
-- writes are unchanged. All rows are made up.

BEGIN;
SELECT plan(8);

INSERT INTO auth.users (id, email) VALUES
  ('ac000000-0000-4000-8000-000000000001', 'acw-builder@example.test'),
  ('ac000000-0000-4000-8000-000000000002', 'acw-employee@example.test'),
  ('ac000000-0000-4000-8000-000000000003', 'acw-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('ac000000-0000-4000-8000-000000000001', 'builder'),
  ('ac000000-0000-4000-8000-000000000002', 'employee'),
  ('ac000000-0000-4000-8000-000000000003', 'client');
INSERT INTO public.ad_accounts (id, name, tiktok_access_token, attribution_notes, kill_threshold, creative_analysis_prompt)
VALUES ('act_acw_a', 'ACW A', 'tt-secret', 'staff note', 0.7, 'staff prompt'),
       ('act_acw_b', 'ACW B', 'tt-secret-b', 'staff note b', 0.5, 'staff prompt b');
INSERT INTO public.user_accounts (user_id, account_id) VALUES
  ('ac000000-0000-4000-8000-000000000003', 'act_acw_a');

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------- structure (1-3)
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ad_accounts'::regclass),
  'row rules are on for ad_accounts');
SELECT is((SELECT count(*)::int FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'ad_accounts' AND policyname = 'Client can view linked accounts'), 0,
  'the client row rule on ad_accounts is gone');
-- Every remaining rule on ad_accounts must require a staff role, so no future rule
-- quietly lets a client read the table again.
SELECT is((SELECT count(*)::int FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'ad_accounts'
              AND cmd IN ('SELECT', 'ALL')
              AND NOT (coalesce(qual, '') ~ 'builder' OR coalesce(qual, '') ~ 'employee')), 0,
  'every read rule on ad_accounts requires builder or employee');

-- ---------------------------------------------------------------- client (4-5)
SELECT pg_temp.as_user('ac000000-0000-4000-8000-000000000003');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.ad_accounts WHERE id = 'act_acw_a'), 0,
  'a client cannot read its own linked account directly');
SELECT is((SELECT count(*)::int FROM public.ad_accounts WHERE tiktok_access_token IS NOT NULL OR attribution_notes IS NOT NULL), 0,
  'a client reads no staff-only column value from ad_accounts');
RESET ROLE;

-- ---------------------------------------------------------------- staff control (6-8)
SELECT pg_temp.as_user('ac000000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.ad_accounts WHERE id IN ('act_acw_a', 'act_acw_b')), 2,
  'control: a builder still reads every account directly');
SELECT is((SELECT kill_threshold::numeric FROM public.ad_accounts WHERE id = 'act_acw_a'), 0.7::numeric,
  'control: a builder still reads staff columns');
RESET ROLE;

SELECT pg_temp.as_user('ac000000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.ad_accounts WHERE id IN ('act_acw_a', 'act_acw_b')), 2,
  'control: an employee still reads every account directly');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
