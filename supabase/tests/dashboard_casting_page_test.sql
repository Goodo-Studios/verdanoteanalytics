-- Old dashboard batch 3 (step 5c): the Casting page reads and writes
-- actor_assignments, actor casting links (approval_boards with board_type
-- 'actors') and actor_approval_votes directly under the staff rules, and
-- applies votes through apply_actor_approval_votes (migration 20261101000002).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Who is who (all made up):
--   client A   linked to ad account act_c56_a, which belongs to client c56-alpha
--   client B   member of client c56-alpha
--   employee   staff
-- A casting link token opens the public casting page without a login and
-- castings name the talent, so no client login reads either, not even its own.

BEGIN;
SELECT plan(25);

-- ---------------------------------------------------------------- fixtures
INSERT INTO auth.users (id, email) VALUES
  ('c5600000-0000-4000-8000-000000000002', 'c56-employee@example.test'),
  ('c5600000-0000-4000-8000-000000000003', 'c56-client-a@example.test'),
  ('c5600000-0000-4000-8000-000000000004', 'c56-client-b@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c5600000-0000-4000-8000-000000000002', 'employee'),
  ('c5600000-0000-4000-8000-000000000003', 'client'),
  ('c5600000-0000-4000-8000-000000000004', 'client');
INSERT INTO public.ad_accounts (id, name) VALUES ('act_c56_a', 'C56 Alpha');
INSERT INTO public.user_accounts (user_id, account_id) VALUES ('c5600000-0000-4000-8000-000000000003', 'act_c56_a');
INSERT INTO public.clients (slug, name, status, origin, does_creators, does_production) VALUES
  ('c56-alpha', 'C56 Alpha', 'active', 'manual', false, true),
  ('c56-beta', 'C56 Beta', 'active', 'manual', false, true);
INSERT INTO public.client_ad_accounts (account_id, client_slug) VALUES ('act_c56_a', 'c56-alpha');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('c5600000-0000-4000-8000-000000000004', 'c56-alpha');
INSERT INTO public.actors (id, name, email, phone) VALUES
  ('c5600000-0000-4000-8000-0000000000a1', 'C56 One', 'c56-one@example.test', '555-0161'),
  ('c5600000-0000-4000-8000-0000000000a2', 'C56 Two', 'c56-two@example.test', '555-0162'),
  ('c5600000-0000-4000-8000-0000000000a3', 'C56 Three', 'c56-three@example.test', '555-0163');
INSERT INTO public.actor_assignments (id, actor_id, client_slug, stage) VALUES
  ('c5600000-0000-4000-8000-0000000000d1', 'c5600000-0000-4000-8000-0000000000a1', 'c56-alpha', 'shortlisted'),
  ('c5600000-0000-4000-8000-0000000000d2', 'c5600000-0000-4000-8000-0000000000a2', 'c56-alpha', 'shortlisted'),
  ('c5600000-0000-4000-8000-0000000000d3', 'c5600000-0000-4000-8000-0000000000a3', 'c56-beta', 'shortlisted');
INSERT INTO public.approval_boards (id, client_slug, board_type, token, expires_at) VALUES
  ('c5600000-0000-4000-8000-0000000000b1', 'c56-alpha', 'actors', 'c56SecretCastingToken000000000000000000000000001', now() + interval '7 days');
INSERT INTO public.actor_approval_votes (board_id, assignment_id, vote, voted_by) VALUES
  ('c5600000-0000-4000-8000-0000000000b1', 'c5600000-0000-4000-8000-0000000000d1', 'up', 'Sam'),
  ('c5600000-0000-4000-8000-0000000000b1', 'c5600000-0000-4000-8000-0000000000d2', 'down', NULL);

-- ---------------------------------------------------------------- client wall
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'c5600000-0000-4000-8000-000000000003', true);

SELECT is((SELECT count(*)::int FROM public.actor_assignments), 0, 'client A reads no castings, not even its own client''s');
SELECT is((SELECT count(*)::int FROM public.approval_boards WHERE board_type = 'actors'), 0, 'client A reads no casting link token');
SELECT is((SELECT count(*)::int FROM public.actor_approval_votes), 0, 'client A reads no casting votes');
SELECT is((SELECT count(*)::int FROM public.actors), 0, 'client A reads no actor emails or phones');
SELECT throws_ok($$INSERT INTO public.actor_assignments (actor_id, client_slug) VALUES ('c5600000-0000-4000-8000-0000000000a3', 'c56-alpha')$$, '42501', NULL, 'client A cannot cast an actor');
SELECT lives_ok($$UPDATE public.actor_assignments SET stage = 'booked'$$, 'client A stage change runs but matches no row');
SELECT throws_ok($$INSERT INTO public.approval_boards (client_slug, board_type, token, expires_at) VALUES ('c56-alpha', 'actors', 'clientmade', now() + interval '1 day')$$, '42501', NULL, 'client A cannot make a casting link');
SELECT throws_ok($$INSERT INTO public.actor_approval_votes (board_id, assignment_id, vote) VALUES ('c5600000-0000-4000-8000-0000000000b1', 'c5600000-0000-4000-8000-0000000000d1', 'down')$$, '42501', NULL, 'client A cannot vote through the table');
SELECT throws_ok($$SELECT public.apply_actor_approval_votes('c56-alpha', '[]'::jsonb)$$, '42501', NULL, 'client A is refused apply_actor_approval_votes');

SELECT set_config('request.jwt.claim.sub', 'c5600000-0000-4000-8000-000000000004', true);
SELECT is((SELECT count(*)::int FROM public.actor_assignments), 0, 'client B (member of the client) reads no castings');
SELECT is((SELECT count(*)::int FROM public.actor_approval_votes), 0, 'client B reads no casting votes');
SELECT lives_ok($$DELETE FROM public.actor_assignments$$, 'client B delete runs but matches no row');
SELECT throws_ok($$SELECT public.apply_actor_approval_votes('c56-alpha', '[]'::jsonb)$$, '42501', NULL, 'client B is refused apply_actor_approval_votes');

-- ---------------------------------------------------------------- employee
SELECT set_config('request.jwt.claim.sub', 'c5600000-0000-4000-8000-000000000002', true);

SELECT is((SELECT count(*)::int FROM public.actor_assignments WHERE client_slug = 'c56-alpha' AND stage = 'shortlisted'), 2, 'the client writes changed and removed nothing');
SELECT is((SELECT a.name FROM public.actor_approval_votes v JOIN public.actor_assignments s ON s.id = v.assignment_id JOIN public.actors a ON a.id = s.actor_id WHERE v.vote = 'up'), 'C56 One', 'employee reads the votes with the actor behind each');
SELECT lives_ok($$INSERT INTO public.actor_assignments (actor_id, client_slug, stage) VALUES ('c5600000-0000-4000-8000-0000000000a3', 'c56-alpha', 'sourced')$$, 'employee casts an actor on the client');
SELECT throws_ok($$INSERT INTO public.actor_assignments (actor_id, client_slug) VALUES ('c5600000-0000-4000-8000-0000000000a3', 'c56-alpha')$$, '23505', NULL, 'an actor is cast on a client once');
SELECT throws_ok($$UPDATE public.actor_assignments SET stage = 'maybe' WHERE id = 'c5600000-0000-4000-8000-0000000000d1'$$, '23514', NULL, 'a stage outside the casting stages is refused');
SELECT lives_ok($$UPDATE public.actor_assignments SET next_follow_up_at = current_date + 3, notes = 'Call back', updated_at = now() WHERE id = 'c5600000-0000-4000-8000-0000000000d2'$$, 'employee sets a follow-up and notes');
SELECT lives_ok($$INSERT INTO public.approval_boards (client_slug, board_type, token, expires_at) VALUES ('c56-beta', 'actors', 'c56SecretCastingToken000000000000000000000000002', now() + interval '14 days')$$, 'employee makes a casting link');
SELECT throws_ok(
  $$SELECT public.apply_actor_approval_votes('c56-alpha', '[{"assignment_id":"c5600000-0000-4000-8000-0000000000d1","vote":"up"},{"assignment_id":"c5600000-0000-4000-8000-0000000000d3","vote":"up"}]'::jsonb)$$,
  'P0002', NULL, 'a vote for another client''s casting stops the whole apply');
SELECT is((SELECT stage FROM public.actor_assignments WHERE id = 'c5600000-0000-4000-8000-0000000000d1'), 'shortlisted', 'and nothing was applied');
SELECT is(
  public.apply_actor_approval_votes('c56-alpha', '[{"assignment_id":"c5600000-0000-4000-8000-0000000000d1","vote":"up"},{"assignment_id":"c5600000-0000-4000-8000-0000000000d2","vote":"down"}]'::jsonb),
  2, 'employee applies the client''s two decisions');
SELECT is((SELECT string_agg(stage, ',' ORDER BY id) FROM public.actor_assignments WHERE id IN ('c5600000-0000-4000-8000-0000000000d1', 'c5600000-0000-4000-8000-0000000000d2')), 'client_approved,declined', 'up moves to client approved, down to declined');
SELECT lives_ok($$UPDATE public.approval_boards SET revoked = true WHERE id = 'c5600000-0000-4000-8000-0000000000b1'$$, 'employee revokes the casting link');

SELECT * FROM finish();
ROLLBACK;
