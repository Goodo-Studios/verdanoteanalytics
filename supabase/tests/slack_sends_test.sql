-- Slack sends: outbound switch, owner alerts and the schedule (migration 20261109000006).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: the switch table is off by default (no row), builder only for writes,
-- staff read, clients nothing; enqueue_owner_alert is service-role only, queues
-- nothing without a builder-confirmed owner_alerts destination, and is
-- idempotent by key; the cron entry exists (staging removes it after each push).
-- All rows are made up.

BEGIN;
SELECT plan(20);
-- 20 = structure 5, client 1, employee 1, builder 3, reads 4, owner alerts 6.

INSERT INTO auth.users (id, email) VALUES
  ('d2000000-0000-4000-8000-000000000001', 'ss-builder@example.test'),
  ('d2000000-0000-4000-8000-000000000002', 'ss-employee@example.test'),
  ('d2000000-0000-4000-8000-000000000003', 'ss-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('d2000000-0000-4000-8000-000000000001', 'builder'),
  ('d2000000-0000-4000-8000-000000000002', 'employee'),
  ('d2000000-0000-4000-8000-000000000003', 'client');

-- ---------------------------------------------------------------- structure (1-5)
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.outbound_switches'::regclass), 'row rules are on for outbound_switches');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'outbound_switches' AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on outbound_switches');
SELECT is((SELECT count(*)::int FROM public.outbound_switches), 0, 'no switch row exists, so every outside send is off');
SELECT ok(NOT has_function_privilege('authenticated', 'public.enqueue_owner_alert(text,text)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.enqueue_owner_alert(text,text)', 'EXECUTE'),
  'only the service role can queue an owner alert');
SELECT is((SELECT count(*)::int FROM cron.job WHERE jobname = 'run-slack-jobs-5m' AND command LIKE '%/functions/v1/run-slack-jobs%'), 1,
  'run-slack-jobs is scheduled (scripts/staging-lockdown.sql removes it on staging)');

-- ---------------------------------------------------------------- client (6-7)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'd2000000-0000-4000-8000-000000000003', true);
SELECT throws_ok($$INSERT INTO public.outbound_switches (name, enabled) VALUES ('slack_sends', true)$$, '42501', NULL,
  'a client cannot turn a switch on');

-- ---------------------------------------------------------------- employee (8)
SELECT set_config('request.jwt.claim.sub', 'd2000000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$INSERT INTO public.outbound_switches (name, enabled) VALUES ('slack_sends', true)$$, '42501', NULL,
  'an employee cannot turn a switch on');

-- ---------------------------------------------------------------- builder (9-11)
SELECT set_config('request.jwt.claim.sub', 'd2000000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$INSERT INTO public.outbound_switches (name, enabled, note) VALUES ('slack_sends', false, 'test row')$$,
  'a builder adds the switch');
SELECT lives_ok($$UPDATE public.outbound_switches SET enabled = true WHERE name = 'slack_sends'$$, 'a builder turns it on');
SELECT is((SELECT updated_by FROM public.outbound_switches WHERE name = 'slack_sends'), 'd2000000-0000-4000-8000-000000000001'::uuid,
  'the switch records who added it');

-- ---------------------------------------------------------------- reads (12-14)
SELECT set_config('request.jwt.claim.sub', 'd2000000-0000-4000-8000-000000000002', true);
SELECT is((SELECT count(*)::int FROM public.outbound_switches), 1, 'an employee reads the switch');
SELECT lives_ok($$UPDATE public.outbound_switches SET enabled = false$$, 'an employee update runs and matches no row');
SELECT set_config('request.jwt.claim.sub', 'd2000000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.outbound_switches), 0, 'a client reads no switch');
RESET role;
SELECT is((SELECT enabled FROM public.outbound_switches WHERE name = 'slack_sends'), true, 'the employee update changed nothing');

-- ---------------------------------------------------------------- owner alerts (16-20)
SET LOCAL role service_role;
SELECT is(public.enqueue_owner_alert('test-1', 'Test alert'), NULL, 'no owner_alerts destination: nothing is queued');
RESET role;
INSERT INTO public.slack_destinations (label, channel_id, purpose, owner_confirmed) VALUES ('Test unconfirmed', 'C0SSUNCONF', 'owner_alerts', false);
SET LOCAL role service_role;
SELECT is(public.enqueue_owner_alert('test-1', 'Test alert'), NULL, 'an unconfirmed destination: nothing is queued');
RESET role;
INSERT INTO public.slack_destinations (label, channel_id, purpose, owner_confirmed) VALUES ('Test confirmed', 'C0SSCONF', 'owner_alerts', true);
SET LOCAL role service_role;
CREATE TEMP TABLE oa AS SELECT public.enqueue_owner_alert('test-1', 'Test alert') AS id;
SELECT is((SELECT (kind, payload->>'channel_id', payload->>'text', state)::text FROM public.durable_jobs
            WHERE id = (SELECT id FROM oa)),
  '(slack.owner_alert,C0SSCONF,"Test alert",queued)', 'a confirmed destination gets one queued owner alert');
SELECT is(public.enqueue_owner_alert('test-1', 'Test alert again'), (SELECT id FROM oa), 'the same key returns the first alert');
SELECT is((SELECT count(*)::int FROM public.durable_jobs WHERE dedupe_key = 'owner-alert:test-1'), 1, 'the same key queues it once');
SELECT throws_ok($$SELECT public.enqueue_owner_alert('  ', 'x')$$, '22023', NULL, 'an owner alert needs a key');
RESET role;

SELECT * FROM finish();
ROLLBACK;
