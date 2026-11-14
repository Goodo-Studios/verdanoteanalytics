-- get_user_role answers by privilege order (migration 20261207090001).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- A user with several roles always gets the most privileged one: builder, then employee, then the
-- rest. All rows are made up.

BEGIN;
SELECT plan(5);

INSERT INTO auth.users (id, email) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'gur-multi-a@example.test'),
  ('b0000000-0000-4000-8000-000000000002', 'gur-multi-b@example.test'),
  ('b0000000-0000-4000-8000-000000000003', 'gur-client@example.test'),
  ('b0000000-0000-4000-8000-000000000004', 'gur-none@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'client'),
  ('b0000000-0000-4000-8000-000000000001', 'employee'),
  ('b0000000-0000-4000-8000-000000000001', 'builder'),
  ('b0000000-0000-4000-8000-000000000002', 'editor'),
  ('b0000000-0000-4000-8000-000000000002', 'employee'),
  ('b0000000-0000-4000-8000-000000000003', 'client');

SELECT is(public.get_user_role('b0000000-0000-4000-8000-000000000001'), 'builder'::app_role,
  'builder wins over employee and client');
SELECT is(public.get_user_role('b0000000-0000-4000-8000-000000000002'), 'employee'::app_role,
  'employee wins over editor');
SELECT is(public.get_user_role('b0000000-0000-4000-8000-000000000003'), 'client'::app_role,
  'a single role is returned as is');
SELECT is(public.get_user_role('b0000000-0000-4000-8000-000000000004'), NULL::app_role,
  'a user with no role gets null');
SELECT is((SELECT prosrc ILIKE '%order by%' FROM pg_proc WHERE oid = 'public.get_user_role(uuid)'::regprocedure), true,
  'the function body orders its rows');

SELECT * FROM finish();
ROLLBACK;
