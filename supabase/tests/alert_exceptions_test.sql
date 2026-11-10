-- Alert exceptions (migration 20261111000002, step 4d).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: row rules on, no grants for anon or public and no direct writes for signed-in
-- users; clients read nothing and are refused; staff record an exception for 1 to 24 hours;
-- the Goodo OS kind rules (idle testing and paused engagement cover a stale connector,
-- reconnect warm-up a connector that never synced, a false positive anything); exceptions
-- are immutable. All rows are made up.

BEGIN;
SELECT plan(15);

INSERT INTO auth.users (id, email) VALUES
  ('e8000000-0000-4000-8000-000000000001', 'ae-employee@example.test'),
  ('e8000000-0000-4000-8000-000000000002', 'ae-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e8000000-0000-4000-8000-000000000001', 'employee'),
  ('e8000000-0000-4000-8000-000000000002', 'client');

-- ---------------------------------------------------------------- structure (1-3)
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.alert_exceptions'::regclass), 'row rules are on for alert_exceptions');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'alert_exceptions' AND grantee IN ('anon', 'PUBLIC')), 0, 'anon and public hold no privileges');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'alert_exceptions' AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0,
  'signed-in users only read alert_exceptions');

-- ---------------------------------------------------------------- employee (4-11)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e8000000-0000-4000-8000-000000000001', true);
SELECT ok(public.record_alert_exception('clickup', 'connector.stale', 'idle_testing', ' Testing a new board ', 4) IS NOT NULL,
  'an employee records an idle testing exception for a stale connector');
SELECT is((SELECT reason || ' ' || (expires_at - starts_at)::text FROM public.alert_exceptions), 'Testing a new board 04:00:00',
  'the reason is trimmed and the exception lasts the hours asked for');
SELECT throws_ok($$SELECT public.record_alert_exception('clickup', 'connector.unconfirmed', 'idle_testing', 'x', 4)$$, '22023', NULL,
  'idle testing does not cover a connector that never synced');
SELECT throws_ok($$SELECT public.record_alert_exception('clickup', 'connector.stale', 'reconnect_warmup', 'x', 4)$$, '22023', NULL,
  'reconnect warm-up does not cover a stale connector');
SELECT ok(public.record_alert_exception('verdanote_data', 'sync.stuck', 'false_positive', 'Sync log row left over from a restart', 24) IS NOT NULL,
  'a false positive covers any problem, for up to 24 hours');
SELECT throws_ok($$SELECT public.record_alert_exception('queue', 'queue.recovery', 'false_positive', 'x', 25)$$, '22023', NULL,
  'more than 24 hours is refused');
SELECT throws_ok($$SELECT public.record_alert_exception('queue', 'queue.recovery', 'false_positive', 'x', 0)$$, '22023', NULL,
  'zero hours is refused');
SELECT throws_ok($$SELECT public.record_alert_exception('crm', 'queue.recovery', 'false_positive', 'x', 1)$$, '22023', NULL,
  'an unknown connector is refused');

-- ---------------------------------------------------------------- client (12-14)
SELECT set_config('request.jwt.claim.sub', 'e8000000-0000-4000-8000-000000000002', true);
SELECT is((SELECT count(*)::int FROM public.alert_exceptions), 0, 'a client reads no alert exceptions');
SELECT throws_ok($$SELECT public.record_alert_exception('queue', 'queue.recovery', 'false_positive', 'client try', 1)$$, '42501', NULL,
  'a client cannot record an exception');
SELECT throws_ok($$INSERT INTO public.alert_exceptions (connector, pattern, kind, reason, expires_at, created_by)
                   VALUES ('queue', 'queue.recovery', 'false_positive', 'direct', now() + interval '1 hour', 'e8000000-0000-4000-8000-000000000002')$$,
  '42501', NULL, 'a signed-in user cannot write an exception directly');

-- ---------------------------------------------------------------- immutable (15)
RESET role;
SELECT throws_ok($$UPDATE public.alert_exceptions SET expires_at = now() + interval '20 hours'$$, '23514', NULL, 'an exception cannot be changed or extended');

SELECT * FROM finish();
ROLLBACK;
