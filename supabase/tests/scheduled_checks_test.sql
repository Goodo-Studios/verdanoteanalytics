-- Scheduled budget and alert checks (migration 20261112000003, phase 4 PR 3).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Fixtures, all made up: b builder, e employee, c client login. One active fixed cost of 120
-- against a budget with a 50 warning and a 100 limit, so a check records two crossings.
--
-- Checks: check_runs has row rules and no writes for signed-in users; staff read it and a client
-- reads nothing; the two check bodies are service role only; a scheduled run records alerts with no
-- person, records a run and does not repeat itself; a failing scheduled run is recorded as failed
-- and leaves nothing half done; the builder's button still works, still refuses an employee and a
-- client, and records a manual run with the builder; both cron jobs exist.

BEGIN;
SELECT plan(26);

INSERT INTO auth.users (id, email) VALUES
  ('5c000000-0000-4000-8000-000000000001', 'sc-b@example.test'),
  ('5c000000-0000-4000-8000-000000000002', 'sc-e@example.test'),
  ('5c000000-0000-4000-8000-000000000003', 'sc-c@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('5c000000-0000-4000-8000-000000000001', 'builder'),
  ('5c000000-0000-4000-8000-000000000002', 'employee'),
  ('5c000000-0000-4000-8000-000000000003', 'client');
INSERT INTO public.operating_cost_entries (entry_key, label, category, monthly_usd, basis, source_reference, updated_by) VALUES
  ('sc-cost', 'Scheduled check cost', 'other', 120, 'quoted', 'test fixture', '5c000000-0000-4000-8000-000000000001');
INSERT INTO public.operating_budgets (budget_key, monthly_limit_usd, warning_usd, updated_by) VALUES
  ('total', 100, 50, '5c000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------- structure (1-5)
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.check_runs'::regclass), 'row rules are on for check_runs');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'check_runs' AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on check_runs');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'check_runs' AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0,
  'signed-in users only read check_runs');
SELECT ok(NOT has_function_privilege('authenticated', 'public.run_operating_budget_check(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.run_operating_budget_check(uuid)', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.run_operating_budget_check(uuid)', 'EXECUTE'),
  'the budget check body is for the service role only');
SELECT ok(NOT has_function_privilege('authenticated', 'public.run_scheduled_budget_check()', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.run_scheduled_budget_check()', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.run_scheduled_budget_check()', 'EXECUTE'),
  'the scheduled budget check is for the service role only');

-- ---------------------------------------------------------------- a failing scheduled run (6-8)
-- A trigger that always fails stands in for any error inside the check.
CREATE FUNCTION public.sc_boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END; $$;
CREATE TRIGGER sc_boom_trigger BEFORE INSERT ON public.operating_budget_alerts FOR EACH ROW EXECUTE FUNCTION public.sc_boom();
SELECT lives_ok($$SELECT public.run_scheduled_budget_check()$$, 'a failing scheduled check does not raise');
SELECT is((SELECT trigger || ':' || outcome || ':' || (actor_id IS NULL) FROM public.check_runs WHERE check_key = 'budget_check'),
  'scheduled:failed:true', 'the failure is recorded as a failed scheduled run');
SELECT is((SELECT count(*)::int FROM public.operating_budget_alerts) + (SELECT count(*)::int FROM public.operating_cost_events), 0,
  'a failed run leaves no alert and no history behind');
DROP TRIGGER sc_boom_trigger ON public.operating_budget_alerts;
DROP FUNCTION public.sc_boom();

-- ---------------------------------------------------------------- a scheduled run (9-14)
SELECT is(public.run_operating_budget_check(NULL), 2, 'a scheduled check with no person records the warning and the limit');
SELECT is((SELECT count(*)::int FROM public.operating_budget_alerts WHERE created_by IS NULL), 2, 'the alerts carry no person');
SELECT is((SELECT (detail ->> 'scheduled')::boolean FROM public.operating_cost_events WHERE action = 'budgets_evaluated'), true, 'the history says it was scheduled');
SELECT is((SELECT trigger || ':' || outcome FROM public.check_runs WHERE check_key = 'budget_check' ORDER BY id DESC LIMIT 1), 'scheduled:ok', 'a scheduled run is recorded');
SELECT lives_ok($$SELECT public.run_scheduled_budget_check()$$, 'the schedule can run again');
SELECT is((SELECT count(*)::int FROM public.operating_budget_alerts), 2, 'running again records no new alert');

-- ---------------------------------------------------------------- client (15-17)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', '5c000000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.check_runs), 0, 'a client reads no check runs');
SELECT throws_ok($$SELECT public.evaluate_operating_budgets()$$, '42501', NULL, 'a client cannot press the budget check');
SELECT throws_ok($$INSERT INTO public.check_runs (check_key, trigger, outcome) VALUES ('alert_check', 'scheduled', 'ok')$$, '42501', NULL, 'a client cannot write a check run');

-- ---------------------------------------------------------------- employee (18-20)
SELECT set_config('request.jwt.claim.sub', '5c000000-0000-4000-8000-000000000002', true);
SELECT cmp_ok((SELECT count(*)::int FROM public.check_runs), '>=', 2, 'an employee reads the check runs');
SELECT throws_ok($$SELECT public.evaluate_operating_budgets()$$, '42501', NULL, 'an employee cannot press the budget check');
SELECT throws_ok($$SELECT public.run_operating_budget_check(NULL)$$, '42501', NULL, 'an employee cannot call the check body');

-- ---------------------------------------------------------------- builder (21-23)
SELECT set_config('request.jwt.claim.sub', '5c000000-0000-4000-8000-000000000001', true);
SELECT is(public.evaluate_operating_budgets(), 0, 'the builder button still works (nothing new to record)');
SELECT is((SELECT trigger || ':' || outcome || ':' || (actor_id = '5c000000-0000-4000-8000-000000000001'::uuid)
             FROM public.check_runs WHERE check_key = 'budget_check' ORDER BY id DESC LIMIT 1),
  'manual:ok:true', 'a manual run is recorded with the builder');
SELECT throws_ok($$INSERT INTO public.check_runs (check_key, trigger, outcome) VALUES ('alert_check', 'scheduled', 'ok')$$, '42501', NULL, 'even a builder cannot write a check run from the browser');

-- ---------------------------------------------------------------- rules and schedules (24-26)
RESET role;
SELECT throws_ok($$INSERT INTO public.check_runs (check_key, trigger, outcome) VALUES ('alert_check', 'manual', 'ok')$$, '23514', NULL,
  'a manual run must name its person');
SELECT is((SELECT count(*)::int FROM cron.job WHERE jobname IN ('check-operating-budgets-daily', 'check-integration-alerts-30m') AND active), 2,
  'both check schedules exist');
SELECT is((SELECT schedule FROM cron.job WHERE jobname = 'check-operating-budgets-daily'), '15 13 * * *', 'the budget check runs daily');

SELECT * FROM finish();
ROLLBACK;
