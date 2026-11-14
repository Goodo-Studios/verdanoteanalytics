-- Knowledge pages (migration 20261110000003, consolidation step 4a).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: row rules on, no grants for anon or public and no direct writes for
-- signed-in users; clients read nothing (a client member of the source's own
-- client included) and every checked function refuses them; a builder adds a
-- source; staff propose corrections against the current version; an author
-- cannot review their own correction; procedure corrections need a builder and are
-- never published; publishing and rolling back add versions; stale versions are
-- refused; history cannot be changed. All rows are made up.

BEGIN;
SELECT plan(34);

INSERT INTO auth.users (id, email) VALUES
  ('e4000000-0000-4000-8000-000000000001', 'kp-builder@example.test'),
  ('e4000000-0000-4000-8000-000000000002', 'kp-employee@example.test'),
  ('e4000000-0000-4000-8000-000000000003', 'kp-client@example.test'),
  ('e4000000-0000-4000-8000-000000000004', 'kp-employee2@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e4000000-0000-4000-8000-000000000001', 'builder'),
  ('e4000000-0000-4000-8000-000000000002', 'employee'),
  ('e4000000-0000-4000-8000-000000000003', 'client'),
  ('e4000000-0000-4000-8000-000000000004', 'employee');
INSERT INTO public.clients (slug, name, status) VALUES ('kp-alpha', 'KP Alpha', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('e4000000-0000-4000-8000-000000000003', 'kp-alpha');

-- ---------------------------------------------------------------- structure (1-5)
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN (
  'public.knowledge_sources'::regclass, 'public.knowledge_source_versions'::regclass,
  'public.knowledge_corrections'::regclass, 'public.knowledge_correction_reviews'::regclass)),
  'row rules are on for the four knowledge tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name LIKE 'knowledge_%' AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on the knowledge tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name LIKE 'knowledge_%' AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0,
  'signed-in users only read; writes go through the checked functions');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('create_knowledge_source', 'submit_knowledge_correction',
              'review_knowledge_correction', 'publish_knowledge_correction', 'rollback_knowledge_source')
              AND has_function_privilege('anon', p.oid, 'EXECUTE')), 0, 'anon cannot call any knowledge function');
SELECT ok(NOT has_function_privilege('authenticated', 'public.knowledge_body_fingerprint(text)', 'EXECUTE'),
  'the fingerprint helper is not callable by signed-in users');

-- ---------------------------------------------------------------- builder adds sources (6-9)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$SELECT public.create_knowledge_source('Hooks', 'Use three hooks.', 'staff', 'global')$$, '42501', NULL,
  'an employee cannot add a source');
SELECT set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000001', true);
CREATE TEMP TABLE ks AS SELECT public.create_knowledge_source('Hook rules', 'Use three hooks per ad.', 'staff', 'global', NULL, 'process', 'https://example.test/doc') AS id;
CREATE TEMP TABLE kc AS SELECT public.create_knowledge_source('Alpha brand voice', 'Warm and plain.', 'client', 'client', 'kp-alpha') AS id;
SELECT is((SELECT current_version FROM public.knowledge_sources WHERE id = (SELECT id FROM ks)), 1, 'a new source starts at version 1');
SELECT is((SELECT kind || ':' || published_by::text FROM public.knowledge_source_versions WHERE source_id = (SELECT id FROM ks)),
  'create:e4000000-0000-4000-8000-000000000001', 'its first version is recorded with the builder');
SELECT throws_ok($$SELECT public.create_knowledge_source('Bad', 'x', 'staff', 'client')$$, '23514', NULL,
  'a client-scoped source needs a client');
GRANT SELECT ON ks, kc TO authenticated;

-- ---------------------------------------------------------------- client (10-17)
SELECT set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.knowledge_sources), 0, 'a client reads no sources, not even its own client''s');
SELECT is((SELECT count(*)::int FROM public.knowledge_source_versions), 0, 'a client reads no versions');
SELECT is((SELECT count(*)::int FROM public.knowledge_corrections), 0, 'a client reads no corrections');
SELECT throws_ok($$SELECT public.submit_knowledge_correction((SELECT id FROM kc), 1, 'Cold', 'x', 'content')$$, '42501', NULL,
  'a client cannot propose a correction');
SELECT throws_ok($$SELECT public.review_knowledge_correction(gen_random_uuid(), 'accepted', 'x')$$, '42501', NULL, 'a client cannot review');
SELECT throws_ok($$SELECT public.publish_knowledge_correction(gen_random_uuid())$$, '42501', NULL, 'a client cannot publish');
SELECT throws_ok($$SELECT public.rollback_knowledge_source((SELECT id FROM kc), 1, 1, 'x')$$, '42501', NULL, 'a client cannot roll back');
SELECT throws_ok($$INSERT INTO public.knowledge_sources (title, classification, release_scope, created_by) VALUES ('x', 'staff', 'global', auth.uid())$$,
  '42501', NULL, 'a client cannot write a source directly');

-- ---------------------------------------------------------------- corrections and reviews (18-27)
SELECT set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$SELECT public.submit_knowledge_correction((SELECT id FROM ks), 2, 'Use two hooks.', 'Changed', 'content')$$, '40001', NULL,
  'a correction against a version that is not current is refused');
SELECT throws_ok($$SELECT public.submit_knowledge_correction((SELECT id FROM ks), 1, 'Use three hooks per ad.', 'Same', 'content')$$, '22023', NULL,
  'a correction with the same text is refused');
CREATE TEMP TABLE c1 AS SELECT public.submit_knowledge_correction((SELECT id FROM ks), 1, 'Use two hooks per ad.', 'Tested in October', 'content') AS id;
CREATE TEMP TABLE c2 AS SELECT public.submit_knowledge_correction((SELECT id FROM ks), 1, 'Ask the strategist first.', 'Process', 'procedure') AS id;
CREATE TEMP TABLE c3 AS SELECT public.submit_knowledge_correction((SELECT id FROM ks), 1, 'Use four hooks per ad.', 'Other idea', 'factual') AS id;
SELECT is((SELECT source_fingerprint FROM public.knowledge_corrections WHERE id = (SELECT id FROM c1)),
  (SELECT fingerprint FROM public.knowledge_source_versions WHERE source_id = (SELECT id FROM ks) AND version = 1),
  'a correction is locked to the fingerprint of the version it was written against');
SELECT throws_ok($$SELECT public.review_knowledge_correction((SELECT id FROM c1), 'accepted', 'mine')$$, '42501', NULL,
  'the author cannot review their own correction');
SELECT set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000004', true);
SELECT throws_ok($$SELECT public.review_knowledge_correction((SELECT id FROM c2), 'accepted', 'ok')$$, '42501', NULL,
  'an employee cannot review a procedure correction');
SELECT lives_ok($$SELECT public.review_knowledge_correction((SELECT id FROM c1), 'accepted', 'Matches the October test')$$,
  'another employee accepts a content correction');
SELECT throws_ok($$SELECT public.review_knowledge_correction((SELECT id FROM c1), 'rejected', 'again')$$, '23505', NULL,
  'a correction is reviewed once');
SELECT throws_ok($$SELECT public.publish_knowledge_correction((SELECT id FROM c1))$$, '42501', NULL, 'an employee cannot publish');
SELECT set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$SELECT public.review_knowledge_correction((SELECT id FROM c2), 'accepted', 'Agreed')$$, 'a builder accepts a procedure correction');
SELECT throws_ok($$SELECT public.publish_knowledge_correction((SELECT id FROM c2))$$, '22023', NULL, 'a procedure correction is never published');

-- ---------------------------------------------------------------- publish and roll back (28-34)
SELECT is(public.publish_knowledge_correction((SELECT id FROM c1)), 2, 'a builder publishes the accepted correction as version 2');
SELECT is((SELECT body FROM public.knowledge_source_versions WHERE source_id = (SELECT id FROM ks) AND version = 2), 'Use two hooks per ad.',
  'version 2 holds the corrected text');
SELECT throws_ok($$SELECT public.review_knowledge_correction((SELECT id FROM c3), 'accepted', 'late')$$, '40001', NULL,
  'a correction written against an older version cannot be accepted');
SELECT lives_ok($$SELECT public.review_knowledge_correction((SELECT id FROM c3), 'conflict', 'Overtaken by version 2')$$,
  'it can be marked as a conflict');
SELECT throws_ok($$SELECT public.rollback_knowledge_source((SELECT id FROM ks), 1, 1, 'stale screen')$$, '40001', NULL,
  'a rollback from a stale screen is refused');
SELECT is(public.rollback_knowledge_source((SELECT id FROM ks), 1, 2, 'October test was wrong'), 3, 'a rollback publishes version 3');
RESET role;
SELECT throws_ok($$UPDATE public.knowledge_source_versions SET body = 'changed'$$, '23514', NULL, 'versions cannot be changed');

SELECT * FROM finish();
ROLLBACK;
