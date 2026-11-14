-- Operating costs, builder only (migration 20261111000003, step 4d).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: row rules on, no grants for anon or public and no direct writes for signed-in
-- users; employees and clients read none of the four tables and are refused every function;
-- a builder records entries and the budget against the version on screen; the warning sits
-- below the limit; checking the budgets records one alert per crossing, once, and queues an
-- owner alert only when a confirmed owner channel exists; history is immutable. All rows are
-- made up.

BEGIN;
SELECT plan(30);

INSERT INTO auth.users (id, email) VALUES
  ('e5000000-0000-4000-8000-000000000001', 'oc-builder@example.test'),
  ('e5000000-0000-4000-8000-000000000002', 'oc-employee@example.test'),
  ('e5000000-0000-4000-8000-000000000003', 'oc-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e5000000-0000-4000-8000-000000000001', 'builder'),
  ('e5000000-0000-4000-8000-000000000002', 'employee'),
  ('e5000000-0000-4000-8000-000000000003', 'client');

CREATE TEMP TABLE oc_tables (name text);
INSERT INTO oc_tables VALUES ('operating_cost_entries'), ('operating_budgets'), ('operating_cost_events'), ('operating_budget_alerts');
GRANT SELECT ON oc_tables TO authenticated;

-- ---------------------------------------------------------------- structure (1-4)
SELECT is((SELECT count(*)::int FROM pg_class c JOIN oc_tables t ON t.name = c.relname
            WHERE c.relnamespace = 'public'::regnamespace AND c.relrowsecurity), 4, 'row rules are on for the four tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants g JOIN oc_tables t ON t.name = g.table_name
            WHERE g.table_schema = 'public' AND g.grantee IN ('anon', 'PUBLIC')), 0, 'anon and public hold no privileges');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants g JOIN oc_tables t ON t.name = g.table_name
            WHERE g.table_schema = 'public' AND g.grantee = 'authenticated' AND g.privilege_type <> 'SELECT'), 0,
  'signed-in users only read; writes go through the checked functions');
SELECT is((SELECT count(*)::int FROM pg_policies p JOIN oc_tables t ON t.name = p.tablename
            WHERE p.schemaname = 'public' AND (p.qual ~ 'employee' OR p.qual !~ 'builder')), 0,
  'every row rule is builder only');

-- ---------------------------------------------------------------- builder records (5-14)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000001', true);
SELECT is(public.record_operating_cost_entry('supabase-pro', ' Supabase Pro ', 'database', 25.00, 'invoiced', 'October invoice', true, 0), 1,
  'a builder records a new cost entry at version 1');
SELECT is((SELECT label FROM public.operating_cost_entries WHERE entry_key = 'supabase-pro'), 'Supabase Pro', 'the label is trimmed');
SELECT throws_ok($$SELECT public.record_operating_cost_entry('supabase-pro', 'Supabase Pro', 'database', 30, 'invoiced', 'October invoice', true, 0)$$,
  '40001', NULL, 'a stale entry version is refused');
SELECT is(public.record_operating_cost_entry('supabase-pro', 'Supabase Pro', 'database', 30.00, 'invoiced', 'November invoice', true, 1), 2,
  'the next version replaces the amount');
SELECT throws_ok($$SELECT public.record_operating_cost_entry('bad key!', 'Label', 'database', 1, 'invoiced', 'ref', true, 0)$$, '22023', NULL,
  'an entry key with spaces or symbols is refused');
SELECT throws_ok($$SELECT public.record_operating_cost_entry('vercel', 'Vercel', 'hosting', 20, 'invoiced', 'ref', true, 0)$$, '22023', NULL,
  'an unknown category is refused');
SELECT throws_ok($$SELECT public.record_operating_cost_entry('vercel', 'Vercel', 'frontend_hosting', 20.005, 'invoiced', 'ref', true, 0)$$, '22023', NULL,
  'an amount with fractions of a cent is refused');
SELECT is(public.record_operating_cost_entry('vercel', 'Vercel Pro', 'frontend_hosting', 20.00, 'quoted', 'Pricing page', true, 0)
          + public.record_operating_cost_entry('old-tool', 'Old tool', 'other', 500.00, 'proposed', 'Estimate', false, 0), 2,
  'two more entries, one of them inactive');
SELECT throws_ok($$SELECT public.record_operating_budget('total', 100, 100, 0)$$, '22023', NULL, 'the warning must be below the limit');
SELECT is(public.record_operating_budget('total', 60.00, 40.00, 0), 1, 'a builder records the budget');

-- ---------------------------------------------------------------- budget check (15-22)
SELECT is(public.evaluate_operating_budgets(), 1, 'fixed costs of 50 (inactive entry left out) pass the 40 warning: one crossing');
SELECT is((SELECT level || ' ' || spend_usd || ' ' || threshold_usd || ' ' || crossing_key FROM public.operating_budget_alerts),
  'warning 50.00 40.00 total:' || to_char(now() at time zone 'utc', 'YYYY-MM') || ':warning:v1', 'the crossing is recorded with the spend and threshold');
SELECT ok((SELECT job_id IS NULL FROM public.operating_budget_alerts), 'no owner alert is queued without a confirmed owner channel');
SELECT is(public.evaluate_operating_budgets(), 0, 'checking again records nothing new');
RESET role;
INSERT INTO public.slack_destinations (label, channel_id, purpose, active, owner_confirmed)
  VALUES ('OC owner alerts', 'C0OCOWNER', 'owner_alerts', true, true);
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000001', true);
SELECT is(public.record_operating_cost_entry('vercel', 'Vercel Pro', 'frontend_hosting', 40.00, 'invoiced', 'November invoice', true, 1), 2,
  'the Vercel amount goes up to 40');
SELECT is(public.evaluate_operating_budgets(), 1, 'fixed costs of 70 pass the 60 limit: one more crossing');
SELECT is((SELECT j.kind || ' ' || j.dedupe_key FROM public.operating_budget_alerts a JOIN public.durable_jobs j ON j.id = a.job_id WHERE a.level = 'limit'),
  'slack.owner_alert owner-alert:budget:total:' || to_char(now() at time zone 'utc', 'YYYY-MM') || ':limit:v1',
  'the limit crossing queues one owner alert job through the shared queue');
SELECT is((SELECT count(*)::int FROM public.operating_cost_events WHERE action = 'budgets_evaluated'), 3, 'each check is recorded');

-- ---------------------------------------------------------------- employee and client (23-28)
SELECT set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000002', true);
SELECT is((SELECT count(*)::int FROM public.operating_cost_entries) + (SELECT count(*)::int FROM public.operating_budgets)
          + (SELECT count(*)::int FROM public.operating_cost_events) + (SELECT count(*)::int FROM public.operating_budget_alerts), 0,
  'an employee reads none of the operating cost tables');
SELECT throws_ok($$SELECT public.record_operating_cost_entry('emp', 'Employee try', 'other', 1, 'proposed', 'ref', true, 0)$$, '42501', NULL,
  'an employee cannot record a cost');
SELECT throws_ok($$SELECT public.evaluate_operating_budgets()$$, '42501', NULL, 'an employee cannot check the budgets');
SELECT set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.operating_cost_entries) + (SELECT count(*)::int FROM public.operating_budget_alerts), 0,
  'a client reads no operating costs');
SELECT throws_ok($$SELECT public.record_operating_budget('total', 10, 5, 1)$$, '42501', NULL, 'a client cannot record a budget');
SELECT throws_ok($$INSERT INTO public.operating_cost_entries (entry_key, label, category, monthly_usd, basis, source_reference, updated_by)
                   VALUES ('direct', 'Direct', 'other', 1, 'proposed', 'ref', 'e5000000-0000-4000-8000-000000000003')$$, '42501', NULL,
  'a signed-in user cannot write an entry directly');

-- ---------------------------------------------------------------- immutable history (29-30)
RESET role;
SELECT throws_ok($$UPDATE public.operating_budget_alerts SET spend_usd = 0$$, '23514', NULL, 'budget alerts cannot be changed');
SELECT throws_ok($$DELETE FROM public.operating_cost_events$$, '23514', NULL, 'cost history cannot be deleted');

SELECT * FROM finish();
ROLLBACK;
