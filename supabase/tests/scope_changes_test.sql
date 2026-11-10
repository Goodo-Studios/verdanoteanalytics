-- Scope changes (migration 20261110200002, consolidation step 4c).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: row rules on, no grants for anon or public and no direct writes for
-- signed-in users; the lock trigger is not callable; an approved shot list version is
-- locked and an approved idea or a changes request is not; clients read nothing and
-- are refused both functions; a request needs the version locked right now; staff mark
-- "needs review", only a builder accepts or declines, once; a newly approved version
-- moves the lock; history cannot be changed. All rows are made up.

BEGIN;
SELECT plan(24);

INSERT INTO auth.users (id, email) VALUES
  ('ea000000-0000-4000-8000-000000000001', 'sc-builder@example.test'),
  ('ea000000-0000-4000-8000-000000000002', 'sc-employee@example.test'),
  ('ea000000-0000-4000-8000-000000000003', 'sc-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('ea000000-0000-4000-8000-000000000001', 'builder'),
  ('ea000000-0000-4000-8000-000000000002', 'employee'),
  ('ea000000-0000-4000-8000-000000000003', 'client');
INSERT INTO public.clients (slug, name, status) VALUES ('sc-alpha', 'SC Alpha', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('ea000000-0000-4000-8000-000000000003', 'sc-alpha');
INSERT INTO public.engagements (id, client_slug, cycle_number, engagement_type, status, start_date) VALUES
  ('ea100000-0000-4000-8000-000000000001', 'sc-alpha', 1, 'standard_sprint', 'active', '2026-11-02');

-- ---------------------------------------------------------------- structure (1-4)
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN (
  'public.scope_locks'::regclass, 'public.scope_change_requests'::regclass, 'public.scope_change_evaluations'::regclass)),
  'row rules are on for the three scope tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name IN ('scope_locks', 'scope_change_requests', 'scope_change_evaluations')
              AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on the scope tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name IN ('scope_locks', 'scope_change_requests', 'scope_change_evaluations')
              AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0,
  'signed-in users only read; writes go through the trigger and the checked functions');
SELECT ok(NOT has_function_privilege('authenticated', 'public.lock_scope_on_shot_list_approval()', 'EXECUTE'),
  'the lock trigger function is not callable by signed-in users');

-- ---------------------------------------------------------------- locking (5-10)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'ea000000-0000-4000-8000-000000000002', true);
CREATE TEMP TABLE sl AS SELECT public.create_approval_subject('ea100000-0000-4000-8000-000000000001', 'shot_list', 'Shot list') AS id;
CREATE TEMP TABLE idea AS SELECT public.create_approval_subject('ea100000-0000-4000-8000-000000000001', 'idea', 'Idea') AS id;
GRANT SELECT ON sl, idea TO authenticated;
SELECT is(public.save_approval_draft((SELECT id FROM sl), 0, '12 shots in the kitchen'), 1, 'shot list draft 1');
SELECT is(public.publish_approval_version((SELECT id FROM sl), 1), 1, 'shot list version 1 published');
SELECT ok(public.record_approval_decision((SELECT id FROM sl), 1, 'changes_requested', 'call', 'Wants a bathroom shot') IS NOT NULL,
  'a changes request is recorded');
SELECT is((SELECT count(*)::int FROM public.scope_locks WHERE subject_id = (SELECT id FROM sl)), 0, 'a changes request does not lock the scope');
SELECT is(public.save_approval_draft((SELECT id FROM idea), 0, 'Idea text') + public.publish_approval_version((SELECT id FROM idea), 1), 2, 'idea published');
SELECT ok(public.record_approval_decision((SELECT id FROM idea), 1, 'approved', 'email', 'Approved by email') IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.scope_locks WHERE subject_id = (SELECT id FROM idea)), 'an approved idea does not lock a scope');

-- ---------------------------------------------------------------- an approval locks (11-13)
SELECT is(public.save_approval_draft((SELECT id FROM sl), 1, '12 shots plus a bathroom shot'), 2, 'shot list draft 2');
SELECT is(public.publish_approval_version((SELECT id FROM sl), 2), 2, 'shot list version 2 published');
SELECT ok(public.record_approval_decision((SELECT id FROM sl), 2, 'approved', 'slack', 'Thumbs up in the client channel') IS NOT NULL
          AND (SELECT version FROM public.scope_locks WHERE subject_id = (SELECT id FROM sl)) = 2, 'the client approval locks version 2');

-- ---------------------------------------------------------------- client wall (14-17)
SELECT set_config('request.jwt.claim.sub', 'ea000000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.scope_locks) + (SELECT count(*)::int FROM public.scope_change_requests)
          + (SELECT count(*)::int FROM public.scope_change_evaluations), 0, 'a client reads no locks, requests or evaluations');
SELECT throws_ok($$SELECT public.request_scope_change((SELECT id FROM sl), 2, 'x', 'call', 'x')$$, '42501', NULL, 'a client cannot record a request');
SELECT throws_ok($$SELECT public.evaluate_scope_change('ea200000-0000-4000-8000-000000000001', 'accepted', 'x')$$, '42501', NULL,
  'a client cannot evaluate');
SELECT throws_ok($$INSERT INTO public.scope_change_requests (subject_id, base_version, engagement_id, client_slug, requested_change, channel, source_note, recorded_by)
                   VALUES ((SELECT id FROM sl), 2, 'ea100000-0000-4000-8000-000000000001', 'sc-alpha', 'x', 'call', 'x', 'ea000000-0000-4000-8000-000000000003')$$,
  '42501', NULL, 'a client cannot write a request directly');

-- ---------------------------------------------------------------- requests and evaluations (18-23)
SELECT set_config('request.jwt.claim.sub', 'ea000000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$SELECT public.request_scope_change((SELECT id FROM sl), 1, 'Add a car shot', 'call', 'Kickoff call')$$, '40001', NULL,
  'a request against a version that is not locked now is refused');
CREATE TEMP TABLE r1 AS SELECT public.request_scope_change((SELECT id FROM sl), 2, 'Add a car shot', 'call', 'Asked on the idea pitch call') AS id;
GRANT SELECT ON r1 TO authenticated;
SELECT ok(public.evaluate_scope_change((SELECT id FROM r1), 'needs_review', 'Checking the shoot day budget') IS NOT NULL, 'staff mark needs review');
SELECT throws_ok($$SELECT public.evaluate_scope_change((SELECT id FROM r1), 'accepted', 'Fine')$$, '42501', NULL, 'an employee cannot accept');
SELECT set_config('request.jwt.claim.sub', 'ea000000-0000-4000-8000-000000000001', true);
SELECT ok(public.evaluate_scope_change((SELECT id FROM r1), 'declined', 'Outside this cycle; offer it next cycle') IS NOT NULL, 'a builder declines');
SELECT throws_ok($$SELECT public.evaluate_scope_change((SELECT id FROM r1), 'accepted', 'Changed my mind')$$, '22023', NULL, 'a decided request stays decided');
SELECT throws_ok($$SELECT public.request_scope_change((SELECT id FROM idea), 1, 'x', 'call', 'x')$$, 'P0002', NULL, 'an idea has no scope lock');

-- ---------------------------------------------------------------- history (24)
RESET role;
SELECT throws_ok($$UPDATE public.scope_change_requests SET requested_change = 'changed'$$, '23514', NULL, 'requests cannot be changed');

SELECT * FROM finish();
ROLLBACK;
