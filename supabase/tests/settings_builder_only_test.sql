-- Employees cannot read stored secrets in settings (audit plan item 1.4).
--
-- settings holds meta_access_token, gemini_api_key and app_password. "Employee can read settings"
-- let any employee read them through PostgREST. No page reads settings directly: the Settings page
-- goes through the builder-only settings function, and every other reader is a service-role edge
-- function. Builders keep "Builder can manage settings".
--
-- Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(4);

INSERT INTO auth.users (id, email) VALUES
  ('c1400000-0000-4000-8000-000000000001', 'settings-builder@example.test'),
  ('c1400000-0000-4000-8000-000000000002', 'settings-employee@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c1400000-0000-4000-8000-000000000001', 'builder'),
  ('c1400000-0000-4000-8000-000000000002', 'employee');
INSERT INTO public.settings (key, value) VALUES ('c14_probe_secret', 'not-a-real-value')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'settings' AND policyname = 'Employee can read settings'),
  0, 'the employee read policy is gone');

SELECT set_config('request.jwt.claims', json_build_object('sub', 'c1400000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', 'c1400000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.settings), 0, 'an employee reads no settings rows');
SELECT is((SELECT count(*)::int FROM public.settings WHERE key = 'c14_probe_secret'), 0,
  'an employee cannot read a stored secret');
RESET ROLE;

SELECT set_config('request.jwt.claims', json_build_object('sub', 'c1400000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', 'c1400000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.settings WHERE key = 'c14_probe_secret'), 1,
  'a builder still reads settings');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
