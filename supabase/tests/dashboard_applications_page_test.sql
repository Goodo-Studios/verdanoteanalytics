-- Old dashboard batch 2 (step 5b): the Applications page reads
-- creator_applications, application_videos, actor_applications,
-- actor_application_videos and the application media buckets, and decides
-- through approve_application, reject_application, approve_actor_application
-- and reject_actor_application (migration 20261101000002).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Who is who (all made up):
--   client A   linked to ad account act_b2p_a
--   client B   member of client b2p-alpha
--   employee   staff, on the dashboard team list (app_users) by email
-- Applicant emails, phone numbers and shipping addresses are staff only. No
-- application here has files, so approving makes no storage call.

BEGIN;
SELECT plan(31);

-- ---------------------------------------------------------------- fixtures
INSERT INTO auth.users (id, email) VALUES
  ('b2b00000-0000-4000-8000-000000000002', 'b2p-employee@example.test'),
  ('b2b00000-0000-4000-8000-000000000003', 'b2p-client-a@example.test'),
  ('b2b00000-0000-4000-8000-000000000004', 'b2p-client-b@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('b2b00000-0000-4000-8000-000000000002', 'employee'),
  ('b2b00000-0000-4000-8000-000000000003', 'client'),
  ('b2b00000-0000-4000-8000-000000000004', 'client');
INSERT INTO public.ad_accounts (id, name) VALUES ('act_b2p_a', 'B2P Alpha');
INSERT INTO public.user_accounts (user_id, account_id) VALUES ('b2b00000-0000-4000-8000-000000000003', 'act_b2p_a');
INSERT INTO public.clients (slug, name, status, origin) VALUES ('b2p-alpha', 'B2P Alpha', 'active', 'manual');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('b2b00000-0000-4000-8000-000000000004', 'b2p-alpha');
INSERT INTO public.app_users (id, name, email, role) VALUES
  ('b2b00000-0000-4000-8000-0000000000e1', 'B2P Producer', 'B2P-Employee@example.test', 'producer');

INSERT INTO public.creator_applications (id, name, email, shipping_address, categories, location) VALUES
  ('b2b00000-0000-4000-8000-0000000000a1', 'B2P Applicant One', 'one@example.test', '9 Applicant Road', ARRAY['Pet'], 'Testville'),
  ('b2b00000-0000-4000-8000-0000000000a2', 'B2P Applicant Two', 'two@example.test', NULL, ARRAY['Tech'], 'Testville');
INSERT INTO public.application_videos (application_id, storage_path, sort_order) VALUES
  ('b2b00000-0000-4000-8000-0000000000a2', 'apps/two/video.mp4', 1);
INSERT INTO public.actor_applications (id, name, email, phone) VALUES
  ('b2b00000-0000-4000-8000-0000000000b1', 'B2P Actor Applicant', 'actor-one@example.test', '555-0170');
INSERT INTO storage.objects (bucket_id, name) VALUES ('creator-application-headshots', 'apps/one/headshot.jpg');

-- ---------------------------------------------------------------- client wall
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'b2b00000-0000-4000-8000-000000000003', true);

SELECT is((SELECT count(*)::int FROM public.creator_applications), 0, 'client A reads no creator applications');
SELECT is((SELECT count(*)::int FROM public.application_videos), 0, 'client A reads no application videos');
SELECT is((SELECT count(*)::int FROM public.actor_applications), 0, 'client A reads no actor applications, so no applicant phone');
SELECT is((SELECT count(*)::int FROM public.actor_application_videos), 0, 'client A reads no actor application videos');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'creator-application-headshots'), 0, 'client A cannot see applicant headshot files');
SELECT throws_ok($$INSERT INTO public.creator_applications (name, email) VALUES ('x', 'x@example.test')$$, '42501', NULL, 'client A cannot add an application');
SELECT throws_ok($$SELECT public.approve_application('b2b00000-0000-4000-8000-0000000000a1')$$, '42501', NULL, 'client A is refused approve_application');
SELECT throws_ok($$SELECT public.reject_application('b2b00000-0000-4000-8000-0000000000a1', 'no')$$, '42501', NULL, 'client A is refused reject_application');
SELECT throws_ok($$SELECT public.approve_actor_application('b2b00000-0000-4000-8000-0000000000b1')$$, '42501', NULL, 'client A is refused approve_actor_application');
SELECT throws_ok($$SELECT public.reject_actor_application('b2b00000-0000-4000-8000-0000000000b1', 'no')$$, '42501', NULL, 'client A is refused reject_actor_application');

SELECT set_config('request.jwt.claim.sub', 'b2b00000-0000-4000-8000-000000000004', true);
SELECT is((SELECT count(*)::int FROM public.creator_applications), 0, 'client B reads no creator applications');
SELECT is((SELECT count(*)::int FROM public.actor_applications), 0, 'client B reads no actor applications');
SELECT throws_ok($$SELECT public.approve_application('b2b00000-0000-4000-8000-0000000000a1')$$, '42501', NULL, 'client B is refused approve_application');
SELECT throws_ok($$SELECT public.reject_actor_application('b2b00000-0000-4000-8000-0000000000b1', 'no')$$, '42501', NULL, 'client B is refused reject_actor_application');

-- ---------------------------------------------------------------- employee
SELECT set_config('request.jwt.claim.sub', 'b2b00000-0000-4000-8000-000000000002', true);

SELECT is((SELECT status FROM public.creator_applications WHERE id = 'b2b00000-0000-4000-8000-0000000000a1'), 'pending', 'the client calls changed nothing');
SELECT is((SELECT shipping_address FROM public.creator_applications WHERE id = 'b2b00000-0000-4000-8000-0000000000a1'), '9 Applicant Road', 'employee reads the application');
SELECT is((SELECT count(*)::int FROM public.application_videos WHERE application_id = 'b2b00000-0000-4000-8000-0000000000a2'), 1, 'employee reads application videos');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'creator-application-headshots'), 1, 'employee sees applicant headshot files');
SELECT throws_ok($$UPDATE public.creator_applications SET status = 'approved' WHERE id = 'b2b00000-0000-4000-8000-0000000000a1'$$,
  '42501', NULL, 'even staff cannot set a status directly; decisions go through the functions');

SELECT throws_ok($$SELECT public.reject_application('b2b00000-0000-4000-8000-0000000000a2', '  ')$$, '22023', NULL, 'a rejection needs a reason');
SELECT lives_ok($$SELECT public.reject_application('b2b00000-0000-4000-8000-0000000000a2', 'Not a fit this round')$$, 'employee rejects with a reason');
SELECT is(
  (SELECT status || '|' || review_notes || '|' || coalesce(reviewed_by::text, 'none') FROM public.creator_applications WHERE id = 'b2b00000-0000-4000-8000-0000000000a2'),
  'rejected|Not a fit this round|b2b00000-0000-4000-8000-0000000000e1',
  'the rejection keeps the reason and the reviewer, matched to the team list by email in any case');
SELECT throws_ok($$SELECT public.approve_application('b2b00000-0000-4000-8000-0000000000a2')$$, '55000', NULL, 'a rejected application cannot be approved');

SELECT lives_ok($$SELECT public.approve_application('b2b00000-0000-4000-8000-0000000000a1')$$, 'employee approves a creator application');
SELECT is((SELECT status FROM public.creator_applications WHERE id = 'b2b00000-0000-4000-8000-0000000000a1'), 'approved', 'the application is approved');
SELECT is(
  (SELECT source || '|' || shipping_address || '|' || array_to_string(categories, ',') FROM public.dashboard_creators WHERE email = 'one@example.test'),
  'application|9 Applicant Road|Pet', 'the applicant is on the creator roster with their details');
SELECT throws_ok($$SELECT public.approve_application('b2b00000-0000-4000-8000-0000000000a1')$$, '55000', NULL, 'approving twice is refused');
SELECT throws_ok($$SELECT public.approve_application('b2b00000-0000-4000-8000-0000000000ff')$$, 'P0002', NULL, 'an unknown application is refused');

SELECT lives_ok($$SELECT public.approve_actor_application('b2b00000-0000-4000-8000-0000000000b1')$$, 'employee approves an actor application');
SELECT is((SELECT phone || '|' || source FROM public.actors WHERE email = 'actor-one@example.test'), '555-0170|application', 'the applicant is on the actor roster');
SELECT is((SELECT status FROM public.actor_applications WHERE id = 'b2b00000-0000-4000-8000-0000000000b1'), 'approved', 'the actor application is approved');

SELECT * FROM finish();
ROLLBACK;
