-- Per-person suggestion dismissals (migration 20261217010001).
-- Staff hide and restore their own suggestions, see nobody else's, and a client has no access.
--
-- Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(9);

INSERT INTO auth.users (id, email) VALUES
  ('c1700000-0000-4000-8000-0000000000e1', 'ds-staff1@example.test'),
  ('c1700000-0000-4000-8000-0000000000e2', 'ds-staff2@example.test'),
  ('c1700000-0000-4000-8000-0000000000e3', 'ds-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c1700000-0000-4000-8000-0000000000e1', 'builder'),
  ('c1700000-0000-4000-8000-0000000000e2', 'employee'),
  ('c1700000-0000-4000-8000-0000000000e3', 'client');
INSERT INTO public.dismissed_suggestions (user_id, surface, item_key) VALUES
  ('c1700000-0000-4000-8000-0000000000e2', 'staff_reconciliation', 'other@example.test:no_login');

SELECT has_table('public', 'dismissed_suggestions', 'the table exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.dismissed_suggestions'::regclass),
  'row level security is on');

-- Builder
SELECT set_config('request.jwt.claims', json_build_object('sub', 'c1700000-0000-4000-8000-0000000000e1', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', 'c1700000-0000-4000-8000-0000000000e1', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$INSERT INTO public.dismissed_suggestions (surface, item_key) VALUES ('staff_reconciliation', 'a@example.test:no_login')$$,
  'staff dismiss a suggestion (user_id defaults to themselves)');
SELECT is((SELECT count(*)::int FROM public.dismissed_suggestions), 1, 'staff see only their own dismissals');
SELECT throws_ok(
  $$INSERT INTO public.dismissed_suggestions (user_id, surface, item_key) VALUES ('c1700000-0000-4000-8000-0000000000e2', 'staff_reconciliation', 'b@example.test:no_login')$$,
  '42501', NULL, 'staff cannot dismiss on behalf of someone else');
DELETE FROM public.dismissed_suggestions WHERE item_key = 'other@example.test:no_login';
SELECT is(
  (SELECT count(*)::int FROM public.dismissed_suggestions WHERE item_key = 'a@example.test:no_login'), 1,
  'a delete aimed at another person''s row changes nothing of their own');
DELETE FROM public.dismissed_suggestions WHERE item_key = 'a@example.test:no_login';
SELECT is((SELECT count(*)::int FROM public.dismissed_suggestions), 0, 'staff restore their own suggestion by deleting the row');
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.dismissed_suggestions WHERE user_id = 'c1700000-0000-4000-8000-0000000000e2'), 1,
  'the other person''s dismissal is untouched');

-- Client
SELECT set_config('request.jwt.claims', json_build_object('sub', 'c1700000-0000-4000-8000-0000000000e3', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', 'c1700000-0000-4000-8000-0000000000e3', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$INSERT INTO public.dismissed_suggestions (surface, item_key) VALUES ('staff_reconciliation', 'c@example.test:no_login')$$,
  '42501', NULL, 'a client cannot dismiss anything');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
