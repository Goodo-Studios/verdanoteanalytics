-- Per-user rate limits for the paid browser-called functions (audit 8.7).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- check_api_rate_limit is keyed to API keys, so scrape-ad, vault-save, vault-frame-analyze and
-- ai-chat had no limit for a signed-in user. check_user_rate_limit counts calls per user and
-- per bucket in a fixed window and answers whether this call is allowed.
--
-- Checks: the function exists; calls up to the limit are allowed and the next is refused; a
-- second bucket and a second user have their own counts; the counter table has row rules on;
-- only the service role may call the function.

BEGIN;
SELECT plan(9);

SELECT has_function('public', 'check_user_rate_limit', ARRAY['uuid', 'text', 'integer', 'integer'],
  'check_user_rate_limit(uuid, text, integer, integer) exists');

SELECT ok(public.check_user_rate_limit('c8700000-0000-4000-8000-000000000001', 'ai-chat', 2, 3600),
  'first call in the window is allowed');
SELECT ok(public.check_user_rate_limit('c8700000-0000-4000-8000-000000000001', 'ai-chat', 2, 3600),
  'second call, at the limit, is allowed');
SELECT ok(NOT public.check_user_rate_limit('c8700000-0000-4000-8000-000000000001', 'ai-chat', 2, 3600),
  'third call, over the limit, is refused');

SELECT ok(public.check_user_rate_limit('c8700000-0000-4000-8000-000000000001', 'scrape-ad', 2, 3600),
  'another bucket for the same user has its own count');
SELECT ok(public.check_user_rate_limit('c8700000-0000-4000-8000-000000000002', 'ai-chat', 2, 3600),
  'another user has their own count');

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_rate_limit_counters'::regclass),
  'the counter table has row rules on');

SELECT ok(NOT has_function_privilege('anon', 'public.check_user_rate_limit(uuid, text, integer, integer)', 'EXECUTE'),
  'anon cannot call check_user_rate_limit');
SELECT ok(NOT has_function_privilege('authenticated', 'public.check_user_rate_limit(uuid, text, integer, integer)', 'EXECUTE'),
  'signed-in users cannot call check_user_rate_limit');

SELECT * FROM finish();
ROLLBACK;
