-- Public application uploads: byte caps, the discard marker and the cleanup candidates
-- (migration 20261208100003). Run with the local stack:  supabase test db
--
-- Checks: a draft cannot reserve more than 1 GiB in total and one address not more than 3 GiB in
-- 24 hours; a submit dropped as a repeat of a pending email marks the draft discarded; the cleanup
-- candidates are the expired never-submitted drafts (after the 3 hour grace) and the discarded ones,
-- never a draft with an application, never one an application video points into; marking refuses an
-- ineligible draft; the tidy-up in public_application_begin keeps drafts whose files are not cleaned;
-- the folder check protects folders with an application; every new function is service role only.
-- Everything is made up. now() does not move inside a transaction, so times are set by hand.

BEGIN;
SELECT plan(31);

CREATE FUNCTION pg_temp.payload(p_draft uuid, p_email text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('name', 'Pat Test', 'email', p_email, 'videos', jsonb_build_array(
    jsonb_build_object('storage_path', 'applications/' || p_draft || '/video/a.mp4'),
    jsonb_build_object('storage_path', 'applications/' || p_draft || '/video/b.mp4'),
    jsonb_build_object('storage_path', 'applications/' || p_draft || '/video/c.mp4')))
$$ LANGUAGE sql;

CREATE TEMP TABLE ids AS SELECT
  public.public_application_begin('creator', 'cl-ip-a') AS cap_draft,
  public.public_application_begin('creator', 'cl-ip-b') AS keep_app,
  public.public_application_begin('creator', 'cl-ip-c') AS dup_app,
  public.public_application_begin('creator', 'cl-ip-d') AS expired_old,
  public.public_application_begin('actor', 'cl-ip-e') AS expired_recent,
  public.public_application_begin('creator', 'cl-ip-f') AS referenced,
  public.public_application_begin('creator', 'cl-ip-g') AS tidy_keep,
  public.public_application_begin('creator', 'cl-ip-h') AS tidy_drop;
UPDATE public.public_application_drafts SET created_at = now() - interval '1 minute';

-- ---------------------------------------------------------------- byte caps (1-8)
SELECT is((SELECT count(*)::int FROM generate_series(1, 4) g
            WHERE public.public_application_reserve_file((SELECT cap_draft FROM ids), 'creator', 'video', 262144000, 'video/mp4') ->> 'status' = 'ok'), 4,
  'four 250 MB videos fit in one draft');
SELECT is(public.public_application_reserve_file((SELECT cap_draft FROM ids), 'creator', 'video', 262144000, 'video/mp4') ->> 'status', 'too_large',
  'a fifth would pass 1 GiB for the draft and is refused');
SELECT is(public.public_application_reserve_file((SELECT cap_draft FROM ids), 'creator', 'video', 1000, 'video/mp4') ->> 'status', 'ok',
  'a small file still fits under the cap');
SELECT is((SELECT reserved_bytes FROM public.public_application_drafts WHERE id = (SELECT cap_draft FROM ids)), 4 * 262144000::bigint + 1000,
  'the draft records the bytes reserved');

CREATE TEMP TABLE addr AS SELECT n, public.public_application_begin('creator', 'cl-ip-quota') AS d FROM generate_series(1, 4) n;
UPDATE public.public_application_drafts SET created_at = now() - interval '1 minute' WHERE ip_hash = 'cl-ip-quota';
DO $$
DECLARE r record; i integer;
BEGIN
  FOR r IN SELECT d FROM addr WHERE n <= 3 ORDER BY n LOOP
    FOR i IN 1..4 LOOP
      PERFORM public.public_application_reserve_file(r.d, 'creator', 'video', 262144000, 'video/mp4');
    END LOOP;
  END LOOP;
END $$;
SELECT is((SELECT sum(reserved_bytes) FROM public.public_application_drafts WHERE ip_hash = 'cl-ip-quota')::bigint, 3 * 4 * 262144000::bigint,
  'three drafts from one address take 3 x 1000 MB');
SELECT diag(format('address bytes before the fourth draft: %s over %s drafts', (SELECT sum(reserved_bytes) FROM public.public_application_drafts WHERE ip_hash = 'cl-ip-quota'), (SELECT count(*) FROM public.public_application_drafts WHERE ip_hash = 'cl-ip-quota')));
SELECT is(public.public_application_reserve_file((SELECT d FROM addr WHERE n = 4), 'creator', 'video', 262144000, 'video/mp4') ->> 'status', 'quota',
  'the next draft from the same address passes 3 GiB in 24 hours and is refused');
UPDATE public.public_application_drafts SET created_at = now() - interval '2 days' WHERE ip_hash = 'cl-ip-quota' AND id <> (SELECT d FROM addr WHERE n = 4);
SELECT is(public.public_application_reserve_file((SELECT d FROM addr WHERE n = 4), 'creator', 'video', 262144000, 'video/mp4') ->> 'status', 'ok',
  'the address is free again once the old drafts are more than 24 hours old');
SELECT is(public.public_application_reserve_file((SELECT keep_app FROM ids), 'creator', 'video', 262144000, 'video/mp4') ->> 'status', 'ok',
  'another address is not affected');

-- ---------------------------------------------------------------- discard marker (9-10)
SELECT is(public.public_application_submit('creator', (SELECT keep_app FROM ids), 'cl-ip-b', pg_temp.payload((SELECT keep_app FROM ids), 'dup@cl.example.test')), 'ok',
  'a good application is accepted');
SELECT is(public.public_application_submit('creator', (SELECT dup_app FROM ids), 'cl-ip-c', pg_temp.payload((SELECT dup_app FROM ids), 'DUP@cl.example.test')), 'ok',
  'a repeat of a pending email says ok');
SELECT isnt((SELECT discarded_at FROM public.public_application_drafts WHERE id = (SELECT dup_app FROM ids)), NULL,
  'the repeat marks its draft discarded so its files can be cleaned');
SELECT is((SELECT discarded_at FROM public.public_application_drafts WHERE id = (SELECT keep_app FROM ids)), NULL,
  'the accepted application is not marked discarded');

-- ---------------------------------------------------------------- candidates (12-17)
UPDATE public.public_application_drafts SET expires_at = now() - interval '4 hours' WHERE id IN (SELECT expired_old FROM ids UNION SELECT referenced FROM ids);
UPDATE public.public_application_drafts SET expires_at = now() - interval '1 hour' WHERE id = (SELECT expired_recent FROM ids);
UPDATE public.public_application_drafts SET expires_at = now() - interval '4 hours' WHERE id = (SELECT keep_app FROM ids);
UPDATE public.public_application_drafts SET discarded_at = now() - interval '4 hours' WHERE id = (SELECT dup_app FROM ids);
-- an application video that points into the folder of the draft called "referenced"
INSERT INTO public.application_videos (application_id, storage_path, sort_order)
VALUES ((SELECT keep_app FROM ids), 'applications/' || (SELECT referenced FROM ids) || '/video/kept.mp4', 99);

CREATE TEMP TABLE cand AS SELECT * FROM public.public_application_cleanup_candidates(100) WHERE draft_id IN (SELECT unnest(ARRAY[
  (SELECT cap_draft FROM ids), (SELECT keep_app FROM ids), (SELECT dup_app FROM ids), (SELECT expired_old FROM ids),
  (SELECT expired_recent FROM ids), (SELECT referenced FROM ids)]));
SELECT ok((SELECT count(*) FROM cand WHERE draft_id = (SELECT expired_old FROM ids)) = 1, 'a draft that expired more than 3 hours ago and was never submitted is a candidate');
SELECT ok((SELECT count(*) FROM cand WHERE draft_id = (SELECT dup_app FROM ids)) = 1, 'a discarded draft is a candidate');
SELECT ok((SELECT count(*) FROM cand WHERE draft_id = (SELECT expired_recent FROM ids)) = 0, 'a draft that expired one hour ago waits out the grace');
SELECT ok((SELECT count(*) FROM cand WHERE draft_id = (SELECT keep_app FROM ids)) = 0, 'a draft with an application is never a candidate');
SELECT ok((SELECT count(*) FROM cand WHERE draft_id = (SELECT referenced FROM ids)) = 0, 'a draft an application video points into is never a candidate');
SELECT ok((SELECT count(*) FROM cand WHERE draft_id = (SELECT cap_draft FROM ids)) = 0, 'a draft that has not expired is never a candidate');
SELECT is((SELECT count(*)::int FROM public.public_application_cleanup_candidates(1)), 1, 'the limit is honoured');

-- ---------------------------------------------------------------- marking (18-19)
SELECT is(public.public_application_cleanup_mark(ARRAY[
  (SELECT expired_old FROM ids), (SELECT dup_app FROM ids), (SELECT expired_recent FROM ids),
  (SELECT keep_app FROM ids), (SELECT referenced FROM ids), gen_random_uuid()]), 2,
  'marking cleans only the eligible drafts');
SELECT is((SELECT count(*)::int FROM public.public_application_drafts WHERE cleaned_at IS NOT NULL AND id IN (SELECT keep_app FROM ids UNION SELECT referenced FROM ids UNION SELECT expired_recent FROM ids)), 0,
  'the application, referenced and recent drafts are not marked');

-- ---------------------------------------------------------------- tidy-up and folders (20-23)
UPDATE public.public_application_drafts SET created_at = now() - interval '3 days'
 WHERE id IN (SELECT tidy_keep FROM ids UNION SELECT tidy_drop FROM ids UNION SELECT expired_old FROM ids UNION SELECT keep_app FROM ids);
UPDATE public.public_application_drafts SET cleaned_at = now() WHERE id = (SELECT tidy_drop FROM ids);
SELECT isnt(public.public_application_begin('creator', 'cl-ip-tidy'), NULL, 'begin still works');
SELECT is((SELECT count(*)::int FROM public.public_application_drafts WHERE id = (SELECT tidy_keep FROM ids)), 1,
  'the tidy-up keeps an old draft whose files are not cleaned');
SELECT is((SELECT count(*)::int FROM public.public_application_drafts WHERE id IN (SELECT tidy_drop FROM ids UNION SELECT expired_old FROM ids)), 0,
  'the tidy-up drops old drafts whose files are cleaned');
SELECT is((SELECT array_agg(x ORDER BY x) FROM public.public_application_unprotected_ids(ARRAY[
  (SELECT keep_app FROM ids), (SELECT tidy_keep FROM ids), '00000000-0000-4000-8000-0000000000aa'::uuid]) x),
  ARRAY['00000000-0000-4000-8000-0000000000aa'::uuid],
  'a folder is unprotected only when no draft row, application or path reference keeps it');

-- ---------------------------------------------------------------- the wall (24-29)
SELECT is((SELECT count(*)::int FROM unnest(ARRAY[
  'public.public_application_cleanup_candidates(integer)', 'public.public_application_cleanup_mark(uuid[])',
  'public.public_application_unprotected_ids(uuid[])', 'public.public_application_folder_in_use(uuid)']) f
  WHERE has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE')), 0,
  'the cleanup functions are not callable by anon or signed-in users');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY[
  'public.public_application_cleanup_candidates(integer)', 'public.public_application_cleanup_mark(uuid[])',
  'public.public_application_unprotected_ids(uuid[])', 'public.public_application_folder_in_use(uuid)']) f
  WHERE NOT has_function_privilege('service_role', f, 'EXECUTE')), 0,
  'the service role can call them');
SELECT ok(NOT has_function_privilege('authenticated', 'public.public_application_reserve_file(uuid, text, text, bigint, text)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.public_application_submit(text, uuid, text, jsonb)', 'EXECUTE'),
  'reserve and submit grants are unchanged');
SET LOCAL role anon;
SELECT throws_ok($$SELECT public.public_application_cleanup_mark(ARRAY[gen_random_uuid()])$$, '42501', NULL, 'anon cannot mark drafts cleaned');
SET LOCAL role authenticated;
SELECT throws_ok($$SELECT * FROM public.public_application_cleanup_candidates(10)$$, '42501', NULL, 'a signed-in user cannot list candidates');
SELECT throws_ok($$SELECT * FROM public.public_application_unprotected_ids(ARRAY[gen_random_uuid()])$$, '42501', NULL, 'a signed-in user cannot probe folders');

SELECT * FROM finish();
ROLLBACK;
