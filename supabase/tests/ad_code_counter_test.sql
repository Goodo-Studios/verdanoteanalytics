-- Ad code counter used by the Ad Name Generator page (migration 20261101000005).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- peek_ad_code and claim_ad_code are SECURITY DEFINER and executable by authenticated,
-- so the role check inside each body is the wall. This test checks every caller kind:
--   * builder and employee can peek and claim; peek never moves the counter
--   * a client and a signed-in user with no role are refused by both
--   * anon and public cannot execute either function, service_role can

BEGIN;
SELECT plan(16);

INSERT INTO auth.users (id, email) VALUES
  ('c1111111-1111-1111-1111-111111111111', 'adcode-builder@example.test'),
  ('c2222222-2222-2222-2222-222222222222', 'adcode-employee@example.test'),
  ('c3333333-3333-3333-3333-333333333333', 'adcode-client@example.test'),
  ('c4444444-4444-4444-4444-444444444444', 'adcode-norole@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c1111111-1111-1111-1111-111111111111', 'builder'),
  ('c2222222-2222-2222-2222-222222222222', 'employee'),
  ('c3333333-3333-3333-3333-333333333333', 'client');

UPDATE public.ad_name_counter SET value = 300000 WHERE id = 1;

-- ---------------------------------------------------------------- grants
SELECT ok(NOT has_function_privilege('anon', 'public.peek_ad_code()', 'EXECUTE'), 'anon cannot execute peek_ad_code');
SELECT ok(NOT has_function_privilege('anon', 'public.claim_ad_code()', 'EXECUTE'), 'anon cannot execute claim_ad_code');
SELECT ok(has_function_privilege('service_role', 'public.claim_ad_code()', 'EXECUTE'), 'service_role can execute claim_ad_code');
SELECT ok(
  (SELECT bool_and(p.prosecdef AND p.prosrc ~ 'has_role\(auth\.uid\(\), ''builder''' AND p.prosrc ~ 'has_role\(auth\.uid\(\), ''employee''')
     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('peek_ad_code', 'claim_ad_code')),
  'both functions are SECURITY DEFINER and check builder or employee in the body');

SET LOCAL role authenticated;

-- ---------------------------------------------------------------- client and no role
SELECT set_config('request.jwt.claim.sub', 'c3333333-3333-3333-3333-333333333333', true);
SELECT throws_ok($$SELECT public.peek_ad_code()$$, '42501', NULL, 'client cannot peek');
SELECT throws_ok($$SELECT public.claim_ad_code()$$, '42501', NULL, 'client cannot claim');
SELECT is((SELECT count(*)::int FROM public.ad_name_counter), 0, 'client cannot read the counter table');

SELECT set_config('request.jwt.claim.sub', 'c4444444-4444-4444-4444-444444444444', true);
SELECT throws_ok($$SELECT public.peek_ad_code()$$, '42501', NULL, 'a signed-in user with no role cannot peek');
SELECT throws_ok($$SELECT public.claim_ad_code()$$, '42501', NULL, 'a signed-in user with no role cannot claim');

-- ---------------------------------------------------------------- builder
SELECT set_config('request.jwt.claim.sub', 'c1111111-1111-1111-1111-111111111111', true);
SELECT is(public.peek_ad_code(), 300001::bigint, 'builder peeks the next code');
SELECT is(public.peek_ad_code(), 300001::bigint, 'peeking again does not move the counter');
SELECT is(public.claim_ad_code(), 300001::bigint, 'builder claims the previewed code');

-- ---------------------------------------------------------------- employee
SELECT set_config('request.jwt.claim.sub', 'c2222222-2222-2222-2222-222222222222', true);
SELECT is(public.peek_ad_code(), 300002::bigint, 'employee peeks the following code');
SELECT is(public.claim_ad_code(), 300002::bigint, 'employee claims it');
SELECT is(public.claim_ad_code(), 300003::bigint, 'every claim issues a new code');

RESET role;
SELECT is((SELECT value FROM public.ad_name_counter WHERE id = 1), 300003::bigint, 'the refused calls spent nothing');

SELECT * FROM finish();
ROLLBACK;
