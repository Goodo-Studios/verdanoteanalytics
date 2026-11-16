-- create_api_key(key_name, api_key, scopes): staff only, known scopes only (audit 1.5, step 1).
--
-- Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(9);

INSERT INTO auth.users (id, email) VALUES
  ('c1500000-0000-4000-8000-000000000001', 'keys-employee@example.test'),
  ('c1500000-0000-4000-8000-000000000002', 'keys-client@example.test'),
  ('c1500000-0000-4000-8000-000000000003', 'keys-noRole@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c1500000-0000-4000-8000-000000000001', 'employee'),
  ('c1500000-0000-4000-8000-000000000002', 'client');

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END
$$ LANGUAGE plpgsql;

SELECT has_function('public', 'create_api_key', ARRAY['text', 'text', 'text[]'],
  'create_api_key(key_name, api_key, scopes) exists');

-- ---------------------------------------------------------------- staff
SELECT pg_temp.as_user('c1500000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.create_api_key('Zapier', 'vdn_000000000000000000000001', ARRAY['sync', 'read', 'read'])$$,
  'an employee creates a key with scopes');
SELECT throws_ok(
  $$SELECT public.create_api_key('Bad', 'vdn_000000000000000000000002', ARRAY['admin'])$$,
  '22023', 'unknown scope', 'an unknown scope is refused');
SELECT throws_ok(
  $$SELECT public.create_api_key('Empty', 'vdn_000000000000000000000003', ARRAY[]::text[])$$,
  '22023', 'choose at least one scope', 'no scopes is refused');
SELECT throws_ok(
  $$SELECT public.create_api_key('Short', 'abc', ARRAY['read'])$$,
  '22023', NULL, 'a key in the wrong format is refused');
RESET ROLE;

SELECT is(
  (SELECT permissions FROM public.api_keys WHERE name = 'Zapier' AND user_id = 'c1500000-0000-4000-8000-000000000001'),
  ARRAY['read', 'sync'], 'the key stores the chosen scopes, sorted and without duplicates');
SELECT is(
  (SELECT key_prefix FROM public.api_keys WHERE name = 'Zapier' AND user_id = 'c1500000-0000-4000-8000-000000000001'),
  'vdn_0011', 'the key prefix is stored, not the key');

-- ---------------------------------------------------------------- client and no role
SELECT pg_temp.as_user('c1500000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.create_api_key('Client', 'vdn_000000000000000000000004', ARRAY['read'])$$,
  '42501', NULL, 'a client cannot create a key');
RESET ROLE;

SELECT pg_temp.as_user('c1500000-0000-4000-8000-000000000003');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.create_api_key('Nobody', 'vdn_000000000000000000000005', ARRAY['read'])$$,
  '42501', NULL, 'a login with no role cannot create a key');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
