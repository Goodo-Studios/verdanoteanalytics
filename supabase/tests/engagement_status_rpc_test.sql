-- set_engagement_status (migration 20261216110001).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: the function is SECURITY DEFINER with an empty search_path and only
-- authenticated (and service_role) can execute it; anon and a client are refused; staff
-- cancel a planned cycle and close an active one, with timestamps, reason and actor; every
-- other move is refused with 22023 and leaves the row untouched; an unknown cycle is
-- P0002; a status change written straight to the table by a signed-in user is refused
-- while other columns still update and the kickoff function still works. All rows are
-- made up.

BEGIN;
SELECT plan(32);

INSERT INTO auth.users (id, email) VALUES
  ('e6000000-0000-4000-8000-000000000001', 'sr-builder@example.test'),
  ('e6000000-0000-4000-8000-000000000002', 'sr-employee@example.test'),
  ('e6000000-0000-4000-8000-000000000003', 'sr-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e6000000-0000-4000-8000-000000000001', 'builder'),
  ('e6000000-0000-4000-8000-000000000002', 'employee'),
  ('e6000000-0000-4000-8000-000000000003', 'client');
INSERT INTO public.clients (slug, name, status) VALUES ('sr-alpha', 'SR Alpha', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('e6000000-0000-4000-8000-000000000003', 'sr-alpha');

-- One row per state. 'custom' type keeps clear of the one-active-sprint index.
INSERT INTO public.engagements (id, client_slug, cycle_number, engagement_type, status, start_date) VALUES
  ('e6100000-0000-4000-8000-000000000001', 'sr-alpha', 1, 'custom', 'planned', NULL),
  ('e6100000-0000-4000-8000-000000000002', 'sr-alpha', 2, 'custom', 'planned', NULL),
  ('e6100000-0000-4000-8000-000000000003', 'sr-alpha', 3, 'custom', 'active', '2026-11-02'),
  ('e6100000-0000-4000-8000-000000000004', 'sr-alpha', 4, 'custom', 'active', '2026-11-02'),
  ('e6100000-0000-4000-8000-000000000005', 'sr-alpha', 5, 'custom', 'closed', '2026-09-01'),
  ('e6100000-0000-4000-8000-000000000006', 'sr-alpha', 6, 'custom', 'cancelled', NULL),
  ('e6100000-0000-4000-8000-000000000007', 'sr-alpha', 7, 'custom', 'planned', NULL);

-- ---------------------------------------------------------------- structure (1-6)
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.set_engagement_status(uuid,text,text)'::regprocedure),
  'set_engagement_status is SECURITY DEFINER');
SELECT is((SELECT array_to_string(proconfig, ',') FROM pg_proc WHERE oid = 'public.set_engagement_status(uuid,text,text)'::regprocedure),
  'search_path=""', 'its search_path is empty');
SELECT ok(NOT has_function_privilege('anon', 'public.set_engagement_status(uuid,text,text)', 'EXECUTE'),
  'anon cannot execute it');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                       WHERE p.oid = 'public.set_engagement_status(uuid,text,text)'::regprocedure AND a.grantee = 0)
          AND (SELECT proacl IS NOT NULL FROM pg_proc WHERE oid = 'public.set_engagement_status(uuid,text,text)'::regprocedure),
  'PUBLIC holds no execute privilege on it');
SELECT ok(has_function_privilege('authenticated', 'public.set_engagement_status(uuid,text,text)', 'EXECUTE'),
  'authenticated can execute it');
SELECT ok(has_function_privilege('service_role', 'public.set_engagement_status(uuid,text,text)', 'EXECUTE'),
  'service_role can execute it');

-- ---------------------------------------------------------------- anon (7)
SET LOCAL role anon;
SELECT throws_ok($$SELECT public.set_engagement_status('e6100000-0000-4000-8000-000000000003', 'closed')$$,
  '42501', NULL, 'anon cannot call it');
RESET role;

-- ---------------------------------------------------------------- client (8-10)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000003', true);
SELECT throws_ok($$SELECT public.set_engagement_status('e6100000-0000-4000-8000-000000000003', 'closed')$$,
  '42501', NULL, 'a client cannot close an engagement of its own client');
SELECT throws_ok($$SELECT public.set_engagement_status('e6100000-0000-4000-8000-000000000001', 'cancelled')$$,
  '42501', NULL, 'a client cannot cancel an engagement of its own client');
RESET role;
SELECT is((SELECT status FROM public.engagements WHERE id = 'e6100000-0000-4000-8000-000000000003'), 'active',
  'the client attempts changed nothing');

-- ---------------------------------------------------------------- employee: allowed moves (11-17)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000002', true);
CREATE TEMP TABLE r_cancel AS
  SELECT * FROM public.set_engagement_status('e6100000-0000-4000-8000-000000000001', 'cancelled', '  Client paused the project  ');
SELECT is((SELECT status FROM r_cancel), 'cancelled', 'staff cancel a planned engagement and get the row back');
SELECT is((SELECT status_reason FROM r_cancel), 'Client paused the project', 'the reason is trimmed and stored');
SELECT ok((SELECT cancelled_at IS NOT NULL AND closed_at IS NULL FROM r_cancel), 'cancelled_at is stamped and closed_at is not');
SELECT is((SELECT status_changed_by FROM r_cancel), 'e6000000-0000-4000-8000-000000000002'::uuid, 'the acting staff member is recorded');

CREATE TEMP TABLE r_close AS
  SELECT * FROM public.set_engagement_status('e6100000-0000-4000-8000-000000000003', 'closed');
SELECT is((SELECT status FROM r_close), 'closed', 'staff close an active engagement');
SELECT ok((SELECT closed_at IS NOT NULL AND cancelled_at IS NULL AND status_reason IS NULL FROM r_close),
  'closed_at is stamped, cancelled_at and the reason stay empty');
SELECT is((SELECT status FROM public.engagements WHERE id = 'e6100000-0000-4000-8000-000000000003'), 'closed',
  'the closed status is stored on the table');

-- ---------------------------------------------------------------- builder (18)
SELECT set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000001', true);
SELECT is((SELECT status FROM public.set_engagement_status('e6100000-0000-4000-8000-000000000004', 'closed', 'Delivered')), 'closed',
  'a builder can close an engagement too');

-- ---------------------------------------------------------------- illegal moves (19-26)
SELECT set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$SELECT public.set_engagement_status('e6100000-0000-4000-8000-000000000002', 'closed')$$,
  '22023', 'an engagement cannot move from planned to closed', 'planned cannot be closed (it never started)');
SELECT throws_ok($$SELECT public.set_engagement_status('e6100000-0000-4000-8000-000000000005', 'cancelled')$$,
  '22023', 'an engagement cannot move from closed to cancelled', 'a closed engagement cannot be cancelled');
SELECT throws_ok($$SELECT public.set_engagement_status('e6100000-0000-4000-8000-000000000005', 'closed')$$,
  '22023', 'an engagement cannot move from closed to closed', 'a closed engagement cannot be closed again');
SELECT throws_ok($$SELECT public.set_engagement_status('e6100000-0000-4000-8000-000000000006', 'closed')$$,
  '22023', 'an engagement cannot move from cancelled to closed', 'a cancelled engagement cannot be closed');
SELECT throws_ok($$SELECT public.set_engagement_status('e6100000-0000-4000-8000-000000000005', 'active')$$,
  '22023', NULL, 'nothing reopens a closed engagement');
SELECT throws_ok($$SELECT public.set_engagement_status('e6100000-0000-4000-8000-000000000002', 'bogus')$$,
  '22023', NULL, 'an unknown status is refused');
SELECT throws_ok($$SELECT public.set_engagement_status('e6100000-0000-4000-8000-000000000002', 'cancelled', repeat('x', 2001))$$,
  '22023', NULL, 'a reason over 2000 characters is refused');
SELECT throws_ok($$SELECT public.set_engagement_status('e6100000-0000-4000-8000-0000000000ff', 'closed')$$,
  'P0002', NULL, 'an unknown engagement is not found');
RESET role;
SELECT is((SELECT string_agg(status, ',' ORDER BY cycle_number) FROM public.engagements WHERE cycle_number IN (2, 5, 6)),
  'planned,closed,cancelled', 'refused moves left the rows untouched');

-- ---------------------------------------------------------------- direct writes (28-32)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$UPDATE public.engagements SET status = 'cancelled' WHERE id = 'e6100000-0000-4000-8000-000000000002'$$,
  '42501', NULL, 'staff cannot write a status straight to the table');
SELECT throws_ok($$UPDATE public.engagements SET closed_at = now() WHERE id = 'e6100000-0000-4000-8000-000000000002'$$,
  '42501', NULL, 'staff cannot stamp closed_at straight to the table');
SELECT lives_ok($$UPDATE public.engagements SET cycle_number = 20 WHERE id = 'e6100000-0000-4000-8000-000000000007'$$,
  'other columns still update directly');
SELECT is(public.record_engagement_kickoff('e6100000-0000-4000-8000-000000000007', '2026-12-01'), '2026-12-01'::date,
  'the kickoff function still moves a planned engagement to active');
RESET role;
SELECT is((SELECT status FROM public.engagements WHERE id = 'e6100000-0000-4000-8000-000000000007'), 'active',
  'the kickoff status change was not blocked by the guard');

SELECT * FROM finish();
ROLLBACK;
