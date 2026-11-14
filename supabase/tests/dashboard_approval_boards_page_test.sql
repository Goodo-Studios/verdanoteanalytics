-- Old dashboard batch 2 (step 5b): the Approval boards page reads and writes
-- approval_boards and approval_votes directly under the staff rules and
-- applies votes through apply_approval_votes (migration 20261101000002).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Who is who (all made up):
--   client A   linked to ad account act_b2v_a, which belongs to client b2v-alpha
--   client B   member of client b2v-alpha
--   employee   staff
-- A board token opens the public approval page without a login, so no client
-- login may read one, not even for its own client.

BEGIN;
SELECT plan(24);

-- ---------------------------------------------------------------- fixtures
INSERT INTO auth.users (id, email) VALUES
  ('b2d00000-0000-4000-8000-000000000002', 'b2v-employee@example.test'),
  ('b2d00000-0000-4000-8000-000000000003', 'b2v-client-a@example.test'),
  ('b2d00000-0000-4000-8000-000000000004', 'b2v-client-b@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('b2d00000-0000-4000-8000-000000000002', 'employee'),
  ('b2d00000-0000-4000-8000-000000000003', 'client'),
  ('b2d00000-0000-4000-8000-000000000004', 'client');
INSERT INTO public.ad_accounts (id, name) VALUES ('act_b2v_a', 'B2V Alpha');
INSERT INTO public.user_accounts (user_id, account_id) VALUES ('b2d00000-0000-4000-8000-000000000003', 'act_b2v_a');
INSERT INTO public.clients (slug, name, status, origin) VALUES
  ('b2v-alpha', 'B2V Alpha', 'active', 'manual'),
  ('b2v-beta', 'B2V Beta', 'active', 'manual');
INSERT INTO public.client_ad_accounts (account_id, client_slug) VALUES ('act_b2v_a', 'b2v-alpha');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('b2d00000-0000-4000-8000-000000000004', 'b2v-alpha');

INSERT INTO public.dashboard_creators (id, name) VALUES
  ('b2d00000-0000-4000-8000-0000000000c1', 'B2V One'),
  ('b2d00000-0000-4000-8000-0000000000c2', 'B2V Two'),
  ('b2d00000-0000-4000-8000-0000000000c3', 'B2V Three');
INSERT INTO public.creator_assignments (id, creator_id, client_slug, stage) VALUES
  ('b2d00000-0000-4000-8000-0000000000d1', 'b2d00000-0000-4000-8000-0000000000c1', 'b2v-alpha', 'shortlisted'),
  ('b2d00000-0000-4000-8000-0000000000d2', 'b2d00000-0000-4000-8000-0000000000c2', 'b2v-alpha', 'shortlisted'),
  ('b2d00000-0000-4000-8000-0000000000d3', 'b2d00000-0000-4000-8000-0000000000c3', 'b2v-beta', 'shortlisted');
INSERT INTO public.approval_boards (id, client_slug, token, expires_at) VALUES
  ('b2d00000-0000-4000-8000-0000000000b1', 'b2v-alpha', 'b2vSecretTokenAlpha000000000000000000000000000001', now() + interval '7 days');
INSERT INTO public.approval_votes (board_id, assignment_id, vote, voted_by) VALUES
  ('b2d00000-0000-4000-8000-0000000000b1', 'b2d00000-0000-4000-8000-0000000000d1', 'up', 'Sam'),
  ('b2d00000-0000-4000-8000-0000000000b1', 'b2d00000-0000-4000-8000-0000000000d2', 'down', NULL);

-- ---------------------------------------------------------------- client wall
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'b2d00000-0000-4000-8000-000000000003', true);

SELECT is((SELECT count(*)::int FROM public.approval_boards), 0, 'client A reads no approval boards, so no token, not even its own client''s');
SELECT is((SELECT count(*)::int FROM public.approval_votes), 0, 'client A reads no votes');
SELECT throws_ok($$INSERT INTO public.approval_boards (client_slug, token, expires_at) VALUES ('b2v-alpha', 'clientmade', now() + interval '1 day')$$,
  '42501', NULL, 'client A cannot make a link');
SELECT lives_ok($$UPDATE public.approval_boards SET revoked = true WHERE id = 'b2d00000-0000-4000-8000-0000000000b1'$$, 'client A revoke runs but matches no row');
SELECT throws_ok($$INSERT INTO public.approval_votes (board_id, assignment_id, vote) VALUES ('b2d00000-0000-4000-8000-0000000000b1', 'b2d00000-0000-4000-8000-0000000000d3', 'up')$$,
  '42501', NULL, 'client A cannot cast a vote through the table');
SELECT throws_ok($$SELECT public.apply_approval_votes('b2v-alpha', '[{"assignment_id":"b2d00000-0000-4000-8000-0000000000d1","vote":"up"}]'::jsonb)$$,
  '42501', NULL, 'client A is refused apply_approval_votes');

SELECT set_config('request.jwt.claim.sub', 'b2d00000-0000-4000-8000-000000000004', true);
SELECT is((SELECT count(*)::int FROM public.approval_boards), 0, 'client B (member of the client) reads no approval boards');
SELECT is((SELECT count(*)::int FROM public.approval_votes), 0, 'client B reads no votes');
SELECT lives_ok($$DELETE FROM public.approval_votes$$, 'client B delete runs but matches no row');
SELECT throws_ok($$SELECT public.apply_approval_votes('b2v-alpha', '[]'::jsonb)$$, '42501', NULL, 'client B is refused apply_approval_votes');

-- ---------------------------------------------------------------- employee
SELECT set_config('request.jwt.claim.sub', 'b2d00000-0000-4000-8000-000000000002', true);

SELECT is((SELECT revoked FROM public.approval_boards WHERE id = 'b2d00000-0000-4000-8000-0000000000b1'), false, 'the client A revoke changed nothing');
SELECT is((SELECT count(*)::int FROM public.approval_votes WHERE board_id = 'b2d00000-0000-4000-8000-0000000000b1'), 2, 'the client B delete changed nothing');
SELECT is(
  (SELECT d.name FROM public.approval_votes v JOIN public.creator_assignments a ON a.id = v.assignment_id JOIN public.dashboard_creators d ON d.id = a.creator_id
    WHERE v.vote = 'up' AND v.board_id = 'b2d00000-0000-4000-8000-0000000000b1'),
  'B2V One', 'employee reads the votes with the creator behind each');
SELECT lives_ok(
  $$INSERT INTO public.approval_boards (client_slug, board_type, token, expires_at) VALUES ('b2v-beta', 'creators', 'b2vSecretTokenBeta0000000000000000000000000000002', now() + interval '14 days')$$,
  'employee makes a link');
SELECT throws_ok(
  $$INSERT INTO public.approval_boards (client_slug, token, expires_at) VALUES ('b2v-beta', 'b2vSecretTokenBeta0000000000000000000000000000002', now() + interval '14 days')$$,
  '23505', NULL, 'a token is never reused');
SELECT throws_ok(
  $$SELECT public.apply_approval_votes('b2v-alpha', '[{"assignment_id":"b2d00000-0000-4000-8000-0000000000d1","vote":"up"},{"assignment_id":"b2d00000-0000-4000-8000-0000000000d3","vote":"up"}]'::jsonb)$$,
  'P0002', NULL, 'a vote for another brand''s assignment stops the whole apply');
SELECT is((SELECT stage FROM public.creator_assignments WHERE id = 'b2d00000-0000-4000-8000-0000000000d1'), 'shortlisted', 'and nothing was applied');
SELECT throws_ok(
  $$SELECT public.apply_approval_votes('b2v-alpha', '[{"assignment_id":"b2d00000-0000-4000-8000-0000000000d1","vote":"maybe"}]'::jsonb)$$,
  '22023', NULL, 'a vote other than up or down is refused');
SELECT is(
  public.apply_approval_votes('b2v-alpha', '[{"assignment_id":"b2d00000-0000-4000-8000-0000000000d1","vote":"up"},{"assignment_id":"b2d00000-0000-4000-8000-0000000000d2","vote":"down"}]'::jsonb),
  2, 'employee applies the client''s two decisions');
SELECT is((SELECT stage FROM public.creator_assignments WHERE id = 'b2d00000-0000-4000-8000-0000000000d1'), 'client_approved', 'thumbs up moves to client approved');
SELECT is((SELECT stage FROM public.creator_assignments WHERE id = 'b2d00000-0000-4000-8000-0000000000d2'), 'declined', 'thumbs down moves to declined');
SELECT is((SELECT stage FROM public.creator_assignments WHERE id = 'b2d00000-0000-4000-8000-0000000000d3'), 'shortlisted', 'the other brand is untouched');
SELECT is((SELECT token FROM public.approval_boards WHERE id = 'b2d00000-0000-4000-8000-0000000000b1'),
  'b2vSecretTokenAlpha000000000000000000000000000001', 'employee reads the token to copy the link');
SELECT lives_ok($$UPDATE public.approval_boards SET revoked = true WHERE id = 'b2d00000-0000-4000-8000-0000000000b1'$$, 'employee revokes the link');

SELECT * FROM finish();
ROLLBACK;
