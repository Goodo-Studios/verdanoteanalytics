-- Client month hours and the database clock (migrations 20261214090001 and 20261214090002).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: an employee sees a client's total including other people's entries, while still seeing
-- only their own time_entries rows; a builder gets the same total; the period is [from, to) on the
-- entry's start, running entries and other clients are left out; a client login, a login with no
-- role and anon are refused; a bad period is refused; time_server_now() answers staff only.
-- All rows are made up.

BEGIN;
SELECT plan(13);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('ea100000-0000-4000-8000-000000000001', 'cm-builder@example.test', '{}'),
  ('ea100000-0000-4000-8000-000000000002', 'cm-alice@example.test', '{}'),
  ('ea100000-0000-4000-8000-000000000003', 'cm-bob@example.test', '{}'),
  ('ea100000-0000-4000-8000-000000000004', 'cm-client@example.test', '{}'),
  ('ea100000-0000-4000-8000-000000000005', 'cm-nobody@example.test', '{}');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('ea100000-0000-4000-8000-000000000001', 'builder'),
  ('ea100000-0000-4000-8000-000000000002', 'employee'),
  ('ea100000-0000-4000-8000-000000000003', 'employee'),
  ('ea100000-0000-4000-8000-000000000004', 'client');
INSERT INTO public.clients (slug, name, status) VALUES
  ('cm-alpha', 'CM Alpha', 'active'),
  ('cm-beta', 'CM Beta', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('ea100000-0000-4000-8000-000000000004', 'cm-alpha');
INSERT INTO public.time_people (id, email, name, user_id, source_role) VALUES
  ('ea200000-0000-4000-8000-000000000001', 'cm-alice@example.test', 'Alice', 'ea100000-0000-4000-8000-000000000002', 'member'),
  ('ea200000-0000-4000-8000-000000000002', 'cm-bob@example.test', 'Bob', 'ea100000-0000-4000-8000-000000000003', 'member');

-- Alice: 1 h in the period. Bob: 2 h 30 min 59 s in the period, 1 h just before it, 1 h starting
-- exactly at its end, a running timer, and 1 h on another client.
INSERT INTO public.time_entries (client_slug, category, person_id, description, start_at, end_at) VALUES
  ('cm-alpha', 'Editing', 'ea200000-0000-4000-8000-000000000001', 'Alice cut',   '2026-11-05 14:00Z', '2026-11-05 15:00Z'),
  ('cm-alpha', 'Editing', 'ea200000-0000-4000-8000-000000000002', 'Bob cut',     '2026-11-06 14:00Z', '2026-11-06 16:30:59Z'),
  ('cm-alpha', 'Editing', 'ea200000-0000-4000-8000-000000000002', 'Bob before',  '2026-10-31 20:00Z', '2026-10-31 21:00Z'),
  ('cm-alpha', 'Editing', 'ea200000-0000-4000-8000-000000000002', 'Bob at end',  '2026-12-01 05:00Z', '2026-12-01 06:00Z'),
  ('cm-beta',  'Editing', 'ea200000-0000-4000-8000-000000000002', 'Bob beta',    '2026-11-07 14:00Z', '2026-11-07 15:00Z'),
  ('cm-alpha', 'Editing', 'ea200000-0000-4000-8000-000000000002', 'Bob running', '2026-11-20 14:00Z', NULL);

SELECT ok(NOT has_function_privilege('anon', 'public.time_client_month_seconds(text, timestamptz, timestamptz)', 'EXECUTE'),
  'anon may not call time_client_month_seconds');
SELECT ok(NOT has_function_privilege('anon', 'public.time_server_now()', 'EXECUTE'),
  'anon may not call time_server_now');

-- ---------------------------------------------------------------- Alice (employee)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'ea100000-0000-4000-8000-000000000002', true);

SELECT is((SELECT count(*)::int FROM public.time_entries WHERE client_slug = 'cm-alpha'), 1,
  'an employee reads only her own entries through the table');
SELECT is(public.time_client_month_seconds('cm-alpha', '2026-11-01 05:00Z', '2026-12-01 05:00Z'), 12659::bigint,
  'an employee gets the total of everyone''s completed entries in the period (1 h + 2 h 30 min 59 s)');
SELECT is(public.time_client_month_seconds('cm-beta', '2026-11-01 05:00Z', '2026-12-01 05:00Z'), 3600::bigint,
  'another client is counted on its own');
SELECT is(public.time_client_month_seconds('cm-nope', '2026-11-01 05:00Z', '2026-12-01 05:00Z'), 0::bigint,
  'a client with no time totals 0');
SELECT throws_ok($$SELECT public.time_client_month_seconds('cm-alpha', '2026-12-01 05:00Z', '2026-11-01 05:00Z')$$, '22023', NULL,
  'a period that ends before it starts is refused');
SELECT cmp_ok(public.time_server_now(), '>', now() - interval '1 minute', 'staff get the database clock');

-- ---------------------------------------------------------------- builder
SELECT set_config('request.jwt.claim.sub', 'ea100000-0000-4000-8000-000000000001', true);
SELECT is(public.time_client_month_seconds('cm-alpha', '2026-11-01 05:00Z', '2026-12-01 05:00Z'), 12659::bigint,
  'a builder gets the same total');

-- ---------------------------------------------------------------- client, no role
SELECT set_config('request.jwt.claim.sub', 'ea100000-0000-4000-8000-000000000004', true);
SELECT throws_ok($$SELECT public.time_client_month_seconds('cm-alpha', '2026-11-01 05:00Z', '2026-12-01 05:00Z')$$, '42501', NULL,
  'a client login is refused');
SELECT throws_ok($$SELECT public.time_server_now()$$, '42501', NULL, 'a client login gets no database clock');
SELECT set_config('request.jwt.claim.sub', 'ea100000-0000-4000-8000-000000000005', true);
SELECT throws_ok($$SELECT public.time_client_month_seconds('cm-alpha', '2026-11-01 05:00Z', '2026-12-01 05:00Z')$$, '42501', NULL,
  'a login with no role is refused');

-- ---------------------------------------------------------------- anon
SET LOCAL role anon;
SELECT throws_ok($$SELECT public.time_client_month_seconds('cm-alpha', '2026-11-01 05:00Z', '2026-12-01 05:00Z')$$, '42501', NULL,
  'anon is refused');

RESET role;
SELECT * FROM finish();
ROLLBACK;
