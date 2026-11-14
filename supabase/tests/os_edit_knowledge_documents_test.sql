-- Edit knowledge documents directly (migration 20261207080001).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: staff (builder and employee) edit a Knowledge source and a Brain page; a client cannot,
-- and sees nothing; anon cannot call either function; a stale version or timestamp is refused;
-- unchanged or empty text is refused; an edit adds a version / marks the page edited; direct
-- table writes stay closed for signed-in users; the old correction tables keep their rows.
-- All rows are made up.

BEGIN;
SELECT plan(25);

INSERT INTO auth.users (id, email) VALUES
  ('e7000000-0000-4000-8000-000000000001', 'ed-builder@example.test'),
  ('e7000000-0000-4000-8000-000000000002', 'ed-employee@example.test'),
  ('e7000000-0000-4000-8000-000000000003', 'ed-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e7000000-0000-4000-8000-000000000001', 'builder'),
  ('e7000000-0000-4000-8000-000000000002', 'employee'),
  ('e7000000-0000-4000-8000-000000000003', 'client');

INSERT INTO public.knowledge_sources (id, title, classification, release_scope, created_by)
  VALUES ('e7aa0000-0000-4000-8000-000000000001', 'Edit me', 'staff', 'global', 'e7000000-0000-4000-8000-000000000001');
INSERT INTO public.knowledge_source_versions (source_id, version, body, fingerprint, kind, published_by)
  VALUES ('e7aa0000-0000-4000-8000-000000000001', 1, 'First text.', public.knowledge_body_fingerprint('First text.'), 'create', 'e7000000-0000-4000-8000-000000000001');
INSERT INTO public.brain_pages (id, section, slug, title, body_md, owner, source_path, content_hash)
  VALUES ('e7bb0000-0000-4000-8000-000000000001', 'Handbook', 'ed-page', 'Edit page', 'Page text.', 'Unassigned', 'company/ed-page.md', 'hash-ed');

-- ---------------------------------------------------------------- structure (1-4)
SELECT ok(NOT has_function_privilege('anon', 'public.edit_knowledge_source(uuid, text, integer)', 'EXECUTE'), 'anon cannot edit knowledge');
SELECT ok(NOT has_function_privilege('anon', 'public.edit_brain_page(uuid, text, timestamptz)', 'EXECUTE'), 'anon cannot edit a Brain page');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name IN ('knowledge_sources', 'knowledge_source_versions', 'brain_pages')
              AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0,
  'signed-in users still cannot write the document tables directly');
SELECT is((SELECT edited_in_app FROM public.brain_pages WHERE slug = 'ed-page'), false, 'a page starts as not edited in the app');

-- ---------------------------------------------------------------- client (5-8)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e7000000-0000-4000-8000-000000000003', true);
SELECT throws_ok($$SELECT public.edit_knowledge_source('e7aa0000-0000-4000-8000-000000000001', 'Client text', 1)$$, '42501', NULL,
  'a client cannot edit knowledge');
SELECT throws_ok($$SELECT public.edit_brain_page('e7bb0000-0000-4000-8000-000000000001', 'Client text', now())$$, '42501', NULL,
  'a client cannot edit a Brain page');
SELECT is((SELECT count(*)::int FROM public.knowledge_sources), 0, 'a client reads no sources');
SELECT is((SELECT count(*)::int FROM public.brain_pages), 0, 'a client reads no Brain pages');

-- ---------------------------------------------------------------- knowledge edits (9-15)
SELECT set_config('request.jwt.claim.sub', 'e7000000-0000-4000-8000-000000000002', true);
SELECT is(public.edit_knowledge_source('e7aa0000-0000-4000-8000-000000000001', 'Second text.', 1), 2, 'an employee edits a source, which becomes version 2');
SELECT is((SELECT body FROM public.knowledge_source_versions v JOIN public.knowledge_sources s ON s.id = v.source_id AND s.current_version = v.version
            WHERE s.id = 'e7aa0000-0000-4000-8000-000000000001'), 'Second text.', 'the current version holds the edited text');
SELECT is((SELECT kind || ':' || published_by::text FROM public.knowledge_source_versions WHERE source_id = 'e7aa0000-0000-4000-8000-000000000001' AND version = 2),
  'edit:e7000000-0000-4000-8000-000000000002', 'the edit is recorded with who made it');
SELECT throws_ok($$SELECT public.edit_knowledge_source('e7aa0000-0000-4000-8000-000000000001', 'Late text.', 1)$$, '40001', NULL,
  'saving against an older version is refused');
SELECT throws_ok($$SELECT public.edit_knowledge_source('e7aa0000-0000-4000-8000-000000000001', 'Second text.', 2)$$, '22023', NULL,
  'saving the same text is refused');
SELECT throws_ok($$SELECT public.edit_knowledge_source('e7aa0000-0000-4000-8000-000000000001', '   ', 2)$$, '23514', NULL,
  'saving empty text is refused');
SELECT throws_ok($$SELECT public.edit_knowledge_source('e7aa0000-0000-4000-8000-000000009999', 'x', 1)$$, 'P0002', NULL,
  'a missing source is reported');

-- ---------------------------------------------------------------- brain edits (16-22)
CREATE TEMP TABLE pg_stamp AS SELECT updated_at AS ts FROM public.brain_pages WHERE slug = 'ed-page';
GRANT SELECT ON pg_stamp TO authenticated;
SELECT set_config('request.jwt.claim.sub', 'e7000000-0000-4000-8000-000000000001', true);
SELECT throws_ok($$SELECT public.edit_brain_page('e7bb0000-0000-4000-8000-000000000001', 'Page text.', (SELECT ts FROM pg_stamp))$$, '22023', NULL,
  'saving the same page text is refused');
SELECT throws_ok($$SELECT public.edit_brain_page('e7bb0000-0000-4000-8000-000000000001', '', (SELECT ts FROM pg_stamp))$$, '23514', NULL,
  'saving empty page text is refused');
SELECT lives_ok($$SELECT public.edit_brain_page('e7bb0000-0000-4000-8000-000000000001', E'# Edit page\n\nNew **text**.', (SELECT ts FROM pg_stamp))$$,
  'a builder edits a Brain page');
SELECT is((SELECT body_md FROM public.brain_pages WHERE slug = 'ed-page'), E'# Edit page\n\nNew **text**.', 'the page shows the edited text at once');
SELECT is((SELECT edited_in_app::text || ':' || edited_by::text FROM public.brain_pages WHERE slug = 'ed-page'),
  'true:e7000000-0000-4000-8000-000000000001', 'the page is marked edited in the app, by the builder');
SELECT is((SELECT content_hash FROM public.brain_pages WHERE slug = 'ed-page'), 'hash-ed', 'the HQ hash is left as the last publish set it');
SELECT throws_ok($$SELECT public.edit_brain_page('e7bb0000-0000-4000-8000-000000000001', 'Late page text.', (SELECT ts - interval '1 second' FROM pg_stamp))$$, '40001', NULL,
  'saving against a page that changed since it was shown is refused');

-- ---------------------------------------------------------------- search follows the edit (23)
SELECT is((SELECT count(*)::int FROM public.brain_pages WHERE search_tsv @@ plainto_tsquery('english', 'text') AND slug = 'ed-page'), 1,
  'the search index follows the edited text');

-- ---------------------------------------------------------------- old data kept (24-25)
RESET role;
SELECT has_table('public', 'knowledge_corrections', 'the knowledge correction table is still there');
SELECT has_table('public', 'brain_page_corrections', 'the Brain fix table is still there');

SELECT * FROM finish();
ROLLBACK;
