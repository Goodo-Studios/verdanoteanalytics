-- Client settings on the Team and settings page (step 5d, old dashboard Settings "Active
-- clients"). No new database objects: the page uses create_client (staff), update_client and
-- set_client_active (builder) from PR 133. This pins the rules the page depends on.
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: a client reads no clients and is refused all three functions; an employee adds a
-- client by hand (slug normalised, origin manual, active) but cannot show or hide or edit one;
-- a builder edits a hand-made client and switches it off the overview; a client kept by the
-- HQ sync (origin 'coda') cannot be renamed; slug and service line rules hold. Made-up rows.

BEGIN;
SELECT plan(14);

INSERT INTO auth.users (id, email) VALUES
  ('f5d20000-0000-4000-8000-000000000001', 'cs-builder@example.test'),
  ('f5d20000-0000-4000-8000-000000000002', 'cs-employee@example.test'),
  ('f5d20000-0000-4000-8000-000000000003', 'cs-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('f5d20000-0000-4000-8000-000000000001', 'builder'),
  ('f5d20000-0000-4000-8000-000000000002', 'employee'),
  ('f5d20000-0000-4000-8000-000000000003', 'client');
INSERT INTO public.clients (slug, name, status, origin, does_creators, does_production) VALUES
  ('cs-synced', 'CS Synced', 'active', 'coda', true, false);
INSERT INTO public.client_members (user_id, client_slug) VALUES ('f5d20000-0000-4000-8000-000000000003', 'cs-synced');

-- ---------------------------------------------------------------- client (1-4)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'f5d20000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.clients), 0, 'a client reads no client list, not even its own client');
SELECT throws_ok($$SELECT public.create_client('cs-new', 'CS New', true, false)$$, '42501', NULL, 'a client cannot add a client');
SELECT throws_ok($$SELECT public.update_client('cs-synced', 'Renamed', true, false)$$, '42501', NULL, 'a client cannot edit a client');
SELECT throws_ok($$SELECT public.set_client_active('cs-synced', false)$$, '42501', NULL, 'a client cannot hide a client');

-- ---------------------------------------------------------------- employee (5-9)
SELECT set_config('request.jwt.claim.sub', 'f5d20000-0000-4000-8000-000000000002', true);
SELECT is((public.create_client('  CS-Hand  ', ' CS Hand ', true, true))->>'slug', 'cs-hand', 'an employee adds a client; the slug is trimmed and lowercased');
SELECT is((SELECT origin || ' ' || active || ' ' || status || ' ' || name FROM public.clients WHERE slug = 'cs-hand'), 'manual true active CS Hand',
  'a client added by hand is manual, active and named without spaces');
SELECT throws_ok($$SELECT public.create_client('cs hand', 'X', true, false)$$, '22023', NULL, 'a slug with a space is refused');
SELECT throws_ok($$SELECT public.create_client('cs-none', 'X', false, false)$$, '22023', NULL, 'a client on no service line is refused');
SELECT throws_ok($$SELECT public.set_client_active('cs-hand', false)$$, '42501', NULL, 'an employee cannot hide a client');

-- ---------------------------------------------------------------- builder (10-14)
SELECT set_config('request.jwt.claim.sub', 'f5d20000-0000-4000-8000-000000000001', true);
SELECT throws_ok($$SELECT public.create_client('cs-hand', 'Again', true, false)$$, '23505', NULL, 'a taken slug is refused');
SELECT lives_ok($$SELECT public.update_client('cs-hand', 'CS Hand Renamed', false, true)$$, 'a builder edits a hand-made client');
SELECT is((SELECT name || ' ' || does_creators || ' ' || does_production FROM public.clients WHERE slug = 'cs-hand'), 'CS Hand Renamed false true',
  'the name and service lines are saved');
SELECT throws_ok($$SELECT public.update_client('cs-synced', 'Renamed', true, false)$$, '22023', NULL, 'a client kept by the HQ sync cannot be renamed here');
SELECT is((public.set_client_active('cs-hand', false))->>'active', 'false', 'a builder hides a client from the overview');

SELECT * FROM finish();
ROLLBACK;
