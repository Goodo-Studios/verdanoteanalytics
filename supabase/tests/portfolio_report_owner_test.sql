-- Portfolio reports belong to no single client (audit plan item 1.3).
--
-- A portfolio report holds several clients' numbers. With account_id set to one of them, that
-- client's login could read the whole report through the linked-accounts row rule. Migration
-- 20261216180001 clears account_id on portfolio reports and adds a check so it stays null.
--
-- Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(4);

INSERT INTO public.ad_accounts (id, name) VALUES ('act_pf_a', 'PF A'), ('act_pf_b', 'PF B');
INSERT INTO auth.users (id, email) VALUES ('c1310000-0000-4000-8000-000000000001', 'pf-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES ('c1310000-0000-4000-8000-000000000001', 'client');
INSERT INTO public.user_accounts (user_id, account_id) VALUES ('c1310000-0000-4000-8000-000000000001', 'act_pf_a');

SELECT throws_ok(
  $$INSERT INTO public.reports (report_name, report_type, account_id, portfolio_account_ids)
    VALUES ('PF', 'portfolio', 'act_pf_a', ARRAY['act_pf_a', 'act_pf_b'])$$,
  '23514', NULL, 'a portfolio report cannot have a single owning account');

SELECT lives_ok(
  $$INSERT INTO public.reports (id, report_name, report_type, account_id, portfolio_account_ids)
    VALUES ('c1310000-0000-4000-8000-0000000000a1', 'PF', 'portfolio', NULL, ARRAY['act_pf_a', 'act_pf_b'])$$,
  'a portfolio report with no owning account is accepted');

SELECT lives_ok(
  $$INSERT INTO public.reports (report_name, report_type, account_id) VALUES ('One', 'standard', 'act_pf_a')$$,
  'a standard report still has its account');

SELECT set_config('request.jwt.claims', json_build_object('sub', 'c1310000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', 'c1310000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.reports WHERE id = 'c1310000-0000-4000-8000-0000000000a1'),
  0, 'a client of one account in the portfolio cannot read the portfolio report');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
