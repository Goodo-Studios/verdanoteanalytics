-- The Ad Name Generator saves every name it issues (audit plan item 5.8).
--
-- Coda used to keep name_mappings current; it is gone, and ClickUp has no ad code or tag
-- fields. Matthew decided the generator itself is the source: claim_and_save_ad_name
-- spends the next code and stores the full name, its client and its six tags in
-- name_mappings in one transaction, so the tag resolver (name_mappings beats the parser)
-- finds them by (account_id, unique_code) even if the ad is renamed in Meta.
--
-- Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(17);

INSERT INTO auth.users (id, email) VALUES
  ('c5800000-0000-4000-8000-000000000001', 'gen-builder@example.test'),
  ('c5800000-0000-4000-8000-000000000002', 'gen-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c5800000-0000-4000-8000-000000000001', 'builder'),
  ('c5800000-0000-4000-8000-000000000002', 'client');
INSERT INTO public.ad_accounts (id, name) VALUES ('act_c58', 'C58 client');

UPDATE public.ad_name_counter SET value = 400000 WHERE id = 1;

-- ---------------------------------------------------------------- shape and grants
SELECT has_function('public', 'claim_and_save_ad_name', ARRAY['text', 'text', 'jsonb'],
  'claim_and_save_ad_name(text, text, jsonb) exists');
SELECT ok(NOT has_function_privilege('anon', 'public.claim_and_save_ad_name(text, text, jsonb)', 'EXECUTE'),
  'anon cannot call it');
SELECT ok(
  (SELECT p.prosecdef AND p.prosrc ~ 'has_role\(auth\.uid\(\), ''builder''' AND p.prosrc ~ 'has_role\(auth\.uid\(\), ''employee'''
     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'claim_and_save_ad_name'),
  'it is SECURITY DEFINER and checks builder or employee in the body');
SELECT has_column('public', 'name_mappings', 'ad_name', 'name_mappings keeps the full name');
SELECT has_column('public', 'name_mappings', 'source', 'name_mappings records where a row came from');

SET LOCAL role authenticated;

-- ---------------------------------------------------------------- a client is refused
SELECT set_config('request.jwt.claim.sub', 'c5800000-0000-4000-8000-000000000002', true);
SELECT throws_ok(
  $$SELECT public.claim_and_save_ad_name('act_c58', 'Video_Creator_UGCNative_Greens_TiredBy3pm_ChronicFatigue', '{}'::jsonb)$$,
  '42501', NULL, 'a client cannot claim and save');

-- ---------------------------------------------------------------- staff
SELECT set_config('request.jwt.claim.sub', 'c5800000-0000-4000-8000-000000000001', true);
SELECT is(
  public.claim_and_save_ad_name(
    'act_c58',
    'Video_Creator_UGCNative_Greens_TiredBy3pm_ChronicFatigue',
    '{"ad_type":"Video","person":"Creator","style":"UGCNative","product":"Greens","hook":"TiredBy3pm","theme":"Chronic Fatigue"}'::jsonb),
  '{"code": 400001, "unique_code": "GS400001", "ad_name": "GS400001_Video_Creator_UGCNative_Greens_TiredBy3pm_ChronicFatigue"}'::jsonb,
  'returns the claimed code and the full name');

RESET role;
SELECT results_eq(
  $$ SELECT account_id, unique_code, ad_name, ad_type, person, style, product, hook, theme, source, created_by::text
       FROM public.name_mappings WHERE unique_code = 'GS400001' $$,
  $$ VALUES ('act_c58', 'GS400001', 'GS400001_Video_Creator_UGCNative_Greens_TiredBy3pm_ChronicFatigue',
             'Video', 'Creator', 'UGCNative', 'Greens', 'TiredBy3pm', 'Chronic Fatigue', 'generator',
             'c5800000-0000-4000-8000-000000000001') $$,
  'the name, its client and its six tags are saved');
SELECT is((SELECT value FROM public.ad_name_counter WHERE id = 1), 400001::bigint, 'one code was spent');

-- ---------------------------------------------------------------- bad input spends nothing
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'c5800000-0000-4000-8000-000000000001', true);
SELECT throws_ok(
  $$SELECT public.claim_and_save_ad_name('act_c58', 'Video Creator', '{}'::jsonb)$$,
  '22023', NULL, 'a name part with a space is rejected');
SELECT throws_ok(
  $$SELECT public.claim_and_save_ad_name('act_c58', '', '{}'::jsonb)$$,
  '22023', NULL, 'an empty name is rejected');
SELECT throws_ok(
  $$SELECT public.claim_and_save_ad_name('act_c58', 'GS123456_Video', '{}'::jsonb)$$,
  '22023', NULL, 'a name that already carries a code is rejected');
SELECT throws_ok(
  $$SELECT public.claim_and_save_ad_name('act_nope', 'Video_Creator', '{}'::jsonb)$$,
  '22023', NULL, 'an unknown client is rejected');
SELECT throws_ok(
  $$SELECT public.claim_and_save_ad_name('act_c58', 'Video_Creator', '{"style":"UGC Native!"}'::jsonb)$$,
  '22023', NULL, 'a tag with symbols is rejected');
SELECT throws_ok(
  $$SELECT public.claim_and_save_ad_name('act_c58', 'Video_Creator', '{"colour":"Red"}'::jsonb)$$,
  '22023', NULL, 'an unknown tag key is rejected');

RESET role;
SELECT is((SELECT value FROM public.ad_name_counter WHERE id = 1), 400001::bigint, 'rejected calls spent no code');
SELECT is((SELECT count(*)::int FROM public.name_mappings WHERE account_id = 'act_c58'), 1, 'rejected calls saved nothing');

SELECT * FROM finish();
ROLLBACK;
