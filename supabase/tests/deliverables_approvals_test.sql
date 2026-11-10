-- Deliverables and approvals (migration 20261110120002, consolidation step 4b).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: row rules on, no grants for anon or public and no direct writes for
-- signed-in users; clients read nothing (a client member of the engagement's own
-- client included) and every checked function refuses them; revisions follow the
-- version on screen; client decisions only on the current revision; included
-- rounds come from the engagement terms; a round beyond them opens an exception
-- that only a builder decides; approval versions are published once and decided
-- once; history cannot be changed. All rows are made up.

BEGIN;
SELECT plan(44);

INSERT INTO auth.users (id, email) VALUES
  ('e6000000-0000-4000-8000-000000000001', 'da-builder@example.test'),
  ('e6000000-0000-4000-8000-000000000002', 'da-employee@example.test'),
  ('e6000000-0000-4000-8000-000000000003', 'da-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e6000000-0000-4000-8000-000000000001', 'builder'),
  ('e6000000-0000-4000-8000-000000000002', 'employee'),
  ('e6000000-0000-4000-8000-000000000003', 'client');
INSERT INTO public.clients (slug, name, status) VALUES ('da-alpha', 'DA Alpha', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('e6000000-0000-4000-8000-000000000003', 'da-alpha');
INSERT INTO public.engagements (id, client_slug, cycle_number, engagement_type, status, start_date) VALUES
  ('e6100000-0000-4000-8000-000000000001', 'da-alpha', 1, 'standard_sprint', 'active', '2026-11-02'),
  ('e6100000-0000-4000-8000-000000000002', 'da-alpha', 2, 'custom', 'planned', NULL),
  ('e6100000-0000-4000-8000-000000000003', 'da-alpha', 3, 'retainer', 'closed', '2026-01-05');
INSERT INTO public.engagement_terms (engagement_id, client_slug, agreed_deliverables, created_by) VALUES
  ('e6100000-0000-4000-8000-000000000001', 'da-alpha', '[{"name": "Video ads", "quantity": 12, "clientRevisionRounds": 1}]', 'e6000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------- structure (1-4)
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN (
  'public.engagement_deliverables'::regclass, 'public.engagement_deliverable_revisions'::regclass,
  'public.engagement_deliverable_decisions'::regclass, 'public.engagement_deliverable_round_exceptions'::regclass,
  'public.approval_subjects'::regclass, 'public.approval_subject_versions'::regclass, 'public.approval_subject_decisions'::regclass)),
  'row rules are on for the seven deliverable and approval tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND (table_name LIKE 'engagement_deliverable%' OR table_name LIKE 'approval_subject%')
              AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on the deliverable and approval tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND (table_name LIKE 'engagement_deliverable%' OR table_name LIKE 'approval_subject%')
              AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0,
  'signed-in users only read; writes go through the checked functions');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('add_engagement_deliverable', 'add_deliverable_revision',
              'record_deliverable_client_decision', 'decide_deliverable_round_exception', 'withdraw_engagement_deliverable',
              'create_approval_subject', 'save_approval_draft', 'publish_approval_version', 'record_approval_decision')
              AND has_function_privilege('anon', p.oid, 'EXECUTE')), 0, 'anon cannot call any deliverable or approval function');
SELECT ok(NOT has_function_privilege('authenticated', 'public.deliverable_client_round_limit(uuid)', 'EXECUTE'),
  'the round limit helper is not callable by signed-in users');
SELECT ok(NOT has_function_privilege('authenticated', 'public.normalize_engagement_milestone_template(jsonb)', 'EXECUTE'),
  'the milestone template check is no longer callable by signed-in users');

-- ---------------------------------------------------------------- deliverables and revisions (5-11)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000002', true);
CREATE TEMP TABLE d1 AS SELECT public.add_engagement_deliverable('e6100000-0000-4000-8000-000000000001', 'Hook test video', 'video', 'Video ads') AS id;
CREATE TEMP TABLE d2 AS SELECT public.add_engagement_deliverable('e6100000-0000-4000-8000-000000000002', 'Custom static', 'image') AS id;
CREATE TEMP TABLE d3 AS SELECT public.add_engagement_deliverable('e6100000-0000-4000-8000-000000000001', 'Spare video', 'video') AS id;
GRANT SELECT ON d1, d2, d3 TO authenticated;
SELECT is((SELECT stage || ':' || current_revision FROM public.engagement_deliverables WHERE id = (SELECT id FROM d1)), 'not_started:0',
  'a new deliverable has no revision yet');
SELECT throws_ok($$SELECT public.add_engagement_deliverable('e6100000-0000-4000-8000-000000000003', 'Late', 'video')$$, '22023', NULL,
  'a closed engagement takes no new deliverable');
SELECT is(public.add_deliverable_revision((SELECT id FROM d1), 0, 'https://air.inc/review/a1', 'rev-a1', 'First cut'), 1, 'staff add revision 1');
SELECT throws_ok($$SELECT public.add_deliverable_revision((SELECT id FROM d1), 0, 'https://air.inc/review/a1b')$$, '40001', NULL,
  'a revision from a stale screen is refused');
SELECT throws_ok($$SELECT public.add_deliverable_revision((SELECT id FROM d1), 1, 'http://air.inc/review/insecure')$$, '23514', NULL,
  'a review link must be https');
SELECT is((SELECT stage FROM public.engagement_deliverables WHERE id = (SELECT id FROM d1)), 'client_review', 'the deliverable is in client review');
RESET role;
SELECT is(public.deliverable_client_round_limit((SELECT id FROM d1)), 1, 'its included rounds come from the agreed deliverable in the terms');
SET LOCAL role authenticated;

-- ---------------------------------------------------------------- client wall (12-19)
SELECT set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.engagement_deliverables), 0, 'a client reads no deliverables, not even its own engagement''s');
SELECT is((SELECT count(*)::int FROM public.engagement_deliverable_revisions), 0, 'a client reads no revisions or review links');
SELECT is((SELECT count(*)::int FROM public.approval_subjects), 0, 'a client reads no approval subjects');
SELECT throws_ok($$SELECT public.add_engagement_deliverable('e6100000-0000-4000-8000-000000000001', 'x', 'video')$$, '42501', NULL, 'a client cannot add a deliverable');
SELECT throws_ok($$SELECT public.record_deliverable_client_decision((SELECT id FROM d1), 1, 'approved', 'call', 'me')$$, '42501', NULL,
  'a client cannot record a decision through the staff function');
SELECT throws_ok($$SELECT public.decide_deliverable_round_exception(gen_random_uuid(), true, 'x')$$, '42501', NULL, 'a client cannot decide an exception');
SELECT throws_ok($$SELECT public.create_approval_subject('e6100000-0000-4000-8000-000000000001', 'idea', 'x')$$, '42501', NULL, 'a client cannot add an approval subject');
SELECT throws_ok($$INSERT INTO public.engagement_deliverable_decisions (deliverable_id, revision, decision, channel, source_note, recorded_by)
                   VALUES ((SELECT id FROM d1), 1, 'approved', 'call', 'x', auth.uid())$$, '42501', NULL, 'a client cannot write a decision directly');

-- ---------------------------------------------------------------- client decisions and rounds (20-31)
SELECT set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000002', true);
SELECT is(public.record_deliverable_client_decision((SELECT id FROM d1), 1, 'changes_requested', 'slack', 'Shorter intro please'), 'recorded',
  'the first changes request is recorded as round 1');
SELECT is((SELECT client_round FROM public.engagement_deliverable_decisions WHERE deliverable_id = (SELECT id FROM d1) AND revision = 1), 1, 'it is round 1');
SELECT throws_ok($$SELECT public.record_deliverable_client_decision((SELECT id FROM d1), 1, 'approved', 'call', 'again')$$, '22023', NULL,
  'a revision gets one decision');
SELECT is(public.add_deliverable_revision((SELECT id FROM d1), 1, 'https://air.inc/review/a2'), 2, 'staff add revision 2');
SELECT throws_ok($$SELECT public.record_deliverable_client_decision((SELECT id FROM d1), 1, 'approved', 'call', 'old')$$, '40001', NULL,
  'a decision on an old revision is refused');
SELECT is(public.record_deliverable_client_decision((SELECT id FROM d1), 2, 'changes_requested', 'email', 'Swap the music'), 'exception_pending',
  'a changes request beyond the included rounds opens an exception instead');
SELECT is((SELECT count(*)::int FROM public.engagement_deliverable_decisions WHERE deliverable_id = (SELECT id FROM d1) AND revision = 2), 0,
  'nothing is recorded while the exception is pending');
CREATE TEMP TABLE x1 AS SELECT id FROM public.engagement_deliverable_round_exceptions WHERE deliverable_id = (SELECT id FROM d1) AND revision = 2;
GRANT SELECT ON x1 TO authenticated;
SELECT throws_ok($$SELECT public.decide_deliverable_round_exception((SELECT id FROM x1), true, 'ok')$$, '42501', NULL,
  'an employee cannot decide an extra round');
SELECT set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000001', true);
SELECT is(public.decide_deliverable_round_exception((SELECT id FROM x1), true, 'Goodwill round'), 'approved', 'a builder approves one extra round');
SELECT throws_ok($$SELECT public.decide_deliverable_round_exception((SELECT id FROM x1), false, 'changed mind')$$, '40001', NULL,
  'an exception is decided once');
SELECT is(public.record_deliverable_client_decision((SELECT id FROM d1), 2, 'changes_requested', 'email', 'Swap the music'), 'recorded',
  'the approved extra round can now be recorded');
SELECT is((SELECT client_round FROM public.engagement_deliverable_decisions WHERE deliverable_id = (SELECT id FROM d1) AND revision = 2), 2, 'it is round 2');

-- ---------------------------------------------------------------- custom engagement and withdraw (32-35)
SELECT is(public.add_deliverable_revision((SELECT id FROM d2), 0, 'https://air.inc/review/c1'), 1, 'a custom engagement deliverable gets revision 1');
SELECT is(public.record_deliverable_client_decision((SELECT id FROM d2), 1, 'changes_requested', 'call', 'Any change'), 'exception_pending',
  'a custom engagement includes no client rounds by default');
SELECT is(public.withdraw_engagement_deliverable((SELECT id FROM d3)), 'withdrawn', 'staff withdraw a deliverable');
SELECT throws_ok($$SELECT public.add_deliverable_revision((SELECT id FROM d3), 0, 'https://air.inc/review/s1')$$, '22023', NULL,
  'a withdrawn deliverable takes no revision');

-- ---------------------------------------------------------------- approvals (36-42)
CREATE TEMP TABLE s1 AS SELECT public.create_approval_subject('e6100000-0000-4000-8000-000000000001', 'idea', 'Founder story angle') AS id;
GRANT SELECT ON s1 TO authenticated;
SELECT is(public.save_approval_draft((SELECT id FROM s1), 0, 'Founder explains why she started.'), 1, 'staff save draft version 1');
SELECT throws_ok($$SELECT public.record_approval_decision((SELECT id FROM s1), 1, 'approved', 'call', 'yes')$$, '40001', NULL,
  'a draft cannot be decided before it is published');
SELECT is(public.publish_approval_version((SELECT id FROM s1), 1), 1, 'staff publish version 1');
SELECT is(public.save_approval_draft((SELECT id FROM s1), 1, 'Founder story, shorter.'), 2, 'staff save draft version 2');
SELECT is(public.publish_approval_version((SELECT id FROM s1), 2), 2, 'publishing version 2 supersedes version 1');
SELECT is((SELECT string_agg(version || ':' || state, ',' ORDER BY version) FROM public.approval_subject_versions WHERE subject_id = (SELECT id FROM s1)),
  '1:superseded,2:published', 'version 1 is superseded and version 2 is published');
RESET role;
SELECT throws_ok($$UPDATE public.approval_subject_versions SET body = 'changed'$$, '23514', NULL, 'approval text cannot be changed');

SELECT * FROM finish();
ROLLBACK;
