-- Public links, part 3: the application forms. Run with the local stack:  supabase test db
-- Everything is made up. now() does not move inside a transaction, so the tests set a draft's
-- created_at back by hand when the three second minimum fill time should have passed.

BEGIN;
SELECT plan(31);

INSERT INTO auth.users (id, email) VALUES ('a8300000-0000-4000-8000-000000000003', 'pl3-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES ('a8300000-0000-4000-8000-000000000003', 'client');

-- begin
CREATE TEMP TABLE ids AS SELECT public.public_application_begin('creator', 'iphash-a') AS creator_draft, public.public_application_begin('actor', 'iphash-b') AS actor_draft;
GRANT SELECT ON ids TO PUBLIC;
SELECT isnt((SELECT creator_draft FROM ids), NULL, 'begin returns a draft id');
SELECT is(public.public_application_begin('nonsense', 'iphash-a'), NULL, 'an unknown form kind gets no draft');
SELECT lives_ok($$SELECT public.public_application_begin('creator', 'iphash-many') FROM generate_series(1, 10)$$, 'ten drafts from one address are fine');
SELECT is(public.public_application_begin('creator', 'iphash-many'), NULL, 'the eleventh in an hour is refused');

UPDATE public.public_application_drafts SET created_at = now() - interval '1 minute';

-- reserve a file
SELECT is(public.public_application_reserve_file((SELECT creator_draft FROM ids), 'creator', 'video', 1000, 'video/mp4') ->> 'bucket', 'creator-application-videos', 'a video slot names the creator video bucket');
SELECT is(public.public_application_reserve_file((SELECT actor_draft FROM ids), 'actor', 'headshot', 1000, 'image/png') ->> 'bucket', 'actor-application-headshots', 'an actor headshot slot names the actor headshot bucket');
SELECT is(public.public_application_reserve_file((SELECT creator_draft FROM ids), 'creator', 'video', 1000, 'application/pdf') ->> 'status', 'bad_type', 'a pdf is not a video');
SELECT is(public.public_application_reserve_file((SELECT creator_draft FROM ids), 'creator', 'headshot', 6000000, 'image/jpeg') ->> 'status', 'too_large', 'a headshot over 5 MB is refused');
SELECT is(public.public_application_reserve_file((SELECT creator_draft FROM ids), 'creator', 'video', 300000000, 'video/mp4') ->> 'status', 'too_large', 'a video over 250 MB is refused');
SELECT is(public.public_application_reserve_file((SELECT creator_draft FROM ids), 'actor', 'video', 1000, 'video/mp4') ->> 'status', 'not_found', 'a creator draft cannot reserve on the actor form');
SELECT is(public.public_application_reserve_file(gen_random_uuid(), 'creator', 'video', 1000, 'video/mp4') ->> 'status', 'not_found', 'an unknown draft is not found');
SELECT lives_ok($$SELECT public.public_application_reserve_file((SELECT creator_draft FROM ids), 'creator', 'video', 1000, 'video/mp4') FROM generate_series(1, 7)$$, 'more video slots');
SELECT is(public.public_application_reserve_file((SELECT creator_draft FROM ids), 'creator', 'video', 1000, 'video/mp4') ->> 'status', 'too_many', 'a ninth video is refused');

-- submit, creator
CREATE TEMP TABLE p AS SELECT
  jsonb_build_object('name', ' Pat Test ', 'email', 'PAT@Example.test', 'socials', jsonb_build_object('instagram', 'pat'), 'categories', jsonb_build_array('food'),
    'alcohol_ok', true, 'headshot_path', 'applications/' || (SELECT creator_draft FROM ids) || '/headshot/a.jpg',
    'videos', jsonb_build_array(
      jsonb_build_object('storage_path', 'applications/' || (SELECT creator_draft FROM ids) || '/video/a.mp4'),
      jsonb_build_object('storage_path', 'applications/' || (SELECT creator_draft FROM ids) || '/video/b.mp4'),
      jsonb_build_object('storage_path', 'applications/' || (SELECT creator_draft FROM ids) || '/video/c.mp4'))) AS good;
SELECT is(public.public_application_submit('creator', (SELECT creator_draft FROM ids), 'iphash-a', (SELECT good || '{"email":"not an email"}'::jsonb FROM p)), 'invalid:email', 'a bad email is refused');
SELECT is(public.public_application_submit('creator', (SELECT creator_draft FROM ids), 'iphash-a', (SELECT good || '{"videos":[]}'::jsonb FROM p)), 'invalid:videos', 'a creator needs at least three videos');
SELECT is(public.public_application_submit('creator', (SELECT creator_draft FROM ids), 'iphash-a', (SELECT good || jsonb_build_object('headshot_path', 'applications/' || gen_random_uuid() || '/headshot/a.jpg') FROM p)), 'invalid:headshot', 'a file path inside another application''s folder is refused');
SELECT is((SELECT count(*)::int FROM public.creator_applications WHERE email = 'pat@example.test'), 0, 'refused submits wrote nothing');
SELECT is(public.public_application_submit('creator', (SELECT creator_draft FROM ids), 'iphash-a', (SELECT good FROM p)), 'ok', 'a good creator application is accepted');
SELECT is((SELECT name || '|' || status FROM public.creator_applications WHERE id = (SELECT creator_draft FROM ids)), 'Pat Test|pending', 'it is pending, with a cleaned name');
SELECT is((SELECT count(*)::int FROM public.application_videos WHERE application_id = (SELECT creator_draft FROM ids)), 3, 'its three videos are stored');
SELECT is(public.public_application_submit('creator', (SELECT creator_draft FROM ids), 'iphash-a', (SELECT good FROM p)), 'used', 'the same draft cannot submit twice');

-- a pending application for the same email is dropped without telling the form
CREATE TEMP TABLE ids2 AS SELECT public.public_application_begin('creator', 'iphash-c') AS d;
UPDATE public.public_application_drafts SET created_at = now() - interval '1 minute' WHERE id = (SELECT d FROM ids2);
SELECT is(public.public_application_submit('creator', (SELECT d FROM ids2), 'iphash-c', jsonb_build_object('name', 'Pat Again', 'email', 'pat@example.test', 'videos', jsonb_build_array(
  jsonb_build_object('storage_path', 'applications/' || (SELECT d FROM ids2) || '/video/a.mp4'), jsonb_build_object('storage_path', 'applications/' || (SELECT d FROM ids2) || '/video/b.mp4'), jsonb_build_object('storage_path', 'applications/' || (SELECT d FROM ids2) || '/video/c.mp4')))), 'ok', 'a repeat of a pending email says ok');
SELECT is((SELECT count(*)::int FROM public.creator_applications WHERE lower(email) = 'pat@example.test'), 1, 'and writes no second row');

-- submit, actor, plus the fill time and expiry
SELECT is(public.public_application_submit('actor', (SELECT actor_draft FROM ids), 'iphash-b', jsonb_build_object('name', 'Ari Actor', 'email', 'ari@example.test', 'gender', 'woman', 'age_range', jsonb_build_array('30s'), 'dog_owner', true, 'videos', jsonb_build_array(
  jsonb_build_object('storage_path', 'applications/' || (SELECT actor_draft FROM ids) || '/video/a.mp4')))), 'ok', 'a good actor application is accepted');
SELECT is((SELECT dog_owner::text || '|' || status FROM public.actor_applications WHERE id = (SELECT actor_draft FROM ids)), 'true|pending', 'it is pending with the dog answer');
CREATE TEMP TABLE ids3 AS SELECT public.public_application_begin('actor', 'iphash-d') AS d;
SELECT is(public.public_application_submit('actor', (SELECT d FROM ids3), 'iphash-d', '{}'::jsonb), 'too_fast', 'a submit within three seconds of opening is dropped');
UPDATE public.public_application_drafts SET created_at = now() - interval '3 hours', expires_at = now() - interval '1 hour' WHERE id = (SELECT d FROM ids3);
SELECT is(public.public_application_submit('actor', (SELECT d FROM ids3), 'iphash-d', '{}'::jsonb), 'expired', 'an old draft is expired');

-- the wall
SET LOCAL role anon;
SELECT throws_ok($$SELECT * FROM public.public_application_drafts$$, '42501', NULL, 'anon cannot read drafts');
SELECT throws_ok($$SELECT public.public_application_begin('creator', 'x')$$, '42501', NULL, 'anon cannot start a draft through the database');
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'a8300000-0000-4000-8000-000000000003', true);
SELECT throws_ok($$SELECT public.public_application_submit('creator', gen_random_uuid(), 'x', '{}'::jsonb)$$, '42501', NULL, 'a client login cannot submit through the database');
SELECT throws_ok($$SELECT * FROM public.public_application_drafts$$, '42501', NULL, 'a client login cannot read drafts');

SELECT * FROM finish();
ROLLBACK;
