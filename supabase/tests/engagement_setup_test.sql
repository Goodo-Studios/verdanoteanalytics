-- Engagement setup (migration 20261110120001, consolidation step 4b).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: row rules on, no grants for anon or public and no direct writes for
-- signed-in users; clients read none of the four tables (a client member of the
-- engagement's own client included) and every checked function refuses them; the
-- milestone template rules; a builder saves template versions and an employee
-- cannot; an engagement copies its template and never follows later versions; the
-- kickoff is recorded once and then freezes the start date; one active sprint per
-- client; closeout versions; history cannot be changed. All rows are made up.

BEGIN;
SELECT plan(40);

INSERT INTO auth.users (id, email) VALUES
  ('e5000000-0000-4000-8000-000000000001', 'es-builder@example.test'),
  ('e5000000-0000-4000-8000-000000000002', 'es-employee@example.test'),
  ('e5000000-0000-4000-8000-000000000003', 'es-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e5000000-0000-4000-8000-000000000001', 'builder'),
  ('e5000000-0000-4000-8000-000000000002', 'employee'),
  ('e5000000-0000-4000-8000-000000000003', 'client');
INSERT INTO public.clients (slug, name, status) VALUES
  ('es-alpha', 'ES Alpha', 'active'), ('es-beta', 'ES Beta', 'active');
INSERT INTO public.clients (slug, name, status, active) VALUES ('es-gone', 'ES Gone', 'inactive', false);
INSERT INTO public.client_members (user_id, client_slug) VALUES ('e5000000-0000-4000-8000-000000000003', 'es-alpha');

-- ---------------------------------------------------------------- structure (1-5)
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN (
  'public.engagement_templates'::regclass, 'public.engagement_terms'::regclass,
  'public.engagement_milestones'::regclass, 'public.engagement_closeouts'::regclass)),
  'row rules are on for the four engagement setup tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name IN ('engagement_templates', 'engagement_terms', 'engagement_milestones', 'engagement_closeouts')
              AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on the engagement setup tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name IN ('engagement_templates', 'engagement_terms', 'engagement_milestones', 'engagement_closeouts')
              AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0,
  'signed-in users only read; writes go through the checked functions');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('save_engagement_template', 'create_engagement_from_template',
              'record_engagement_kickoff', 'save_engagement_closeout')
              AND has_function_privilege('anon', p.oid, 'EXECUTE')), 0, 'anon cannot call any engagement setup function');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('save_engagement_template', 'create_engagement_from_template',
              'record_engagement_kickoff', 'save_engagement_closeout') AND p.prosecdef), 4,
  'the four engagement setup functions are checked SECURITY DEFINER functions');

-- ---------------------------------------------------------------- milestone template rules (6-10)
SELECT is(public.normalize_engagement_milestone_template('["kickoff", "delivery"]'::jsonb),
  '[{"key": "kickoff", "clientVisible": true, "requiredEvidence": ["source_handoff"]}, {"key": "delivery", "clientVisible": true, "requiredEvidence": ["strategist_congruency", "qa_release", "delivery_receipt"]}]'::jsonb,
  'legacy string entries become objects; delivery gets its three release gates');
SELECT throws_ok($$SELECT public.normalize_engagement_milestone_template('[{"key": "delivery", "requiredEvidence": ["qa_release"], "clientVisible": true}]')$$,
  '22023', NULL, 'a delivery milestone cannot drop a release gate');
SELECT throws_ok($$SELECT public.normalize_engagement_milestone_template('["kickoff", "kickoff"]')$$, '22023', NULL, 'milestone keys appear once');
SELECT throws_ok($$SELECT public.normalize_engagement_milestone_template('[{"key": "brief", "requiredEvidence": ["a", "a"], "clientVisible": false}]')$$,
  '22023', NULL, 'evidence entries are distinct');
SELECT throws_ok($$SELECT public.normalize_engagement_milestone_template('[{"key": "brief", "requiredEvidence": ["a"], "clientVisible": false, "extra": 1}]')$$,
  '22023', NULL, 'a milestone has no extra fields');

-- ---------------------------------------------------------------- templates (11-16)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$SELECT public.save_engagement_template('sprint', NULL, 0, 'standard_sprint', '["delivery"]', '[]', 'SOW 1')$$,
  '42501', NULL, 'an employee cannot save a template');
SELECT set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000001', true);
CREATE TEMP TABLE t1 AS SELECT public.save_engagement_template('sprint', NULL, 0, 'standard_sprint',
  '["kickoff", {"key": "delivery", "requiredEvidence": ["strategist_congruency", "qa_release", "delivery_receipt"], "clientVisible": true}]',
  '[{"name": "Video ads", "quantity": 12, "clientRevisionRounds": 2}]', 'SOW standard') AS id;
SELECT is((SELECT version FROM public.engagement_templates WHERE id = (SELECT id FROM t1)), 1, 'a new template starts at version 1');
SELECT throws_ok($$SELECT public.save_engagement_template('sprint', NULL, 0, 'standard_sprint', '["delivery"]', '[]', 'again')$$,
  '40001', NULL, 'a save from a stale screen is refused');
SELECT throws_ok($$SELECT public.save_engagement_template('sprint', NULL, 1, 'retainer', '["delivery"]', '[]', 'type')$$,
  '22023', NULL, 'a new version keeps the template type');
CREATE TEMP TABLE t2 AS SELECT public.save_engagement_template('sprint', NULL, 1, 'standard_sprint', '["kickoff", "review", "delivery"]', '[]', 'SOW v2') AS id;
CREATE TEMP TABLE tb AS SELECT public.save_engagement_template('sprint', 'es-beta', 0, 'standard_sprint', '["delivery"]', '[]', 'Beta SOW') AS id;
SELECT is((SELECT version FROM public.engagement_templates WHERE id = (SELECT id FROM tb)), 1,
  'a client-scoped template keeps its own version numbers');
SELECT throws_ok($$SELECT public.save_engagement_template('sprint', NULL, 2, 'standard_sprint', '["delivery", "delivery"]', '[]', 'bad')$$,
  '22023', NULL, 'a template with an invalid milestone list is refused');
GRANT SELECT ON t1, t2, tb TO authenticated;

-- ---------------------------------------------------------------- client wall (17-24)
SELECT set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000002', true);
CREATE TEMP TABLE e1 AS SELECT public.create_engagement_from_template('es-alpha', (SELECT id FROM t1), 'PO-1001') AS id;
GRANT SELECT ON e1 TO authenticated;
SELECT set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.engagements WHERE id = (SELECT id FROM e1)), 1,
  'the client still reads its own engagement row and dates (unchanged rule)');
SELECT is((SELECT count(*)::int FROM public.engagement_templates), 0, 'a client reads no templates');
SELECT is((SELECT count(*)::int FROM public.engagement_terms), 0, 'a client reads no terms, not even its own engagement''s');
SELECT is((SELECT count(*)::int FROM public.engagement_milestones), 0, 'a client reads no milestones');
SELECT throws_ok($$SELECT public.create_engagement_from_template('es-alpha', (SELECT id FROM t1))$$, '42501', NULL, 'a client cannot create an engagement');
SELECT throws_ok($$SELECT public.record_engagement_kickoff((SELECT id FROM e1), '2026-11-02')$$, '42501', NULL, 'a client cannot record a kickoff');
SELECT throws_ok($$SELECT public.save_engagement_closeout((SELECT id FROM e1), 0, 'x')$$, '42501', NULL, 'a client cannot write a closeout');
SELECT throws_ok($$INSERT INTO public.engagement_terms (engagement_id, client_slug, created_by) VALUES ((SELECT id FROM e1), 'es-alpha', auth.uid())$$,
  '42501', NULL, 'a client cannot write terms directly');

-- ---------------------------------------------------------------- engagements from templates (25-31)
SELECT set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000002', true);
SELECT is((SELECT cycle_number || ':' || engagement_type || ':' || status || ':' || coalesce(start_date::text, 'none') FROM public.engagements WHERE id = (SELECT id FROM e1)),
  '1:standard_sprint:planned:none', 'the engagement is cycle 1, planned, with no dates until kickoff');
SELECT is((SELECT string_agg(milestone_key, ',' ORDER BY position) FROM public.engagement_milestones WHERE engagement_id = (SELECT id FROM e1)),
  'kickoff,delivery', 'its milestones come from template version 1, not the later version 2');
SELECT is((SELECT agreed_deliverables -> 0 ->> 'name' FROM public.engagement_terms WHERE engagement_id = (SELECT id FROM e1)), 'Video ads',
  'the agreed deliverables are copied into the terms');
SELECT is((SELECT purchase_reference FROM public.engagement_notes WHERE engagement_id = (SELECT id FROM e1)), 'PO-1001',
  'the purchase reference goes to the staff-only notes');
SELECT throws_ok($$SELECT public.create_engagement_from_template('es-alpha', (SELECT id FROM tb))$$, '22023', NULL,
  'another client''s template cannot be used');
SELECT throws_ok($$SELECT public.create_engagement_from_template('es-gone', (SELECT id FROM t1))$$, 'P0002', NULL,
  'an inactive client gets no new engagement');
CREATE TEMP TABLE e2 AS SELECT public.create_engagement_from_template('es-alpha', (SELECT id FROM t2)) AS id;
GRANT SELECT ON e2 TO authenticated;
SELECT is((SELECT cycle_number FROM public.engagements WHERE id = (SELECT id FROM e2)), 2, 'the next engagement is cycle 2');

-- ---------------------------------------------------------------- kickoff (32-36)
SELECT is(public.record_engagement_kickoff((SELECT id FROM e1), '2026-11-02'), '2026-11-02'::date, 'staff record the kickoff');
SELECT is((SELECT status || ':' || day30_date::text || ':' || day45_date::text FROM public.engagements WHERE id = (SELECT id FROM e1)),
  'active:2026-12-01:2026-12-16', 'the engagement is active with day 30 and day 45 dates');
SELECT throws_ok($$SELECT public.record_engagement_kickoff((SELECT id FROM e1), '2026-11-03')$$, '40001', NULL, 'a kickoff is recorded once');
SELECT throws_ok($$UPDATE public.engagements SET start_date = '2026-11-05' WHERE id = (SELECT id FROM e1)$$, '23514', NULL,
  'the start date cannot change after the kickoff, even by staff writing the table');
SELECT throws_ok($$SELECT public.record_engagement_kickoff((SELECT id FROM e2), '2026-11-04')$$, '23505', NULL,
  'a client keeps at most one active standard sprint');

-- ---------------------------------------------------------------- closeouts and history (37-40)
SELECT is(public.save_engagement_closeout((SELECT id FROM e1), 0, 'Two weeks of spend only', '2026-11-10T00:00:00Z', '2026-11-24T00:00:00Z',
  ARRAY['12 video ads'], ARRAY['Hook A beat hook B on CTR'], ARRAY['Refresh statics']), 1, 'staff save closeout version 1');
SELECT throws_ok($$SELECT public.save_engagement_closeout((SELECT id FROM e1), 0, 'stale')$$, '40001', NULL, 'a closeout from a stale screen is refused');
SELECT throws_ok($$SELECT public.save_engagement_closeout((SELECT id FROM e1), 1, 'bad dates', '2026-11-24T00:00:00Z', '2026-11-10T00:00:00Z')$$, '23514', NULL,
  'testing cannot end before it starts');
RESET role;
SELECT throws_ok($$UPDATE public.engagement_templates SET source_reference = 'changed'$$, '23514', NULL, 'template versions cannot be changed');

SELECT * FROM finish();
ROLLBACK;
