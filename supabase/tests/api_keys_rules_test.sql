-- API key rows: owners can list, revoke and delete their keys, nothing else (audit 1.5 steps 2 and 3).
--
-- The two-argument create_api_key (any signed-in user, no scope check) is dropped now that the live
-- screen uses the three-argument staff-only version (step 1). The FOR ALL owner rule let an owner
-- rewrite their key's scopes with a direct update; it is replaced by SELECT and DELETE for the owner
-- and an UPDATE that may only switch a key off (column grant on is_active, check is_active = false).
--
-- Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(11);

INSERT INTO auth.users (id, email) VALUES
  ('c1500000-0000-4000-8000-0000000000e1', 'ak-owner@example.test'),
  ('c1500000-0000-4000-8000-0000000000e2', 'ak-other@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c1500000-0000-4000-8000-0000000000e1', 'employee'),
  ('c1500000-0000-4000-8000-0000000000e2', 'employee');
INSERT INTO public.api_keys (id, user_id, name, key_hash, key_prefix, permissions, is_active) VALUES
  ('c1500000-0000-4000-8000-0000000000f1', 'c1500000-0000-4000-8000-0000000000e1', 'Mine', 'hash-f1', 'vdn_0000', ARRAY['read'], true),
  ('c1500000-0000-4000-8000-0000000000f2', 'c1500000-0000-4000-8000-0000000000e1', 'Mine too', 'hash-f2', 'vdn_0000', ARRAY['read'], true);

SELECT hasnt_function('public', 'create_api_key', ARRAY['text', 'text'], 'the two-argument create_api_key is gone');
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'api_keys' AND cmd = 'ALL'),
  0, 'no FOR ALL rule on api_keys');

SELECT set_config('request.jwt.claims', json_build_object('sub', 'c1500000-0000-4000-8000-0000000000e1', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', 'c1500000-0000-4000-8000-0000000000e1', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.api_keys), 2, 'the owner lists their keys');
SELECT throws_ok(
  $$UPDATE public.api_keys SET permissions = ARRAY['read', 'write', 'sync'] WHERE id = 'c1500000-0000-4000-8000-0000000000f1'$$,
  '42501', NULL, 'the owner cannot change a key''s scopes');
SELECT lives_ok(
  $$UPDATE public.api_keys SET is_active = false WHERE id = 'c1500000-0000-4000-8000-0000000000f1'$$,
  'the owner can revoke a key');
SELECT throws_ok(
  $$UPDATE public.api_keys SET is_active = true WHERE id = 'c1500000-0000-4000-8000-0000000000f1'$$,
  '42501', NULL, 'the owner cannot switch a revoked key back on');
SELECT throws_ok(
  $$INSERT INTO public.api_keys (user_id, name, key_hash, key_prefix, permissions) VALUES ('c1500000-0000-4000-8000-0000000000e1', 'Direct', 'hash-x', 'vdn_0000', ARRAY['sync'])$$,
  '42501', NULL, 'the owner cannot insert a key directly');
SELECT lives_ok(
  $$DELETE FROM public.api_keys WHERE id = 'c1500000-0000-4000-8000-0000000000f2'$$,
  'the owner can delete a key');
RESET ROLE;

SELECT is((SELECT is_active FROM public.api_keys WHERE id = 'c1500000-0000-4000-8000-0000000000f1'), false, 'the revoke was saved');
SELECT is((SELECT count(*)::int FROM public.api_keys WHERE id = 'c1500000-0000-4000-8000-0000000000f2'), 0, 'the delete was saved');

SELECT set_config('request.jwt.claims', json_build_object('sub', 'c1500000-0000-4000-8000-0000000000e2', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', 'c1500000-0000-4000-8000-0000000000e2', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.api_keys), 0, 'another user sees none of the owner''s keys');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
