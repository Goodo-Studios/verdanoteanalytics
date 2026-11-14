-- OS-020: cut review inside the task.
--
-- Covers: staff add numbered versions; a client lists the versions of their own task only, and only
-- once it is in a client stage; a client posts a timestamped client comment; a client cannot post
-- internal; a client never receives internal comments (timestamped ones included); another client
-- gets nothing; a client cannot insert versions; no open read policy on the new table.
-- All rows are made up.

BEGIN;
SELECT plan(33);

INSERT INTO auth.users (id, email) VALUES
  ('e2000000-0000-4000-8000-000000000001', 'cr-builder@example.test'),
  ('e2000000-0000-4000-8000-000000000002', 'cr-client-a@example.test'),
  ('e2000000-0000-4000-8000-000000000003', 'cr-client-b@example.test'),
  ('e2000000-0000-4000-8000-000000000004', 'cr-nobody@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e2000000-0000-4000-8000-000000000001', 'builder'),
  ('e2000000-0000-4000-8000-000000000002', 'client'),
  ('e2000000-0000-4000-8000-000000000003', 'client');
INSERT INTO public.clients (slug, name, status) VALUES ('cr-alpha', 'CR Alpha', 'active'), ('cr-beta', 'CR Beta', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES
  ('e2000000-0000-4000-8000-000000000002', 'cr-alpha'),
  ('e2000000-0000-4000-8000-000000000003', 'cr-beta');

-- Alpha in Client Review, Alpha still in editing, Beta in Client Review.
INSERT INTO public.os_tasks (id, client_slug, title, status) VALUES
  ('a2000000-0000-4000-8000-000000000001', 'cr-alpha', 'Alpha cut', 'client review'),
  ('a2000000-0000-4000-8000-000000000002', 'cr-alpha', 'Alpha editing', 'editing'),
  ('a2000000-0000-4000-8000-000000000003', 'cr-beta', 'Beta cut', 'client review');

-- ---------------------------------------------------------------- structure (1-7)
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.os_task_versions'::regclass), 'row rules are on for os_task_versions');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'os_task_versions'
              AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0,
  'signed-in users cannot write os_task_versions directly');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'os_task_versions' AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on os_task_versions');
SELECT is((SELECT count(*)::int FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'os_task_versions'
              AND (lower(regexp_replace(coalesce(qual, ''), '\s', '', 'g')) IN ('true', '(true)')
                   OR lower(regexp_replace(coalesce(qual, ''), '\s', '', 'g')) LIKE '%auth.uid()isnotnull%')), 0,
  'no open read policy on os_task_versions');
SELECT ok(NOT has_function_privilege('anon', 'public.os_client_task_versions(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.post_task_version_comment(uuid,text,text,integer)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.list_task_version_comments(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.os_add_task_version(uuid,text,text)', 'EXECUTE'),
  'anon cannot call the cut review functions');
SELECT ok(NOT has_function_privilege('authenticated', 'public.os_client_can_see_cuts(uuid)', 'EXECUTE'),
  'the internal helper is not callable by signed-in users');
SELECT throws_ok($$INSERT INTO public.os_task_comments (task_id, thread, body, author, timecode_ms) VALUES ('a2000000-0000-4000-8000-000000000001', 'internal', 'x', '{}', 5)$$,
  '23514', NULL, 'a timecode needs a version');

-- ---------------------------------------------------------------- staff add versions (8-13)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000001', true);
SELECT is((public.os_add_task_version('a2000000-0000-4000-8000-000000000001', 'https://example.test/v1.mp4', 'First cut')->>'version_no')::int, 1,
  'the first version is number 1');
SELECT is((public.os_add_task_version('a2000000-0000-4000-8000-000000000001', 'https://example.test/v2.mp4', NULL)->>'version_no')::int, 2,
  'the next version is number 2');
SELECT is((public.os_add_task_version('a2000000-0000-4000-8000-000000000002', 'https://example.test/e1.mp4', NULL)->>'version_no')::int, 1,
  'numbering is per task');
SELECT is((public.os_add_task_version('a2000000-0000-4000-8000-000000000003', 'https://example.test/b1.mp4', NULL)->>'version_no')::int, 1,
  'Beta gets its own version 1');
SELECT throws_ok($$SELECT public.os_add_task_version('a2000000-0000-4000-8000-000000000001', 'http://example.test/v.mp4', NULL)$$,
  '22023', NULL, 'a plain http link is refused');
SELECT is((SELECT count(*)::int FROM public.os_task_versions), 4, 'staff read the versions directly');

-- Ids for later, read as the table owner.
RESET role;
CREATE TEMP TABLE ids ON COMMIT DROP AS
  SELECT (SELECT id FROM public.os_task_versions WHERE task_id = 'a2000000-0000-4000-8000-000000000001' AND version_no = 2) AS a2,
         (SELECT id FROM public.os_task_versions WHERE task_id = 'a2000000-0000-4000-8000-000000000002' AND version_no = 1) AS e1,
         (SELECT id FROM public.os_task_versions WHERE task_id = 'a2000000-0000-4000-8000-000000000003' AND version_no = 1) AS b1;
GRANT SELECT ON ids TO authenticated;
SET LOCAL role authenticated;

-- Staff comments on Alpha v2: internal with a timecode, internal without, client with a timecode.
SELECT public.post_task_version_comment((SELECT a2 FROM ids), 'internal', 'CR internal at 12s', 12000);
SELECT public.post_task_version_comment((SELECT a2 FROM ids), 'internal', 'CR internal whole cut', NULL);
SELECT public.post_task_version_comment((SELECT a2 FROM ids), 'client', 'CR staff to client at 3s', 3000);

-- ---------------------------------------------------------------- client A (14-27)
SELECT set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000002', true);
SELECT is((SELECT count(*)::int FROM public.os_task_versions), 0, 'a client reads no os_task_versions row directly');
SELECT throws_ok($$INSERT INTO public.os_task_versions (task_id, version_no, video_url) VALUES ('a2000000-0000-4000-8000-000000000001', 9, 'https://example.test/x.mp4')$$,
  '42501', NULL, 'a client cannot insert a version');
SELECT throws_ok($$SELECT public.os_add_task_version('a2000000-0000-4000-8000-000000000001', 'https://example.test/x.mp4', NULL)$$,
  '42501', NULL, 'a client cannot add a version through the function');
SELECT is(ARRAY(SELECT version_no FROM public.os_client_task_versions('a2000000-0000-4000-8000-000000000001')), ARRAY[2, 1],
  'client A lists the versions of their task, latest first');
SELECT is((SELECT count(*)::int FROM public.os_client_task_versions('a2000000-0000-4000-8000-000000000002')), 0,
  'client A sees no versions of a task still in editing');
SELECT is((SELECT count(*)::int FROM public.os_client_task_versions('a2000000-0000-4000-8000-000000000003')), 0,
  'client A sees no versions of another client''s task');
SELECT ok(public.post_task_version_comment((SELECT a2 FROM ids), 'client', 'CR client at 1:05', 65000) IS NOT NULL,
  'client A posts a timestamped client comment');
SELECT is((SELECT timecode_ms FROM public.list_task_version_comments((SELECT a2 FROM ids)) WHERE body = 'CR client at 1:05'), 65000,
  'the comment keeps its timecode');
SELECT throws_ok($$SELECT public.post_task_version_comment((SELECT a2 FROM ids), 'internal', 'sneaky', 1000)$$,
  '42501', NULL, 'client A cannot post internal');
SELECT throws_ok($$SELECT public.post_task_version_comment((SELECT e1 FROM ids), 'client', 'early', 1000)$$,
  '42501', NULL, 'client A cannot comment on a cut not yet sent for review');
SELECT throws_ok($$SELECT public.post_task_version_comment((SELECT b1 FROM ids), 'client', 'other', 1000)$$,
  '42501', NULL, 'client A cannot comment on another client''s cut');
SELECT is(ARRAY(SELECT body FROM public.list_task_version_comments((SELECT a2 FROM ids))),
  ARRAY['CR staff to client at 3s', 'CR client at 1:05'],
  'client A reads only client comments, sorted by timecode');
SELECT is((SELECT count(*)::int FROM public.list_task_version_comments((SELECT a2 FROM ids)) WHERE thread = 'internal' OR body LIKE 'CR internal%'), 0,
  'client A never receives internal comments, timestamped or not');
SELECT is((SELECT count(*)::int FROM public.list_task_comments('a2000000-0000-4000-8000-000000000001')), 0,
  'cut comments are not repeated in the general task comments');

-- ---------------------------------------------------------------- client B and no role (28-30)
SELECT set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.os_client_task_versions('a2000000-0000-4000-8000-000000000001')), 0,
  'client B gets no versions of client A''s task');
SELECT is((SELECT count(*)::int FROM public.list_task_version_comments((SELECT a2 FROM ids))), 0,
  'client B gets no comments of client A''s cut');
SELECT set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000004', true);
SELECT is((SELECT count(*)::int FROM public.list_task_version_comments((SELECT a2 FROM ids))), 0,
  'a login with no role gets no cut comments');

-- ---------------------------------------------------------------- staff read both (31-33)
SELECT set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000001', true);
SELECT is((SELECT count(*)::int FROM public.list_task_version_comments((SELECT a2 FROM ids))), 4,
  'staff read both threads of the cut');
SELECT is(ARRAY(SELECT body FROM public.list_task_version_comments((SELECT a2 FROM ids))),
  ARRAY['CR staff to client at 3s', 'CR internal at 12s', 'CR client at 1:05', 'CR internal whole cut'],
  'staff comments sort by timecode, whole-cut comments last');
SELECT is((SELECT count(*)::int FROM public.os_task_comments WHERE version_id = (SELECT a2 FROM ids) AND thread = 'internal'), 2,
  'the internal cut comments are stored in the internal thread');

SELECT * FROM finish();
ROLLBACK;
