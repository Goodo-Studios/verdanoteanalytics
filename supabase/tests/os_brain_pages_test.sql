-- Company Brain pages (migration 20261126080001, story OS-014).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: row rules on; anon and public hold nothing; signed-in users only read; builder and
-- employee read every page; a client reads nothing; anon reads nothing; a signed-in user cannot
-- insert, update or delete; the section, slug and source_path rules hold (no Slack paths).
-- All rows are made up.

BEGIN;
SELECT plan(16);

INSERT INTO auth.users (id, email) VALUES
  ('e5100000-0000-4000-8000-000000000001', 'bp-builder@example.test'),
  ('e5100000-0000-4000-8000-000000000002', 'bp-employee@example.test'),
  ('e5100000-0000-4000-8000-000000000003', 'bp-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e5100000-0000-4000-8000-000000000001', 'builder'),
  ('e5100000-0000-4000-8000-000000000002', 'employee'),
  ('e5100000-0000-4000-8000-000000000003', 'client');

INSERT INTO public.brain_pages (section, slug, title, body_md, owner, last_reviewed, source_path, content_hash) VALUES
  ('Handbook', 'decision-rights', 'Decision rights', '# Decision rights', 'owner@example.test', '2026-08-01', 'company/decision-rights.md', 'h1'),
  ('Playbooks', 'editor-workflow', 'Editor workflow', '# Editor workflow', 'Unassigned', NULL, 'processes/editor-workflow.md', 'h2');

-- ---------------------------------------------------------------- structure (1-3)
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.brain_pages'::regclass), 'row rules are on for brain_pages');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'brain_pages' AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on brain_pages');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'brain_pages' AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0,
  'signed-in users only read brain_pages');

-- ---------------------------------------------------------------- table rules (4-7), as the owner
SELECT throws_ok($$INSERT INTO public.brain_pages (section, slug, title, source_path, content_hash) VALUES ('Slack', 'x', 'X', 'company/x.md', 'h')$$,
  '23514', NULL, 'an unknown section is refused');
SELECT throws_ok($$INSERT INTO public.brain_pages (section, slug, title, source_path, content_hash) VALUES ('Insights', 'x', 'X', 'insights/slack/x.md', 'h')$$,
  '23514', NULL, 'a path with a slack folder is refused');
SELECT throws_ok($$INSERT INTO public.brain_pages (section, slug, title, source_path, content_hash) VALUES ('Insights', 'y', 'Y', '/Users/someone/x.md', 'h')$$,
  '23514', NULL, 'an absolute local path is refused');
SELECT throws_ok($$INSERT INTO public.brain_pages (section, slug, title, source_path, content_hash) VALUES ('Handbook', 'decision-rights', 'Again', 'company/again.md', 'h')$$,
  '23505', NULL, 'a slug is unique within its section');

-- ---------------------------------------------------------------- builder and employee read (8-9)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e5100000-0000-4000-8000-000000000001', true);
SELECT is((SELECT count(*)::int FROM public.brain_pages WHERE source_path IN ('company/decision-rights.md', 'processes/editor-workflow.md')), 2,
  'a builder reads every page');
SELECT set_config('request.jwt.claim.sub', 'e5100000-0000-4000-8000-000000000002', true);
SELECT is((SELECT count(*)::int FROM public.brain_pages WHERE source_path IN ('company/decision-rights.md', 'processes/editor-workflow.md')), 2,
  'an employee reads every page');

-- ---------------------------------------------------------------- signed-in users cannot write (10-12)
SELECT throws_ok($$INSERT INTO public.brain_pages (section, slug, title, source_path, content_hash) VALUES ('Handbook', 'new', 'New', 'company/new.md', 'h')$$,
  '42501', NULL, 'an employee cannot add a page');
SELECT set_config('request.jwt.claim.sub', 'e5100000-0000-4000-8000-000000000001', true);
SELECT throws_ok($$UPDATE public.brain_pages SET title = 'Changed' WHERE slug = 'decision-rights'$$,
  '42501', NULL, 'a builder cannot change a page in the app');
SELECT throws_ok($$DELETE FROM public.brain_pages WHERE slug = 'decision-rights'$$,
  '42501', NULL, 'a builder cannot delete a page in the app');

-- ---------------------------------------------------------------- client reads nothing (13)
SELECT set_config('request.jwt.claim.sub', 'e5100000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.brain_pages), 0, 'a client reads no pages');

-- ---------------------------------------------------------------- anon reads nothing (14)
RESET role;
SET LOCAL role anon;
SELECT throws_ok($$SELECT count(*) FROM public.brain_pages$$, '42501', NULL, 'anon cannot read brain_pages');

-- ---------------------------------------------------------------- service role writes (15-16)
RESET role;
SET LOCAL role service_role;
SELECT lives_ok($$UPDATE public.brain_pages SET content_hash = 'h1b' WHERE slug = 'decision-rights'$$,
  'the service role updates a page');
SELECT lives_ok($$DELETE FROM public.brain_pages WHERE slug = 'editor-workflow'$$,
  'the service role removes a page');

SELECT * FROM finish();
ROLLBACK;
