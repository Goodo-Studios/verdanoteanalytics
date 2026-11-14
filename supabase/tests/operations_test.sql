-- Operations page: cancel a queued job (migration 20261111000001, step 4d).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: the function is not open to anon; clients read no jobs and are refused; the
-- reason is required; only a queued job that was never claimed can be canceled (a
-- claimed, retried, replayed or recovery job is refused); a cancel is audited with the
-- staff member and the reason and a linked reminder follows the job; the step 3 replay
-- and manual resolution still answer to staff. All rows are made up.

BEGIN;
SELECT plan(17);

INSERT INTO auth.users (id, email) VALUES
  ('e4000000-0000-4000-8000-000000000001', 'op-builder@example.test'),
  ('e4000000-0000-4000-8000-000000000002', 'op-employee@example.test'),
  ('e4000000-0000-4000-8000-000000000003', 'op-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e4000000-0000-4000-8000-000000000001', 'builder'),
  ('e4000000-0000-4000-8000-000000000002', 'employee'),
  ('e4000000-0000-4000-8000-000000000003', 'client');
INSERT INTO public.clients (slug, name, status) VALUES ('op-alpha', 'OP Alpha', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('e4000000-0000-4000-8000-000000000003', 'op-alpha');

CREATE TEMP TABLE ids (name text PRIMARY KEY, id uuid);
GRANT ALL ON ids TO service_role, authenticated;

-- Jobs as the service role: fresh (never claimed), claimed then retried, and one in recovery.
SET LOCAL role service_role;
INSERT INTO ids SELECT 'fresh', (public.enqueue_job('op.test', 'op:fresh', '{}', 'op-alpha')).id;
INSERT INTO ids SELECT 'retried', (public.enqueue_job('op.retry', 'op:retried')).id;
SELECT public.fail_job(c.id, c.fence, 'w1', 'boom', 0) FROM public.claim_jobs(ARRAY['op.retry'], 'w1', 60, 1) c;
INSERT INTO ids SELECT 'stuck', (public.enqueue_job('op.stuck', 'op:stuck', '{}', NULL, NULL, now(), 1)).id;
SELECT public.fail_job(c.id, c.fence, 'w1', 'boom', 0) FROM public.claim_jobs(ARRAY['op.stuck'], 'w1', 60, 1) c;
INSERT INTO ids SELECT 'reminded', (public.enqueue_job('slack.reminder', 'op:reminded')).id;
RESET role;
INSERT INTO public.slack_destinations (id, label, channel_id, purpose, active, owner_confirmed)
  VALUES ('e4100000-0000-4000-8000-000000000001', 'OP test', 'C0OPTEST', 'internal', true, true);
INSERT INTO public.reminders (kind, destination_id, body, due_at, state, job_id)
  VALUES ('custom', 'e4100000-0000-4000-8000-000000000001', 'OP reminder', now(), 'queued', (SELECT id FROM ids WHERE name = 'reminded'));

-- ---------------------------------------------------------------- grants (1-2)
SELECT ok(NOT has_function_privilege('anon', 'public.cancel_queued_job(uuid, text)', 'EXECUTE'), 'anon cannot cancel a job');
SELECT ok(has_function_privilege('service_role', 'public.cancel_queued_job(uuid, text)', 'EXECUTE'), 'the service role can cancel a job');

-- ---------------------------------------------------------------- client (3-5)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.durable_jobs) + (SELECT count(*)::int FROM public.job_audit), 0,
  'a client reads no jobs and no job history, even for its own client');
SELECT throws_ok($$SELECT public.cancel_queued_job((SELECT id FROM ids WHERE name = 'fresh'), 'a client trying to cancel')$$, '42501', NULL,
  'a client cannot cancel a job');
SELECT throws_ok($$SELECT public.cancel_queued_job('00000000-0000-4000-8000-000000000000', 'a client trying to cancel')$$, '42501', NULL,
  'a client is refused before the job is looked up');

-- ---------------------------------------------------------------- employee (6-14)
SELECT set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$SELECT public.cancel_queued_job((SELECT id FROM ids WHERE name = 'fresh'), 'short')$$, '22023', NULL,
  'a reason of fewer than 10 characters is refused');
SELECT throws_ok($$SELECT public.cancel_queued_job('00000000-0000-4000-8000-000000000000', 'no such job here')$$, 'P0002', NULL,
  'an unknown job is not found');
SELECT throws_ok($$SELECT public.cancel_queued_job((SELECT id FROM ids WHERE name = 'retried'), 'it was claimed before')$$, '55000', NULL,
  'a queued job that was claimed before (a retry) cannot be canceled');
SELECT throws_ok($$SELECT public.cancel_queued_job((SELECT id FROM ids WHERE name = 'stuck'), 'it is in recovery now')$$, '55000', NULL,
  'a job in recovery cannot be canceled; it is resolved instead');
SELECT is((public.cancel_queued_job((SELECT id FROM ids WHERE name = 'fresh'), '  Duplicate of another job  ')).state, 'canceled',
  'the employee cancels a queued job that was never claimed');
SELECT is((SELECT actor || '|' || (detail->>'reason') FROM public.job_audit
            WHERE job_id = (SELECT id FROM ids WHERE name = 'fresh') AND action = 'manual_cancel'),
  'e4000000-0000-4000-8000-000000000002|Duplicate of another job', 'the cancel is audited with the staff member and the trimmed reason');
SELECT throws_ok($$SELECT public.cancel_queued_job((SELECT id FROM ids WHERE name = 'fresh'), 'cancel it a second time')$$, '55000', NULL,
  'a canceled job cannot be canceled again');
SELECT is((public.cancel_queued_job((SELECT id FROM ids WHERE name = 'reminded'), 'reminder no longer needed')).state, 'canceled',
  'a queued reminder job can be canceled');
SELECT is((SELECT state FROM public.reminders WHERE job_id = (SELECT id FROM ids WHERE name = 'reminded')), 'canceled',
  'the linked reminder follows the job to canceled');

-- ---------------------------------------------------------------- step 3 commands still answer to staff (15-17)
SELECT is((public.replay_job((SELECT id FROM ids WHERE name = 'stuck'))).state, 'queued', 'the employee replays the job in recovery');
SELECT throws_ok($$SELECT public.cancel_queued_job((SELECT id FROM ids WHERE name = 'stuck'), 'replayed job may have run')$$, '55000', NULL,
  'a replayed job cannot be canceled, because its earlier attempt may have reached the service');
SELECT set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000001', true);
SELECT is((SELECT count(*)::int FROM public.job_audit WHERE action = 'manual_cancel'), 2, 'the builder reads both cancels in the job history');

SELECT * FROM finish();
ROLLBACK;
