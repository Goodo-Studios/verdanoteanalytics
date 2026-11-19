-- Agents name ads through Verdanote too (follow-up to audit 5.8).
--
-- Agents used to claim codes from a second counter in the goodo-hq-dashboard project, so
-- their names were never saved here and the two counters could issue the same code.
-- Matthew decided everything moves to Verdanote. Agents call claim_and_save_ad_name with
-- the service role key; the function accepts the service role as well as staff, saves the
-- row with no created_by, and still refuses clients and anonymous callers.
--
-- Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(5);

INSERT INTO public.ad_accounts (id, name) VALUES ('act_c58s', 'C58 service client');
UPDATE public.ad_name_counter SET value = 500000 WHERE id = 1;

SET LOCAL role service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT is(
  public.claim_and_save_ad_name('act_c58s', 'Static_NoTalent_TextForward_Greens_SaveTen_Busy',
    '{"ad_type":"Static","person":"NoTalent","style":"TextForward","product":"Greens","hook":"SaveTen","theme":"Busy"}'::jsonb),
  '{"code": 500001, "unique_code": "GS500001", "ad_name": "GS500001_Static_NoTalent_TextForward_Greens_SaveTen_Busy"}'::jsonb,
  'the service role (agents) can claim and save a name');

RESET role;
SELECT results_eq(
  $$ SELECT source, created_by::text, ad_name FROM public.name_mappings WHERE unique_code = 'GS500001' $$,
  $$ VALUES ('generator', NULL::text, 'GS500001_Static_NoTalent_TextForward_Greens_SaveTen_Busy') $$,
  'an agent name is saved as a generator row with no created_by');

-- A signed-in user with no role, even one whose request says service_role somewhere else,
-- is still refused: the check reads the verified JWT role, and a user token carries
-- "authenticated".
INSERT INTO auth.users (id, email) VALUES ('c5800000-0000-4000-8000-0000000000f1', 'gen-norole@example.test');
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'c5800000-0000-4000-8000-0000000000f1', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"c5800000-0000-4000-8000-0000000000f1"}', true);
SELECT throws_ok(
  $$SELECT public.claim_and_save_ad_name('act_c58s', 'Video_Creator', '{}'::jsonb)$$,
  '42501', NULL, 'a signed-in user with no role is still refused');

RESET role;
SELECT ok(NOT has_function_privilege('anon', 'public.claim_and_save_ad_name(text, text, jsonb)', 'EXECUTE'),
  'anon still cannot call it');
SELECT is((SELECT value FROM public.ad_name_counter WHERE id = 1), 500001::bigint, 'only the agent call spent a code');

SELECT * FROM finish();
ROLLBACK;
