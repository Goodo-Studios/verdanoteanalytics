-- QA gates (migration 20261110120003, consolidation step 4b).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: row rules on, no grants for anon or public and no direct writes for
-- signed-in users; clients read nothing and every checked function refuses them;
-- the release gate lists what is missing; confirmations are once per revision;
-- the strategist and QA signoffs come from two different people; an open QA
-- return blocks signoffs and release, and signoffs made before its resolution no
-- longer count; release needs a https download link; history cannot be changed.
-- All rows are made up.

BEGIN;
SELECT plan(34);

INSERT INTO auth.users (id, email) VALUES
  ('e7000000-0000-4000-8000-000000000001', 'qa-builder@example.test'),
  ('e7000000-0000-4000-8000-000000000002', 'qa-employee@example.test'),
  ('e7000000-0000-4000-8000-000000000003', 'qa-client@example.test'),
  ('e7000000-0000-4000-8000-000000000004', 'qa-employee2@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e7000000-0000-4000-8000-000000000001', 'builder'),
  ('e7000000-0000-4000-8000-000000000002', 'employee'),
  ('e7000000-0000-4000-8000-000000000003', 'client'),
  ('e7000000-0000-4000-8000-000000000004', 'employee');
INSERT INTO public.clients (slug, name, status) VALUES ('qa-alpha', 'QA Alpha', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('e7000000-0000-4000-8000-000000000003', 'qa-alpha');
INSERT INTO public.engagements (id, client_slug, cycle_number, engagement_type, status, start_date) VALUES
  ('e7100000-0000-4000-8000-000000000001', 'qa-alpha', 1, 'standard_sprint', 'active', '2026-11-02');

-- ---------------------------------------------------------------- structure (1-4)
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN (
  'public.engagement_deliverable_confirmations'::regclass, 'public.engagement_deliverable_qa_returns'::regclass,
  'public.engagement_deliverable_signoffs'::regclass)), 'row rules are on for the three QA gate tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name IN ('engagement_deliverable_confirmations', 'engagement_deliverable_qa_returns', 'engagement_deliverable_signoffs')
              AND grantee IN ('anon', 'PUBLIC')), 0, 'anon and public hold no privileges on the QA gate tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name IN ('engagement_deliverable_confirmations', 'engagement_deliverable_qa_returns', 'engagement_deliverable_signoffs')
              AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0, 'signed-in users only read; writes go through the checked functions');
SELECT ok(NOT has_function_privilege('authenticated', 'public.deliverable_release_blockers(uuid)', 'EXECUTE'),
  'the release rule helper is not callable by signed-in users');

-- ---------------------------------------------------------------- setup and the gate (5)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e7000000-0000-4000-8000-000000000002', true);
CREATE TEMP TABLE d1 AS SELECT public.add_engagement_deliverable('e7100000-0000-4000-8000-000000000001', 'Final hero video', 'video') AS id;
GRANT SELECT ON d1 TO authenticated;
SELECT public.add_deliverable_revision((SELECT id FROM d1), 0, 'https://air.inc/review/h1');
SELECT is(public.deliverable_release_status((SELECT id FROM d1)),
  '{"ready": false, "blockers": ["client_not_approved", "team_not_confirmed", "strategist_signoff_missing", "qa_signoff_missing"]}'::jsonb,
  'the gate lists everything a new revision is missing');

-- ---------------------------------------------------------------- client wall (6-12)
SELECT set_config('request.jwt.claim.sub', 'e7000000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.engagement_deliverable_confirmations), 0, 'a client reads no confirmations');
SELECT is((SELECT count(*)::int FROM public.engagement_deliverable_qa_returns), 0, 'a client reads no QA returns');
SELECT is((SELECT count(*)::int FROM public.engagement_deliverable_signoffs), 0, 'a client reads no signoffs');
SELECT throws_ok($$SELECT public.deliverable_release_status((SELECT id FROM d1))$$, '42501', NULL, 'a client cannot read the release gate');
SELECT throws_ok($$SELECT public.confirm_deliverable_revision((SELECT id FROM d1), 1)$$, '42501', NULL, 'a client cannot confirm a revision');
SELECT throws_ok($$SELECT public.record_deliverable_signoff((SELECT id FROM d1), 1, 'qa_release')$$, '42501', NULL, 'a client cannot sign off');
SELECT throws_ok($$SELECT public.mark_deliverable_final_ready((SELECT id FROM d1), 1, 'https://air.inc/final/h1')$$, '42501', NULL, 'a client cannot release');

-- ---------------------------------------------------------------- confirmations and signoffs (13-19)
SELECT set_config('request.jwt.claim.sub', 'e7000000-0000-4000-8000-000000000002', true);
SELECT is(public.record_deliverable_client_decision((SELECT id FROM d1), 1, 'approved', 'call', 'Approved on the review call'), 'recorded',
  'staff record the client approval of revision 1');
SELECT throws_ok($$SELECT public.confirm_deliverable_revision((SELECT id FROM d1), 2)$$, '40001', NULL, 'only the current revision is confirmed');
SELECT is(public.confirm_deliverable_revision((SELECT id FROM d1), 1), 1, 'staff confirm revision 1');
SELECT throws_ok($$SELECT public.confirm_deliverable_revision((SELECT id FROM d1), 1)$$, '23505', NULL, 'a revision is confirmed once');
SELECT lives_ok($$SELECT public.record_deliverable_signoff((SELECT id FROM d1), 1, 'strategist_congruency')$$, 'one person signs off as strategist');
SELECT throws_ok($$SELECT public.record_deliverable_signoff((SELECT id FROM d1), 1, 'qa_release')$$, '22023', NULL,
  'the same person cannot also sign off QA');
SELECT set_config('request.jwt.claim.sub', 'e7000000-0000-4000-8000-000000000004', true);
SELECT lives_ok($$SELECT public.record_deliverable_signoff((SELECT id FROM d1), 1, 'qa_release')$$, 'another person signs off QA');

-- ---------------------------------------------------------------- ready, then a QA return (20-28)
SELECT is(public.deliverable_release_status((SELECT id FROM d1)) ->> 'ready', 'true', 'the revision is ready to send');
CREATE TEMP TABLE r1 AS SELECT public.return_deliverable_to_strategist((SELECT id FROM d1), 1, 'Logo is cut off at 0:12') AS id;
GRANT SELECT ON r1 TO authenticated;
SELECT is((SELECT stage FROM public.engagement_deliverables WHERE id = (SELECT id FROM d1)), 'internal_qa', 'a QA return puts the deliverable in internal QA');
SELECT is(public.deliverable_release_status((SELECT id FROM d1)), '{"ready": false, "blockers": ["qa_return_open"]}'::jsonb,
  'an open QA return blocks release');
SELECT throws_ok($$SELECT public.record_deliverable_signoff((SELECT id FROM d1), 1, 'qa_release')$$, '22023', NULL,
  'no signoff while a QA return is open');
SELECT throws_ok($$SELECT public.mark_deliverable_final_ready((SELECT id FROM d1), 1, 'https://air.inc/final/h1')$$, '22023', NULL,
  'no release while a QA return is open');
SELECT set_config('request.jwt.claim.sub', 'e7000000-0000-4000-8000-000000000002', true);
SELECT lives_ok($$SELECT public.resolve_deliverable_qa_return((SELECT id FROM r1), 'Logo moved inside the safe area')$$, 'staff resolve the return');
SELECT is((SELECT stage FROM public.engagement_deliverables WHERE id = (SELECT id FROM d1)), 'client_approved',
  'the deliverable goes back to where the client left it');
SELECT is(public.deliverable_release_status((SELECT id FROM d1)), '{"ready": false, "blockers": ["strategist_signoff_missing", "qa_signoff_missing"]}'::jsonb,
  'signoffs made before the resolution no longer count');
SELECT throws_ok($$SELECT public.resolve_deliverable_qa_return((SELECT id FROM r1), 'again')$$, '40001', NULL, 'a return is resolved once');

-- ---------------------------------------------------------------- release (29-34)
SELECT lives_ok($$SELECT public.record_deliverable_signoff((SELECT id FROM d1), 1, 'strategist_congruency')$$, 'fresh strategist signoff');
SELECT set_config('request.jwt.claim.sub', 'e7000000-0000-4000-8000-000000000004', true);
SELECT lives_ok($$SELECT public.record_deliverable_signoff((SELECT id FROM d1), 1, 'qa_release')$$, 'fresh QA signoff by another person');
SELECT throws_ok($$SELECT public.mark_deliverable_final_ready((SELECT id FROM d1), 1, 'http://air.inc/final/h1')$$, '23514', NULL,
  'the final download link must be https');
SELECT is(public.mark_deliverable_final_ready((SELECT id FROM d1), 1, 'https://air.inc/final/h1'), 'final_ready', 'staff mark the revision final');
SELECT throws_ok($$SELECT public.confirm_deliverable_revision((SELECT id FROM d1), 1)$$, '22023', NULL, 'a final deliverable is not confirmed again');
RESET role;
SELECT throws_ok($$UPDATE public.engagement_deliverable_signoffs SET signoff_kind = 'qa_release'$$, '23514', NULL, 'signoffs cannot be changed');

SELECT * FROM finish();
ROLLBACK;
