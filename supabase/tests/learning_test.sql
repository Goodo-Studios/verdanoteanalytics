-- Learning modules and self-service measurement (migration 20261110200005, step 4c).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: row rules on, no grants for anon or public and no direct writes for
-- signed-in users; the helper is not callable from the browser; clients read nothing
-- and are refused the checked functions; the reviewer is another staff member and
-- reviews in order (accept, then one final decision); publication needs a builder and
-- every publication check; withdrawal needs a reason; support weeks are Mondays, one per
-- week; the snapshot keeps missing weeks out of the rates. All rows are made up.

BEGIN;
SELECT plan(31);

INSERT INTO auth.users (id, email) VALUES
  ('ec000000-0000-4000-8000-000000000001', 'ln-builder@example.test'),
  ('ec000000-0000-4000-8000-000000000002', 'ln-author@example.test'),
  ('ec000000-0000-4000-8000-000000000003', 'ln-client@example.test'),
  ('ec000000-0000-4000-8000-000000000004', 'ln-reviewer@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('ec000000-0000-4000-8000-000000000001', 'builder'),
  ('ec000000-0000-4000-8000-000000000002', 'employee'),
  ('ec000000-0000-4000-8000-000000000003', 'client'),
  ('ec000000-0000-4000-8000-000000000004', 'employee');
INSERT INTO public.clients (slug, name, status) VALUES ('ln-alpha', 'LN Alpha', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('ec000000-0000-4000-8000-000000000003', 'ln-alpha');
INSERT INTO public.engagements (id, client_slug, cycle_number, engagement_type, status, start_date) VALUES
  ('ec100000-0000-4000-8000-000000000001', 'ln-alpha', 1, 'standard_sprint', 'active', '2026-09-07');

-- ---------------------------------------------------------------- structure (1-4)
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN (
  'public.learning_modules'::regclass, 'public.learning_module_versions'::regclass, 'public.learning_reviews'::regclass,
  'public.learning_history'::regclass, 'public.learning_support_weeks'::regclass, 'public.learning_self_service_snapshots'::regclass)),
  'row rules are on for the six learning tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name LIKE 'learning_%' AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on the learning tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name LIKE 'learning_%' AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0,
  'signed-in users only read; writes go through the checked functions');
SELECT ok(NOT has_function_privilege('authenticated', 'public.clean_learning_lines(text[], integer)', 'EXECUTE'),
  'the learning helper is not callable by signed-in users');

-- ---------------------------------------------------------------- drafting (5-9)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'ec000000-0000-4000-8000-000000000002', true);
CREATE TEMP TABLE m1 AS SELECT public.create_learning_module('ln-alpha', 'filming-at-home', 'Filming at home') AS id;
GRANT SELECT ON m1 TO authenticated;
SELECT throws_ok($$SELECT public.save_learning_draft((SELECT id FROM m1), 0, 'Summary', ARRAY['Step'], ARRAY['Check'], ARRAY['https://example.test/a'],
                   ARRAY['standard'], 'cleared', 'client_approved', ARRAY[]::text[], 'ec000000-0000-4000-8000-000000000002')$$, '22023', NULL,
  'the author cannot be the reviewer');
SELECT throws_ok($$SELECT public.save_learning_draft((SELECT id FROM m1), 0, 'Summary', ARRAY['Step'], ARRAY['Check'], ARRAY['https://example.test/a'],
                   ARRAY['standard'], 'cleared', 'client_approved', ARRAY[]::text[], 'ec000000-0000-4000-8000-000000000003')$$, '22023', NULL,
  'a client login cannot be the reviewer');
SELECT is(public.save_learning_draft((SELECT id FROM m1), 0, 'How to film at home', ARRAY['Face a window', ' Hold the phone upright '], ARRAY['Clean lens'],
  ARRAY['http://example.test/insecure'], ARRAY['standard'], 'cleared', 'client_approved', ARRAY[]::text[], 'ec000000-0000-4000-8000-000000000004'), 1,
  'draft version 1');
SELECT is((SELECT array_to_string(steps, '|') FROM public.learning_module_versions WHERE module_id = (SELECT id FROM m1) AND version = 1),
  'Face a window|Hold the phone upright', 'steps are trimmed');
SELECT throws_ok($$SELECT public.save_learning_draft((SELECT id FROM m1), 0, 'x', ARRAY['x'], ARRAY['x'], ARRAY['https://x.test'], ARRAY['standard'],
                   'cleared', 'client_approved', ARRAY[]::text[], NULL)$$, '40001', NULL, 'a stale draft is refused');

-- ---------------------------------------------------------------- client wall (10-14)
SELECT set_config('request.jwt.claim.sub', 'ec000000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.learning_modules) + (SELECT count(*)::int FROM public.learning_module_versions)
          + (SELECT count(*)::int FROM public.learning_support_weeks), 0, 'a client reads no lessons, versions or support weeks');
SELECT throws_ok($$SELECT public.create_learning_module('ln-alpha', 'client-made', 'x')$$, '42501', NULL, 'a client cannot create a lesson');
SELECT throws_ok($$SELECT public.review_learning_version((SELECT id FROM m1), 1, 'accepted')$$, '42501', NULL, 'a client cannot review');
SELECT throws_ok($$SELECT public.record_learning_support_week('ec100000-0000-4000-8000-000000000001', '2026-09-07', 'observed', 1, 'synthetic_fixture')$$,
  '42501', NULL, 'a client cannot record a support week');
SELECT throws_ok($$SELECT public.snapshot_learning_self_service('ec100000-0000-4000-8000-000000000001', '2026-09-07', '2026-09-20', '2026-09-21', '2026-10-04')$$,
  '42501', NULL, 'a client cannot take a snapshot');

-- ---------------------------------------------------------------- review and publication (15-24)
SELECT set_config('request.jwt.claim.sub', 'ec000000-0000-4000-8000-000000000001', true);
SELECT throws_ok($$SELECT public.review_learning_version((SELECT id FROM m1), 1, 'accepted')$$, '42501', NULL, 'only the assigned reviewer reviews');
SELECT set_config('request.jwt.claim.sub', 'ec000000-0000-4000-8000-000000000004', true);
SELECT throws_ok($$SELECT public.review_learning_version((SELECT id FROM m1), 1, 'approved')$$, '22023', NULL, 'approval needs acceptance first');
SELECT ok(public.review_learning_version((SELECT id FROM m1), 1, 'accepted') IS NOT NULL, 'the reviewer accepts version 1 for review');
SELECT ok(public.review_learning_version((SELECT id FROM m1), 1, 'approved', 'Clear steps') IS NOT NULL, 'the reviewer approves version 1');
SELECT throws_ok($$SELECT public.review_learning_version((SELECT id FROM m1), 1, 'rejected')$$, '22023', NULL, 'a version is decided once');
SELECT throws_ok($$SELECT public.publish_learning_version((SELECT id FROM m1), 1)$$, '42501', NULL, 'an employee cannot publish');
SELECT set_config('request.jwt.claim.sub', 'ec000000-0000-4000-8000-000000000001', true);
SELECT throws_ok($$SELECT public.publish_learning_version((SELECT id FROM m1), 1)$$, '22023', NULL, 'a source link that is not https blocks publication');
SELECT is(public.save_learning_draft((SELECT id FROM m1), 1, 'How to film at home', ARRAY['Face a window'], ARRAY['Clean lens'],
  ARRAY['https://example.test/guide'], ARRAY['standard', 'custom'], 'cleared', 'client_approved', ARRAY[]::text[], 'ec000000-0000-4000-8000-000000000004'), 2,
  'the builder writes version 2 with an https link');
SELECT set_config('request.jwt.claim.sub', 'ec000000-0000-4000-8000-000000000004', true);
SELECT ok(public.review_learning_version((SELECT id FROM m1), 2, 'accepted') IS NOT NULL, 'the reviewer accepts version 2');
SELECT ok(public.review_learning_version((SELECT id FROM m1), 2, 'approved') IS NOT NULL, 'the reviewer approves version 2');

-- ---------------------------------------------------------------- publish and withdraw (25-27)
SELECT set_config('request.jwt.claim.sub', 'ec000000-0000-4000-8000-000000000001', true);
SELECT is(public.publish_learning_version((SELECT id FROM m1), 2), 2, 'the builder publishes version 2');
SELECT throws_ok($$SELECT public.withdraw_learning_module((SELECT id FROM m1), ' ')$$, '22023', NULL, 'a withdrawal needs a reason');
SELECT is(public.withdraw_learning_module((SELECT id FROM m1), 'Process changed'), 2, 'the builder withdraws version 2 with a reason');

-- ---------------------------------------------------------------- self-service (28-30)
SELECT set_config('request.jwt.claim.sub', 'ec000000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$SELECT public.record_learning_support_week('ec100000-0000-4000-8000-000000000001', '2026-09-08', 'observed', 1, 'synthetic_fixture')$$,
  '23514', NULL, 'a support week starts on a Monday');
SELECT is(public.record_learning_support_week('ec100000-0000-4000-8000-000000000001', '2026-09-07', 'observed', 4, 'synthetic_fixture')
          + (public.record_learning_support_week('ec100000-0000-4000-8000-000000000001', '2026-09-14', 'missing', 9, 'synthetic_fixture') - '2026-09-14'::date)
          + (public.record_learning_support_week('ec100000-0000-4000-8000-000000000001', '2026-09-21', 'observed', 1, 'synthetic_fixture') - '2026-09-21'::date)
          + (public.record_learning_support_week('ec100000-0000-4000-8000-000000000001', '2026-09-28', 'observed', 2, 'synthetic_fixture') - '2026-09-28'::date),
  '2026-09-07'::date, 'four weeks recorded (one missing)');
CREATE TEMP TABLE snap AS SELECT public.snapshot_learning_self_service('ec100000-0000-4000-8000-000000000001', '2026-09-07', '2026-09-20', '2026-09-21', '2026-10-04') AS id;
GRANT SELECT ON snap TO authenticated;
SELECT is((SELECT baseline_questions || ':' || baseline_weeks_observed || ':' || baseline_weeks_missing || ':' || baseline_rate || '|' ||
                  pilot_questions || ':' || pilot_weeks_observed || ':' || pilot_rate || ':' || comparison || ':' || pilot_status || ':' || data_origin
             FROM public.learning_self_service_snapshots WHERE id = (SELECT id FROM snap)),
  '4:1:1:4.0000|3:2:1.5000:better:complete:synthetic_fixture', 'the missing week stays out of the baseline rate; the pilot is better');

-- ---------------------------------------------------------------- history (31)
RESET role;
SELECT throws_ok($$UPDATE public.learning_module_versions SET summary = 'changed'$$, '23514', NULL, 'lesson versions cannot be changed');

SELECT * FROM finish();
ROLLBACK;
