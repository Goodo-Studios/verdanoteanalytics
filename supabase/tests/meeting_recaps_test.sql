-- Meeting recaps (migration 20261110000002, consolidation step 4a).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: row rules on, nothing for anon or public; record_meeting_recap is
-- service-role only and writes a recap with its items in one call; a client that
-- belongs to the recap's own client still reads nothing and cannot write a review;
-- builder and employee read; a staff review is recorded against the exact item
-- hash with the caller as reviewer, once per item, never for a question; history
-- cannot be changed or deleted. All rows are made up.

BEGIN;
SELECT plan(26);

INSERT INTO auth.users (id, email) VALUES
  ('e3000000-0000-4000-8000-000000000001', 'mr-builder@example.test'),
  ('e3000000-0000-4000-8000-000000000002', 'mr-employee@example.test'),
  ('e3000000-0000-4000-8000-000000000003', 'mr-client@example.test'),
  ('e3000000-0000-4000-8000-000000000004', 'mr-norole@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e3000000-0000-4000-8000-000000000001', 'builder'),
  ('e3000000-0000-4000-8000-000000000002', 'employee'),
  ('e3000000-0000-4000-8000-000000000003', 'client');
INSERT INTO public.clients (slug, name, status) VALUES ('mr-alpha', 'MR Alpha', 'active'), ('mr-beta', 'MR Beta', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('e3000000-0000-4000-8000-000000000003', 'mr-alpha');
INSERT INTO public.engagements (id, client_slug, cycle_number, status) VALUES
  ('e3000000-0000-4000-8000-0000000000e1', 'mr-alpha', 1, 'active'),
  ('e3000000-0000-4000-8000-0000000000e2', 'mr-beta', 1, 'active');

-- ---------------------------------------------------------------- structure (1-6)
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class
           WHERE oid IN ('public.meeting_recaps'::regclass, 'public.meeting_recap_items'::regclass, 'public.meeting_recap_reviews'::regclass)),
  'row rules are on for the three recap tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name LIKE 'meeting_recap%' AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on the recap tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name IN ('meeting_recaps', 'meeting_recap_items') AND grantee = 'authenticated'
              AND privilege_type <> 'SELECT'), 0,
  'signed-in users can only read recaps and items (writes go through the service role)');
SELECT ok(NOT has_function_privilege('authenticated', 'public.record_meeting_recap(jsonb,jsonb)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.record_meeting_recap(jsonb,jsonb)', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.record_meeting_recap(jsonb,jsonb)', 'EXECUTE'),
  'only the service role can record a recap');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'meeting_recap%'
            AND (qual IS NULL OR qual = 'true') AND cmd <> 'INSERT'), 0, 'no open read policy on the recap tables');
SELECT ok(NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.record_meeting_recap(jsonb,jsonb)'::regprocedure),
  'record_meeting_recap is not SECURITY DEFINER');

-- ---------------------------------------------------------------- recording (7-11)
SET LOCAL role service_role;
CREATE TEMP TABLE r AS SELECT public.record_meeting_recap(
  '{"client_slug":"mr-alpha","engagement_id":"e3000000-0000-4000-8000-0000000000e1","transcript_id":"tr_pg","source_version":"fireflies-v1-x","status":"prepared","evidence_status":"completed","model":"test-model","clean_excerpts":2,"withheld_excerpts":1,"rejected_candidates":0,"requested_by":"e3000000-0000-4000-8000-000000000002"}'::jsonb,
  '[{"position":0,"kind":"action","summary":"Send the brief","citations":[{"excerpt_id":"e1","start":0,"end":5,"quote":"Send."}],"date_status":"missing","missing_information":["due_date"],"proposed_action":"add_internal_note","item_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
    {"position":1,"kind":"question","summary":"Who approves?","citations":[{"excerpt_id":"e1","start":0,"end":5,"quote":"Who?"}],"date_status":"not_applicable","item_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}]'::jsonb
) AS id;
GRANT SELECT ON r TO authenticated;
CREATE TEMP TABLE ri AS SELECT id, item_hash FROM public.meeting_recap_items WHERE position = 0 AND recap_id = (SELECT id FROM r);
GRANT SELECT ON ri TO authenticated;
SELECT is((SELECT count(*)::int FROM public.meeting_recap_items WHERE recap_id = (SELECT id FROM r)), 2, 'a prepared recap is recorded with its items');
SELECT throws_ok($$SELECT public.record_meeting_recap(
  '{"client_slug":"mr-alpha","engagement_id":"e3000000-0000-4000-8000-0000000000e2","transcript_id":"tr_pg","status":"unavailable","evidence_status":"not_found","requested_by":"e3000000-0000-4000-8000-000000000002"}'::jsonb)$$,
  '22023', NULL, 'an engagement of another client is refused');
SELECT throws_ok($$SELECT public.record_meeting_recap(
  '{"client_slug":"mr-alpha","transcript_id":"tr_pg","status":"unavailable","evidence_status":"not_found","requested_by":"e3000000-0000-4000-8000-000000000002"}'::jsonb,
  '[{"position":0,"kind":"decision","summary":"x","citations":[{}],"date_status":"not_applicable","item_hash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}]'::jsonb)$$,
  '22023', NULL, 'only a prepared recap can have items');
SELECT throws_ok($$SELECT public.record_meeting_recap(
  '{"client_slug":"mr-alpha","transcript_id":"tr_pg","status":"prepared","requested_by":"e3000000-0000-4000-8000-000000000002"}'::jsonb)$$,
  '23514', NULL, 'a prepared recap needs a source version, evidence and a model');
SELECT lives_ok($$SELECT public.record_meeting_recap(
  '{"client_slug":"mr-beta","transcript_id":"tr_pg2","status":"quarantined","evidence_status":"completed","source_version":"v","withheld_excerpts":3,"requested_by":"e3000000-0000-4000-8000-000000000001"}'::jsonb)$$,
  'an outcome without content is recorded');
RESET role;

-- ---------------------------------------------------------------- client and no role (12-17)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.meeting_recaps), 0, 'a client of the same client reads no recaps');
SELECT is((SELECT count(*)::int FROM public.meeting_recap_items), 0, 'a client reads no recap items');
SELECT throws_ok($$INSERT INTO public.meeting_recap_reviews (item_id, decision, confirmed_item_hash, note)
  SELECT id, 'confirmed', item_hash, 'x' FROM ri$$, NULL, NULL, 'a client cannot write a review, even with the item id and hash');
SELECT throws_ok($$SELECT public.record_meeting_recap('{}'::jsonb)$$, '42501', NULL, 'a client cannot record a recap');
SELECT set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000004', true);
SELECT is((SELECT count(*)::int FROM public.meeting_recaps), 0, 'a login with no role reads no recaps');
SELECT throws_ok($$INSERT INTO public.meeting_recap_items (recap_id, position, kind, summary, citations, date_status, item_hash)
  VALUES ((SELECT id FROM r), 9, 'decision', 'x', '[{}]', 'not_applicable', 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd')$$,
  '42501', NULL, 'nobody signed in can write recap items');

-- ---------------------------------------------------------------- staff (18-26)
SELECT set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000002', true);
SELECT is((SELECT count(*)::int FROM public.meeting_recaps), 2, 'an employee reads every recap');
SELECT throws_ok($$INSERT INTO public.meeting_recap_reviews (item_id, decision, confirmed_item_hash, note)
  SELECT id, 'confirmed', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'ok' FROM public.meeting_recap_items WHERE position = 0$$,
  '40001', NULL, 'a review against an old hash is refused');
SELECT throws_ok($$INSERT INTO public.meeting_recap_reviews (item_id, decision, confirmed_item_hash, note)
  SELECT id, 'confirmed', item_hash, 'ok' FROM public.meeting_recap_items WHERE position = 1$$,
  '23514', NULL, 'a question is not reviewed');
SELECT lives_ok($$INSERT INTO public.meeting_recap_reviews (item_id, decision, confirmed_item_hash, note, reviewer_id)
  SELECT id, 'confirmed', item_hash, 'Matches the call', 'e3000000-0000-4000-8000-000000000001' FROM public.meeting_recap_items WHERE position = 0$$,
  'an employee confirms an action against its hash');
SELECT is((SELECT reviewer_id FROM public.meeting_recap_reviews), 'e3000000-0000-4000-8000-000000000002'::uuid,
  'the reviewer is always the caller');
SELECT set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000001', true);
SELECT throws_ok($$INSERT INTO public.meeting_recap_reviews (item_id, decision, confirmed_item_hash, note)
  SELECT id, 'rejected', item_hash, 'no' FROM public.meeting_recap_items WHERE position = 0$$,
  '23505', NULL, 'an item is reviewed once');
SELECT is((SELECT count(*)::int FROM public.meeting_recap_reviews), 1, 'a builder reads the review');
RESET role;
SELECT throws_ok($$UPDATE public.meeting_recap_reviews SET note = 'changed'$$, '23514', NULL, 'a review cannot be changed');
SELECT throws_ok($$DELETE FROM public.meeting_recaps WHERE id = (SELECT id FROM r)$$, '23514', NULL, 'a recap cannot be deleted');

SELECT * FROM finish();
ROLLBACK;
