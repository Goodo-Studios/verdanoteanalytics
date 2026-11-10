-- Durable job queue and reminders (migration 20261109000005).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: row rules and grants; the queue as the service role (idempotent enqueue,
-- leases, fences, retries, recovery, at-most-once after a started outside effect,
-- cancel, append-only audit); staff replay and manual resolution, refused for
-- clients; reminders (only builder-confirmed destinations outside quiet hours are
-- queued, and the reminder follows its job); client A, client B, employee and
-- builder on every new table. All rows are made up.

BEGIN;
SELECT plan(69);

-- ---------------------------------------------------------------- fixtures
INSERT INTO auth.users (id, email) VALUES
  ('d1000000-0000-4000-8000-000000000001', 'dj-builder@example.test'),
  ('d1000000-0000-4000-8000-000000000002', 'dj-employee@example.test'),
  ('d1000000-0000-4000-8000-000000000003', 'dj-client-a@example.test'),
  ('d1000000-0000-4000-8000-000000000004', 'dj-client-b@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('d1000000-0000-4000-8000-000000000001', 'builder'),
  ('d1000000-0000-4000-8000-000000000002', 'employee'),
  ('d1000000-0000-4000-8000-000000000003', 'client'),
  ('d1000000-0000-4000-8000-000000000004', 'client');
INSERT INTO public.ad_accounts (id, name) VALUES ('act_dj_a', 'DJ Alpha');
INSERT INTO public.user_accounts (user_id, account_id) VALUES ('d1000000-0000-4000-8000-000000000003', 'act_dj_a');
INSERT INTO public.clients (slug, name, status) VALUES ('dj-alpha', 'DJ Alpha', 'active');
INSERT INTO public.client_ad_accounts (account_id, client_slug) VALUES ('act_dj_a', 'dj-alpha');

CREATE TEMP TABLE ids (name text PRIMARY KEY, id uuid, fence bigint);
GRANT ALL ON ids TO service_role, authenticated;

CREATE TEMP TABLE q_tables (name text);
INSERT INTO q_tables VALUES ('durable_jobs'), ('job_audit'), ('slack_destinations'), ('reminders');
GRANT SELECT ON q_tables TO authenticated, service_role;

-- ---------------------------------------------------------------- structure (1-6)
SELECT is((SELECT count(*)::int FROM pg_class c JOIN q_tables t ON t.name = c.relname
            WHERE c.relnamespace = 'public'::regnamespace AND c.relrowsecurity), 4,
  'row rules are on for the four new tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants g JOIN q_tables t ON t.name = g.table_name
            WHERE g.table_schema = 'public' AND g.grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on the new tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name IN ('durable_jobs', 'job_audit')
              AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0,
  'signed-in users can only read durable_jobs and job_audit; writes go through the queue functions');
SELECT is((SELECT string_agg(p, ', ') FROM unnest(ARRAY[
             'public.enqueue_job(text,text,jsonb,text,uuid,timestamptz,integer)',
             'public.claim_jobs(text[],text,integer,integer)',
             'public.mark_job_sending(uuid,bigint,text)',
             'public.finish_job(uuid,bigint,text,jsonb)',
             'public.fail_job(uuid,bigint,text,text,integer,boolean)',
             'public.cancel_job(uuid,text)',
             'public.enqueue_due_reminders(integer)']) AS p
            WHERE has_function_privilege('authenticated', p, 'EXECUTE') OR has_function_privilege('anon', p, 'EXECUTE')),
  NULL, 'no queue function is executable by anon or signed-in users');
SELECT ok((SELECT bool_and(has_function_privilege('service_role', p, 'EXECUTE')) FROM unnest(ARRAY[
             'public.enqueue_job(text,text,jsonb,text,uuid,timestamptz,integer)',
             'public.claim_jobs(text[],text,integer,integer)',
             'public.finish_job(uuid,bigint,text,jsonb)',
             'public.enqueue_due_reminders(integer)']) AS p),
  'the service role can run the queue');
SELECT is((SELECT count(*)::int FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'slack_destinations' AND cmd <> 'SELECT'
              AND (coalesce(qual, '') || coalesce(with_check, '')) ~ 'employee'), 0,
  'only builders can add or confirm Slack destinations');

-- ---------------------------------------------------------------- queue as the service role (7-27)
SET LOCAL role service_role;

INSERT INTO ids (name, id) SELECT 'job1', (public.enqueue_job('test.kind', 'test:job1', '{"n": 1}', 'dj-alpha')).id;
SELECT is((SELECT state FROM public.durable_jobs WHERE id = (SELECT id FROM ids WHERE name = 'job1')), 'queued', 'a new job is queued');
SELECT is((public.enqueue_job('test.kind', 'test:job1', '{"n": 2}')).id, (SELECT id FROM ids WHERE name = 'job1'),
  'enqueueing the same dedupe key returns the existing job');
SELECT is((SELECT count(*)::int FROM public.durable_jobs WHERE dedupe_key = 'test:job1'), 1, 'no duplicate job');
SELECT is((SELECT count(*)::int FROM public.job_audit WHERE job_id = (SELECT id FROM ids WHERE name = 'job1')), 1,
  'one enqueued audit row');

CREATE TEMP TABLE c1 AS SELECT * FROM public.claim_jobs(ARRAY['test.kind'], 'w1', 60, 10);
SELECT is((SELECT count(*)::int FROM c1), 1, 'worker 1 claims the job');
SELECT is((SELECT (state, fence, attempts, lease_owner)::text FROM c1), '(leased,1,1,w1)', 'claim leases it at fence 1');
SELECT is((SELECT count(*)::int FROM public.claim_jobs(ARRAY['test.kind'], 'w2', 60, 10)), 0, 'worker 2 cannot claim a live lease');
SELECT is(public.finish_job((SELECT id FROM ids WHERE name = 'job1'), 99, 'w1', '{}'), false, 'finish with the wrong fence is refused');
SELECT is(public.finish_job((SELECT id FROM ids WHERE name = 'job1'), 1, 'w2', '{}'), false, 'finish by another worker is refused');
SELECT is(public.fail_job((SELECT id FROM ids WHERE name = 'job1'), 1, 'w1', 'boom', 0), 'queued', 'a first failure retries');
SELECT is((SELECT (fence, attempts)::text FROM public.claim_jobs(ARRAY['test.kind'], 'w1', 60, 10)), '(2,2)', 'second claim is at fence 2');

RESET role;
UPDATE public.durable_jobs SET lease_until = now() - interval '1 second' WHERE id = (SELECT id FROM ids WHERE name = 'job1');
SET LOCAL role service_role;

SELECT is((SELECT (fence, attempts, lease_owner)::text FROM public.claim_jobs(ARRAY['test.kind'], 'w2', 60, 10)), '(3,3,w2)',
  'an expired lease is reclaimed by another worker');
SELECT is(public.finish_job((SELECT id FROM ids WHERE name = 'job1'), 2, 'w1', '{}'), false, 'the stale worker cannot finish it');
SELECT is(public.fail_job((SELECT id FROM ids WHERE name = 'job1'), 3, 'w2', 'boom again', 0), 'recovery', 'the last attempt goes to recovery');
SELECT is((SELECT count(*)::int FROM public.claim_jobs(ARRAY['test.kind'], 'w1', 60, 10)), 0, 'a job in recovery is not claimed');

-- At most once: an outside effect started, then the lease ran out.
INSERT INTO ids (name, id) SELECT 'job2', (public.enqueue_job('test.send', 'test:job2')).id;
UPDATE ids SET fence = (SELECT fence FROM public.claim_jobs(ARRAY['test.send'], 'w1', 60, 1)) WHERE name = 'job2';
SELECT is(public.mark_job_sending((SELECT id FROM ids WHERE name = 'job2'), (SELECT fence FROM ids WHERE name = 'job2'), 'w1'), true,
  'the lease holder marks the send as started');
RESET role;
UPDATE public.durable_jobs SET lease_until = now() - interval '1 second' WHERE id = (SELECT id FROM ids WHERE name = 'job2');
SET LOCAL role service_role;
SELECT is((SELECT count(*)::int FROM public.claim_jobs(ARRAY['test.send'], 'w2', 60, 10)), 0, 'a job whose send may have happened is not run again');
SELECT matches((SELECT state || ': ' || last_error FROM public.durable_jobs WHERE id = (SELECT id FROM ids WHERE name = 'job2')),
  '^recovery: lease expired after an outside effect started', 'it goes to recovery with the reason');
SELECT is(public.mark_job_sending((SELECT id FROM ids WHERE name = 'job2'), (SELECT fence FROM ids WHERE name = 'job2'), 'w1'), false,
  'a stale worker cannot mark a send');

INSERT INTO ids (name, id) SELECT 'job3', (public.enqueue_job('test.kind', 'test:job3')).id;
SELECT is(public.cancel_job((SELECT id FROM ids WHERE name = 'job3'), 'not needed'), true, 'a queued job can be canceled');
SELECT is(public.cancel_job((SELECT id FROM ids WHERE name = 'job3'), 'again'), false, 'a canceled job cannot be canceled again');
SELECT throws_ok($$SELECT * FROM public.claim_jobs(ARRAY['test.kind'], '', 60, 10)$$, '22023', NULL, 'a claim needs an owner');
RESET role;

-- ---------------------------------------------------------------- audit is append-only (28-29)
SELECT throws_ok($$UPDATE public.job_audit SET actor = 'x'$$, '23514', NULL, 'job_audit rows cannot be changed');
SELECT throws_ok($$DELETE FROM public.job_audit$$, '23514', NULL, 'job_audit rows cannot be deleted');

-- ---------------------------------------------------------------- client A (30-35)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000003', true);

SELECT is((SELECT count(*)::int FROM public.durable_jobs), 0, 'client A reads no jobs (even for its own client)');
SELECT is((SELECT count(*)::int FROM public.job_audit), 0, 'client A reads no job history');
SELECT is((SELECT count(*)::int FROM public.slack_destinations), 0, 'client A reads no Slack destinations');
SELECT throws_ok($$SELECT public.replay_job((SELECT id FROM ids WHERE name = 'job1'))$$, '42501', NULL, 'client A cannot replay a job');
SELECT throws_ok($$SELECT public.resolve_job_manually((SELECT id FROM ids WHERE name = 'job2'), 'abandoned', 'a client trying this')$$,
  '42501', NULL, 'client A cannot resolve a job');
SELECT throws_ok($$INSERT INTO public.durable_jobs (kind, dedupe_key) VALUES ('test.kind', 'client-try')$$, '42501', NULL,
  'client A cannot write a job directly');

-- ---------------------------------------------------------------- client B (36-37)
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000004', true);
SELECT is((SELECT count(*)::int FROM public.durable_jobs), 0, 'client B reads no jobs');
SELECT is((SELECT count(*)::int FROM public.reminders), 0, 'client B reads no reminders');

-- ---------------------------------------------------------------- employee (38-46)
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);

SELECT is((SELECT count(*)::int FROM public.durable_jobs), 3, 'employee reads every job');
SELECT cmp_ok((SELECT count(*)::int FROM public.job_audit), '>=', 10, 'employee reads the job history');
SELECT throws_ok($$INSERT INTO public.durable_jobs (kind, dedupe_key) VALUES ('test.kind', 'employee-try')$$, '42501', NULL,
  'employee cannot write a job directly');
SELECT is((public.replay_job((SELECT id FROM ids WHERE name = 'job1'))).state, 'queued', 'employee replays a job in recovery');
SELECT is((SELECT (attempts, send_started_fence IS NULL)::text FROM public.durable_jobs WHERE id = (SELECT id FROM ids WHERE name = 'job1')),
  '(0,t)', 'replay resets attempts');
SELECT throws_ok($$SELECT public.replay_job((SELECT id FROM ids WHERE name = 'job1'))$$, '55000', NULL, 'only a job in recovery can be replayed');
SELECT throws_ok($$SELECT public.resolve_job_manually((SELECT id FROM ids WHERE name = 'job2'), 'abandoned', 'short')$$, '22023', NULL,
  'a manual resolution needs a real note');
SELECT is((public.resolve_job_manually((SELECT id FROM ids WHERE name = 'job2'), 'effect_confirmed', 'checked the channel, the message is there')).state,
  'resolved_manually', 'employee resolves a job in recovery');
SELECT throws_ok($$INSERT INTO public.slack_destinations (label, channel_id, purpose) VALUES ('x', 'C0EMPLOYEE', 'internal')$$, '42501', NULL,
  'employee cannot add a Slack destination');

RESET role;
SELECT is((SELECT actor FROM public.job_audit WHERE job_id = (SELECT id FROM ids WHERE name = 'job1') AND action = 'manual_replay'),
  'd1000000-0000-4000-8000-000000000002', 'the replay is recorded against the employee');

-- ---------------------------------------------------------------- reminders (48-66)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);

INSERT INTO ids (name, id) VALUES
  ('d_ok', gen_random_uuid()), ('d_unconfirmed', gen_random_uuid()), ('d_quiet', gen_random_uuid()), ('d_badtz', gen_random_uuid());
SELECT lives_ok($$
  INSERT INTO public.slack_destinations (id, label, channel_id, purpose, owner_confirmed, quiet_start_minute, quiet_end_minute, quiet_timezone) VALUES
    ((SELECT id FROM ids WHERE name = 'd_ok'), 'Test ok', 'C0TESTOK', 'internal', true, 0, 0, 'UTC'),
    ((SELECT id FROM ids WHERE name = 'd_unconfirmed'), 'Test unconfirmed', 'C0TESTUN', 'internal', false, 0, 0, 'UTC'),
    ((SELECT id FROM ids WHERE name = 'd_quiet'), 'Test quiet', 'C0TESTQT', 'owner_alerts', true,
       (extract(hour from now() at time zone 'UTC') * 60 + extract(minute from now() at time zone 'UTC'))::int,
       ((extract(hour from now() at time zone 'UTC') * 60 + extract(minute from now() at time zone 'UTC'))::int + 120) % 1440, 'UTC'),
    ((SELECT id FROM ids WHERE name = 'd_badtz'), 'Test bad zone', 'C0TESTTZ', 'internal', true, 60, 120, 'Not/AZone')
$$, 'builder adds Slack destinations');
SELECT throws_ok($$INSERT INTO public.slack_destinations (label, channel_id, purpose) VALUES ('x', 'C0NOCLIENT', 'client_reminders')$$,
  '23514', NULL, 'a client reminder destination needs a client');
SELECT throws_ok($$INSERT INTO public.slack_destinations (label, channel_id, purpose) VALUES ('x', 'not-a-channel', 'internal')$$,
  '23514', NULL, 'a channel id must look like a Slack channel id');

SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
INSERT INTO ids (name, id) VALUES ('r_due', gen_random_uuid()), ('r_unconfirmed', gen_random_uuid()), ('r_future', gen_random_uuid()),
  ('r_quiet', gen_random_uuid()), ('r_badtz', gen_random_uuid()), ('r_fail', gen_random_uuid());
SELECT lives_ok($$
  INSERT INTO public.reminders (id, kind, destination_id, client_slug, body, due_at) VALUES
    ((SELECT id FROM ids WHERE name = 'r_due'), 'custom', (SELECT id FROM ids WHERE name = 'd_ok'), 'dj-alpha', 'Test reminder due', now() - interval '1 minute'),
    ((SELECT id FROM ids WHERE name = 'r_unconfirmed'), 'custom', (SELECT id FROM ids WHERE name = 'd_unconfirmed'), NULL, 'Test unconfirmed', now() - interval '1 minute'),
    ((SELECT id FROM ids WHERE name = 'r_future'), 'custom', (SELECT id FROM ids WHERE name = 'd_ok'), NULL, 'Test future', now() + interval '1 day'),
    ((SELECT id FROM ids WHERE name = 'r_quiet'), 'owner_alert', (SELECT id FROM ids WHERE name = 'd_quiet'), NULL, 'Test quiet', now() - interval '1 minute'),
    ((SELECT id FROM ids WHERE name = 'r_badtz'), 'custom', (SELECT id FROM ids WHERE name = 'd_badtz'), NULL, 'Test bad zone', now() - interval '1 minute')
$$, 'employee schedules reminders');
SELECT is((SELECT count(*)::int FROM public.reminders), 5, 'employee reads the reminders');

SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.reminders), 0, 'client A reads no reminders (even for its own client)');
SELECT throws_ok($$INSERT INTO public.reminders (kind, destination_id, body, due_at) VALUES ('custom', (SELECT id FROM ids WHERE name = 'd_ok'), 'x', now())$$,
  '42501', NULL, 'client A cannot schedule a reminder');
RESET role;

SET LOCAL role service_role;
SELECT is(public.enqueue_due_reminders(), 1, 'only the due reminder on a confirmed, non-quiet destination is queued');
SELECT is((SELECT (r.state, j.kind, j.dedupe_key = 'reminder:' || r.id::text, j.payload->>'channel_id')::text
             FROM public.reminders r JOIN public.durable_jobs j ON j.id = r.job_id WHERE r.id = (SELECT id FROM ids WHERE name = 'r_due')),
  '(queued,slack.reminder,t,C0TESTOK)', 'the reminder points at a slack.reminder job for its channel');
SELECT is((SELECT count(*)::int FROM public.reminders WHERE state = 'scheduled'), 4,
  'unconfirmed, future, quiet-hours and unknown-time-zone reminders wait');
SELECT is(public.enqueue_due_reminders(), 0, 'a second run queues nothing new');

UPDATE ids SET fence = (SELECT fence FROM public.claim_jobs(ARRAY['slack.reminder'], 'w-slack', 60, 1)) WHERE name = 'r_due';
SELECT is(public.finish_job((SELECT job_id FROM public.reminders WHERE id = (SELECT id FROM ids WHERE name = 'r_due')),
  (SELECT fence FROM ids WHERE name = 'r_due'), 'w-slack', '{"ts": "test"}'), true, 'the worker finishes the reminder job');
SELECT is((SELECT state FROM public.reminders WHERE id = (SELECT id FROM ids WHERE name = 'r_due')), 'sent', 'a delivered job marks the reminder sent');
RESET role;

-- A reminder whose job fails, is replayed, fails again and is resolved by hand.
INSERT INTO public.reminders (id, kind, destination_id, body, due_at)
VALUES ((SELECT id FROM ids WHERE name = 'r_fail'), 'custom', (SELECT id FROM ids WHERE name = 'd_ok'), 'Test failing reminder', now() - interval '1 minute');
SET LOCAL role service_role;
SELECT is(public.enqueue_due_reminders(), 1, 'the new due reminder is queued');
UPDATE ids SET fence = (SELECT fence FROM public.claim_jobs(ARRAY['slack.reminder'], 'w-slack', 60, 1)) WHERE name = 'r_fail';
SELECT is(public.fail_job((SELECT job_id FROM public.reminders WHERE id = (SELECT id FROM ids WHERE name = 'r_fail')),
  (SELECT fence FROM ids WHERE name = 'r_fail'), 'w-slack', 'channel_not_found', 0, true), 'recovery', 'a permanent failure goes to recovery');
SELECT is((SELECT state FROM public.reminders WHERE id = (SELECT id FROM ids WHERE name = 'r_fail')), 'failed', 'the reminder shows failed');
RESET role;

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
SELECT lives_ok($$SELECT public.replay_job((SELECT job_id FROM public.reminders WHERE id = (SELECT id FROM ids WHERE name = 'r_fail')))$$,
  'employee replays the failed reminder job');
SELECT is((SELECT state FROM public.reminders WHERE id = (SELECT id FROM ids WHERE name = 'r_fail')), 'queued', 'a replayed job puts the reminder back in the queue');
RESET role;

SET LOCAL role service_role;
UPDATE ids SET fence = (SELECT fence FROM public.claim_jobs(ARRAY['slack.reminder'], 'w-slack', 60, 1)) WHERE name = 'r_fail';
SELECT is(public.fail_job((SELECT job_id FROM public.reminders WHERE id = (SELECT id FROM ids WHERE name = 'r_fail')),
  (SELECT fence FROM ids WHERE name = 'r_fail'), 'w-slack', 'ambiguous', 0, true), 'recovery', 'it fails again');
RESET role;

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$SELECT public.resolve_job_manually((SELECT job_id FROM public.reminders WHERE id = (SELECT id FROM ids WHERE name = 'r_fail')),
  'abandoned', 'channel was archived, telling them by phone')$$, 'builder abandons it after checking');
RESET role;
SELECT is((SELECT state || ': ' || cancel_reason FROM public.reminders WHERE id = (SELECT id FROM ids WHERE name = 'r_fail')),
  'canceled: channel was archived, telling them by phone', 'an abandoned job cancels the reminder with the note');

SELECT * FROM finish();
ROLLBACK;
