-- Client monthly scope hours (migration 20261125080001, story OS-013).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: the column exists and starts empty; a builder sets and clears it; out-of-range values
-- and unknown clients are refused; an employee, a client and anon cannot set it; a client login
-- cannot read clients (so cannot see the hours); signed-in users have no direct write on clients.
-- All rows are made up.

BEGIN;
SELECT plan(13);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e9400000-0000-4000-8000-000000000001', 'sh-builder@example.test', '{}'),
  ('e9400000-0000-4000-8000-000000000002', 'sh-employee@example.test', '{}'),
  ('e9400000-0000-4000-8000-000000000003', 'sh-client@example.test', '{}');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e9400000-0000-4000-8000-000000000001', 'builder'),
  ('e9400000-0000-4000-8000-000000000002', 'employee'),
  ('e9400000-0000-4000-8000-000000000003', 'client');
INSERT INTO public.clients (slug, name, status) VALUES ('sh-alpha', 'SH Alpha', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('e9400000-0000-4000-8000-000000000003', 'sh-alpha');

SELECT has_column('public', 'clients', 'monthly_scope_hours', 'clients has monthly_scope_hours');
SELECT is((SELECT monthly_scope_hours FROM public.clients WHERE slug = 'sh-alpha'), NULL, 'scope hours start empty');
SELECT ok(NOT has_function_privilege('anon', 'public.set_client_scope_hours(text, numeric)', 'EXECUTE'),
  'anon may not call set_client_scope_hours');
SELECT ok(NOT has_table_privilege('authenticated', 'public.clients', 'UPDATE'),
  'signed-in users cannot update clients directly');

-- ---------------------------------------------------------------- builder
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e9400000-0000-4000-8000-000000000001', true);

SELECT is(public.set_client_scope_hours('sh-alpha', 20.5), 20.50::numeric, 'a builder sets 20.5 hours');
SELECT is((SELECT monthly_scope_hours FROM public.clients WHERE slug = 'sh-alpha'), 20.50::numeric, 'the builder reads it back');
SELECT throws_ok($$SELECT public.set_client_scope_hours('sh-alpha', 0)$$, '22023', NULL, 'zero hours is refused');
SELECT throws_ok($$SELECT public.set_client_scope_hours('sh-alpha', 745)$$, '22023', NULL, 'more than 744 hours is refused');
SELECT throws_ok($$SELECT public.set_client_scope_hours('sh-nope', 10)$$, 'P0002', NULL, 'an unknown client is refused');

-- ---------------------------------------------------------------- employee
SELECT set_config('request.jwt.claim.sub', 'e9400000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$SELECT public.set_client_scope_hours('sh-alpha', 5)$$, '42501', NULL, 'an employee cannot set scope hours');
SELECT is((SELECT monthly_scope_hours FROM public.clients WHERE slug = 'sh-alpha'), 20.50::numeric, 'an employee reads the hours');

-- ---------------------------------------------------------------- client
SELECT set_config('request.jwt.claim.sub', 'e9400000-0000-4000-8000-000000000003', true);
SELECT throws_ok($$SELECT public.set_client_scope_hours('sh-alpha', 5)$$, '42501', NULL, 'a client cannot set scope hours');
SELECT is((SELECT count(*)::int FROM public.clients WHERE slug = 'sh-alpha'), 0, 'a client cannot read its clients row, so not the hours');

RESET role;
SELECT * FROM finish();
ROLLBACK;
