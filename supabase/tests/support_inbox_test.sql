-- Support inbox, staff only (migration 20261111000004, step 4d).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: row rules on, no grants for anon or public and no direct writes for signed-in
-- users; the helper is not callable from the browser; clients read nothing, including
-- requests about their own client, and are refused every function; staff record a question
-- (a repeat returns the same request), give updates, resolve and reopen in order against the
-- revision on screen, and assign only staff; history is immutable. All rows are made up.

BEGIN;
SELECT plan(30);

INSERT INTO auth.users (id, email) VALUES
  ('e6000000-0000-4000-8000-000000000001', 'si-builder@example.test'),
  ('e6000000-0000-4000-8000-000000000002', 'si-employee@example.test'),
  ('e6000000-0000-4000-8000-000000000003', 'si-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e6000000-0000-4000-8000-000000000001', 'builder'),
  ('e6000000-0000-4000-8000-000000000002', 'employee'),
  ('e6000000-0000-4000-8000-000000000003', 'client');
INSERT INTO public.clients (slug, name, status) VALUES ('si-alpha', 'SI Alpha', 'active'), ('si-beta', 'SI Beta', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('e6000000-0000-4000-8000-000000000003', 'si-alpha');
INSERT INTO public.engagements (id, client_slug, cycle_number, engagement_type, status, start_date) VALUES
  ('e6100000-0000-4000-8000-000000000001', 'si-alpha', 1, 'standard_sprint', 'active', '2026-11-02'),
  ('e6100000-0000-4000-8000-000000000002', 'si-beta', 1, 'standard_sprint', 'active', '2026-11-02');

CREATE TEMP TABLE r AS SELECT NULL::uuid AS id;
GRANT ALL ON r TO authenticated;

-- ---------------------------------------------------------------- structure (1-4)
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN (
  'public.support_requests'::regclass, 'public.support_history'::regclass, 'public.support_assignment_history'::regclass)),
  'row rules are on for the three support tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name LIKE 'support_%' AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on the support tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name LIKE 'support_%' AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0,
  'signed-in users only read; writes go through the checked functions');
SELECT ok(NOT has_function_privilege('authenticated', 'public.support_is_staff(uuid)', 'EXECUTE'), 'the staff helper is not callable by signed-in users');

-- ---------------------------------------------------------------- employee records (5-12)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000002', true);
UPDATE r SET id = public.create_support_request('si-alpha', 'e6100000-0000-4000-8000-000000000001', ' Launch date ', 'When do the first ads go live?', 'slack', '2026-11-12');
SELECT is((SELECT accountable_user_id::text || ' ' || status || ' ' || revision || ' ' || subject FROM public.support_requests WHERE id = (SELECT id FROM r)),
  'e6000000-0000-4000-8000-000000000002 open 1 Launch date', 'the question is recorded, open, with the recorder as the accountable owner');
SELECT is((SELECT event_kind || ' ' || revision FROM public.support_history WHERE request_id = (SELECT id FROM r)), 'question 1',
  'the question is the first history entry');
SELECT is(public.create_support_request('si-alpha', NULL, 'Launch date', 'When do the first ads go live?', 'email', '2026-11-20'), (SELECT id FROM r),
  'the same subject and question for the same client returns the existing request');
SELECT is((SELECT count(*)::int FROM public.support_history WHERE request_id = (SELECT id FROM r)), 1, 'a repeat adds no history');
SELECT throws_ok($$SELECT public.create_support_request('si-alpha', 'e6100000-0000-4000-8000-000000000002', 'X', 'Y', 'call', '2026-11-12')$$,
  '22023', NULL, 'an engagement of another client is refused');
SELECT throws_ok($$SELECT public.create_support_request('si-alpha', NULL, 'X', 'Y', 'fax', '2026-11-12')$$, '22023', NULL, 'an unknown channel is refused');
SELECT throws_ok($$SELECT public.create_support_request('si-alpha', NULL, 'X', 'Y', 'call', '2026-11-12', 'e6000000-0000-4000-8000-000000000003')$$,
  '22023', NULL, 'a client login cannot be the accountable owner');
SELECT throws_ok($$SELECT public.create_support_request('no-such-client', NULL, 'X', 'Y', 'call', '2026-11-12')$$, 'P0002', NULL, 'an unknown client is not found');

-- ---------------------------------------------------------------- updates, resolve, reopen (13-21)
SELECT is(public.record_support_event((SELECT id FROM r), 1, 'response', 'Told them Thursday on Slack', '2026-11-13'), 2, 'a staff update moves to revision 2');
SELECT is((SELECT status || ' ' || next_update_target FROM public.support_requests WHERE id = (SELECT id FROM r)), 'open 2026-11-13',
  'an update keeps the request open and moves the next update date');
SELECT throws_ok($$SELECT public.record_support_event((SELECT id FROM r), 1, 'resolution', 'Stale screen')$$, '40001', NULL, 'a stale revision is refused');
SELECT throws_ok($$SELECT public.record_support_event((SELECT id FROM r), 2, 'reopen', 'Not resolved yet')$$, '22023', NULL, 'an open request cannot be reopened');
SELECT throws_ok($$SELECT public.record_support_event((SELECT id FROM r), 2, 'response', '   ')$$, '22023', NULL, 'an empty update is refused');
SELECT is(public.record_support_event((SELECT id FROM r), 2, 'resolution', 'Ads went live'), 3, 'the request is resolved at revision 3');
SELECT throws_ok($$SELECT public.record_support_event((SELECT id FROM r), 3, 'resolution', 'Again')$$, '22023', NULL, 'a resolved request cannot be resolved again');
SELECT is(public.record_support_event((SELECT id FROM r), 3, 'reopen', 'Client asked again about the second batch'), 4, 'a resolved request is reopened');
SELECT is((SELECT string_agg(event_kind || ':' || status, ',' ORDER BY revision) FROM public.support_history WHERE request_id = (SELECT id FROM r)),
  'question:open,response:open,resolution:resolved,reopen:open', 'history keeps every step with the status after it');

-- ---------------------------------------------------------------- assignment (22-24)
SELECT throws_ok($$SELECT public.assign_support_request((SELECT id FROM r), 4, 'e6000000-0000-4000-8000-000000000003', 'backup')$$, '22023', NULL,
  'a client login cannot be assigned');
SELECT is(public.assign_support_request((SELECT id FROM r), 4, 'e6000000-0000-4000-8000-000000000001', 'backup'), 5, 'the builder is named as backup');
SELECT is((SELECT backup_user_id::text || ' ' || (SELECT count(*) FROM public.support_assignment_history WHERE request_id = (SELECT id FROM r))
             FROM public.support_requests WHERE id = (SELECT id FROM r)),
  'e6000000-0000-4000-8000-000000000001 2', 'the backup is set and the assignment is in the history');

-- ---------------------------------------------------------------- client (25-28)
SELECT set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.support_requests) + (SELECT count(*)::int FROM public.support_history)
          + (SELECT count(*)::int FROM public.support_assignment_history), 0, 'a client reads no support rows, even about its own client');
SELECT throws_ok($$SELECT public.create_support_request('si-alpha', NULL, 'Client try', 'From the client', 'other', '2026-11-12')$$, '42501', NULL,
  'a client cannot record a request');
SELECT throws_ok($$SELECT public.record_support_event((SELECT id FROM r), 5, 'response', 'Client reply')$$, '42501', NULL, 'a client cannot add an update');
SELECT throws_ok($$SELECT public.assign_support_request((SELECT id FROM r), 5, 'e6000000-0000-4000-8000-000000000003', 'backup')$$, '42501', NULL,
  'a client cannot assign');

-- ---------------------------------------------------------------- direct writes and immutability (29-30)
SELECT throws_ok($$INSERT INTO public.support_history (request_id, event_kind, body, status, revision, actor_id)
                   VALUES ((SELECT id FROM r), 'response', 'direct', 'open', 9, 'e6000000-0000-4000-8000-000000000003')$$, '42501', NULL,
  'a signed-in user cannot write history directly');
RESET role;
SELECT throws_ok($$UPDATE public.support_history SET body = 'changed'$$, '23514', NULL, 'support history cannot be changed');

SELECT * FROM finish();
ROLLBACK;
