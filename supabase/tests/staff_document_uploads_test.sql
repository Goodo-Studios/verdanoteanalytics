-- Document uploads for Knowledge, the Brain and client BIDs (migration 20261216570001).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: the staff-documents bucket is private with a 10 MB limit; staff (builder and employee)
-- add a BID version, a knowledge source and a Brain page; a client cannot call the functions, reads
-- no rows and no storage objects, and cannot upload; anon cannot call them; the file rules refuse a
-- wrong folder, a wrong type and a file over 10 MB; the Brain page gets a unique slug and is marked
-- edited in the app; the same BID text returns the same version; direct table writes stay closed.
-- All rows are made up.

BEGIN;
SELECT plan(24);

INSERT INTO auth.users (id, email) VALUES
  ('e8000000-0000-4000-8000-000000000001', 'up-builder@example.test'),
  ('e8000000-0000-4000-8000-000000000002', 'up-employee@example.test'),
  ('e8000000-0000-4000-8000-000000000003', 'up-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e8000000-0000-4000-8000-000000000001', 'builder'),
  ('e8000000-0000-4000-8000-000000000002', 'employee'),
  ('e8000000-0000-4000-8000-000000000003', 'client');
INSERT INTO public.clients (slug, name, status) VALUES ('up-alpha', 'Upload Alpha', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('e8000000-0000-4000-8000-000000000003', 'up-alpha');

-- ---------------------------------------------------------------- structure (1-5)
SELECT is((SELECT public::text || ':' || file_size_limit::text FROM storage.buckets WHERE id = 'staff-documents'), 'false:10485760',
  'the staff-documents bucket is private with a 10 MB limit');
SELECT ok(NOT has_function_privilege('anon', 'public.upload_brain_page(text, text, text, text, text, text, text, bigint)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.upload_knowledge_document(text, text, text, text, text, text, text, bigint)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.add_client_bid(text, text, text, text, text, text, bigint)', 'EXECUTE'),
  'anon cannot call any upload function');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'staff_document_files' AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on the file records');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'staff_document_files' AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0,
  'signed-in users can only read the file records');
SELECT is((SELECT count(*)::int FROM pg_policies
            WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'staff_documents_%' AND cmd = 'UPDATE'), 0,
  'nobody can update a stored document');

-- ---------------------------------------------------------------- client (6-9)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e8000000-0000-4000-8000-000000000003', true);
SELECT throws_ok($$SELECT public.add_client_bid('up-alpha', 'X', 'Body')$$, '42501', NULL, 'a client cannot add a BID');
SELECT throws_ok($$SELECT public.upload_knowledge_document('X', 'Body', 'process')$$, '42501', NULL, 'a client cannot add knowledge');
SELECT throws_ok($$SELECT public.upload_brain_page('Playbooks', 'X', 'Body')$$, '42501', NULL, 'a client cannot add a Brain page');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('staff-documents', 'brain/x/y.md', auth.uid())$$, '42501', NULL,
  'a client cannot upload to the bucket');

-- ---------------------------------------------------------------- staff add documents (10-21)
SELECT set_config('request.jwt.claim.sub', 'e8000000-0000-4000-8000-000000000002', true);
CREATE TEMP TABLE made (k text, v text);
GRANT ALL ON made TO authenticated;

INSERT INTO made SELECT 'bid1', public.add_client_bid('up-alpha', ' Alpha BID ', E'## 1. Company\n\nMade-up text.', 'bid/e8aa0000-0000-4000-8000-000000000001/alpha.md', 'alpha.md', 'text/markdown', 120)::text;
SELECT is((SELECT version::text || ':' || source || ':' || data_origin FROM public.client_bids WHERE id = (SELECT v::uuid FROM made WHERE k = 'bid1')),
  '1:upload:real', 'an employee adds BID version 1 with source upload');
SELECT is(public.add_client_bid('up-alpha', 'Alpha BID again', E'## 1. Company\n\nMade-up text.')::text, (SELECT v FROM made WHERE k = 'bid1'),
  'the same BID text returns the same version');
SELECT is((SELECT (public.add_client_bid('up-alpha', 'Alpha BID', E'## 1. Company\n\nRevised text.') IS NOT NULL)::text || ':' || max(version)::text FROM public.client_bids WHERE client_slug = 'up-alpha'),
  'true:2', 'new BID text is version 2');
SELECT is((SELECT file_name || ':' || area FROM public.staff_document_files WHERE target_id = (SELECT v::uuid FROM made WHERE k = 'bid1')), 'alpha.md:bid',
  'the BID file record is saved');
SELECT throws_ok($$SELECT public.add_client_bid('up-alpha', 'X', 'Body', 'brain/e8/x.md', 'x.md', 'text/markdown', 10)$$, '22023', NULL,
  'a file path in the wrong folder is refused');
SELECT throws_ok($$SELECT public.add_client_bid('up-alpha', 'X', 'Body', 'bid/e8/x.exe', 'x.exe', 'application/x-msdownload', 10)$$, '22023', NULL,
  'a file type that is not allowed is refused');
SELECT throws_ok($$SELECT public.add_client_bid('up-alpha', 'X', 'Body', 'bid/e8/x.pdf', 'x.pdf', 'application/pdf', 10485761)$$, '22023', NULL,
  'a file over 10 MB is refused');

INSERT INTO made SELECT 'ks', public.upload_knowledge_document('Onboarding checklist', 'Step one.', 'process', 'up-alpha', 'knowledge/e8bb0000-0000-4000-8000-000000000001/list.pdf', 'list.pdf', 'application/pdf', 5000)::text;
SELECT is((SELECT namespace || ':' || classification || ':' || release_scope || ':' || client_slug FROM public.knowledge_sources WHERE id = (SELECT v::uuid FROM made WHERE k = 'ks')),
  'process:staff:client:up-alpha', 'knowledge is added as staff knowledge for the chosen client with the category');
SELECT is((SELECT (public.upload_knowledge_document('Long text', repeat('a', 50000), 'reference') IS NOT NULL)::text), 'true',
  'a knowledge document over 20,000 characters is accepted');
SELECT throws_ok($$SELECT public.upload_knowledge_document('X', 'Body', 'Bad Category')$$, '23514', NULL, 'a category that is not a lower case word is refused');

SELECT is((public.upload_brain_page('Playbooks', 'Launch Playbook!', E'# Launch\n\nSteps.', 'Sam'))->>'slug', 'launch-playbook', 'a Brain page gets a slug from its title');
SELECT is((public.upload_brain_page('Playbooks', 'Launch Playbook!', E'# Launch\n\nMore steps.'))->>'slug', 'launch-playbook-2', 'a second page with the same title gets a unique slug');

-- ---------------------------------------------------------------- results (22-24)
SELECT is((SELECT edited_in_app::text || ':' || owner || ':' || source_path LIKE 'app-upload/%' FROM public.brain_pages WHERE slug = 'launch-playbook'),
  'true:Sam:true', 'an uploaded page is marked edited in the app so the publish script keeps it');
SELECT throws_ok($$SELECT public.upload_brain_page('Notes', 'X', 'Body')$$, '23514', NULL, 'a section that is not one of the four is refused');

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e8000000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.staff_document_files), 0, 'a client reads no file records');

SELECT * FROM finish();
ROLLBACK;
