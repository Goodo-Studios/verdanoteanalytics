-- Public links, part 1: the registry, rate limits, and the approval board and casting functions.
-- Run with the local stack (requires Docker):  supabase test db
--
-- Everything is made up. Anonymous and signed-in client callers get nothing from any table or
-- function here; only service_role can call the functions.

BEGIN;
SELECT plan(44);

INSERT INTO auth.users (id, email) VALUES
  ('a8100000-0000-4000-8000-000000000002', 'pl-employee@example.test'),
  ('a8100000-0000-4000-8000-000000000003', 'pl-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('a8100000-0000-4000-8000-000000000002', 'employee'),
  ('a8100000-0000-4000-8000-000000000003', 'client');
INSERT INTO public.clients (slug, name, status, origin) VALUES
  ('pl-alpha', 'PL Alpha', 'active', 'manual'),
  ('pl-beta', 'PL Beta', 'active', 'manual');
INSERT INTO public.dashboard_creators (id, name) VALUES
  ('a8100000-0000-4000-8000-0000000000c1', 'PL One'),
  ('a8100000-0000-4000-8000-0000000000c2', 'PL Two'),
  ('a8100000-0000-4000-8000-0000000000c3', 'PL Other Client');
INSERT INTO public.creator_assignments (id, creator_id, client_slug, stage) VALUES
  ('a8100000-0000-4000-8000-0000000000d1', 'a8100000-0000-4000-8000-0000000000c1', 'pl-alpha', 'shortlisted'),
  ('a8100000-0000-4000-8000-0000000000d2', 'a8100000-0000-4000-8000-0000000000c2', 'pl-alpha', 'sourced'),
  ('a8100000-0000-4000-8000-0000000000d3', 'a8100000-0000-4000-8000-0000000000c3', 'pl-beta', 'shortlisted');
INSERT INTO public.creator_photos (id, creator_id, storage_path, category) VALUES
  ('a8100000-0000-4000-8000-0000000000e1', 'a8100000-0000-4000-8000-0000000000c1', 'c1/pet.jpg', 'pet'),
  ('a8100000-0000-4000-8000-0000000000e3', 'a8100000-0000-4000-8000-0000000000c3', 'c3/pet.jpg', 'pet');
INSERT INTO public.actors (id, name, email, phone) VALUES
  ('a8100000-0000-4000-8000-0000000000a1', 'PL Actor', 'pl-actor@example.test', '555-0180');
INSERT INTO public.actor_assignments (id, actor_id, client_slug, stage) VALUES
  ('a8100000-0000-4000-8000-0000000000f1', 'a8100000-0000-4000-8000-0000000000a1', 'pl-alpha', 'shortlisted');

INSERT INTO public.approval_boards (id, client_slug, board_type, token, expires_at, revoked) VALUES
  ('a8100000-0000-4000-8000-0000000000b1', 'pl-alpha', 'creators', 'plTokenCreatorsAlpha00000000000000000000000000001', now() + interval '7 days', false),
  ('a8100000-0000-4000-8000-0000000000b2', 'pl-alpha', 'actors', 'plTokenActorsAlpha000000000000000000000000000002', now() + interval '7 days', false),
  ('a8100000-0000-4000-8000-0000000000b3', 'pl-beta', 'creators', 'plTokenCreatorsBeta0000000000000000000000000000003', now() + interval '7 days', false),
  ('a8100000-0000-4000-8000-0000000000b4', 'pl-alpha', 'creators', 'plTokenRevoked000000000000000000000000000000000004', now() + interval '7 days', true),
  ('a8100000-0000-4000-8000-0000000000b5', 'pl-alpha', 'creators', 'plTokenExpired000000000000000000000000000000000005', now() - interval '1 day', false);

-- ---------------------------------------------------------------- registry
SELECT is((SELECT count(*)::int FROM public.public_link_registry WHERE link_id::text LIKE 'a8100000%'), 5, 'every board has a registry row (trigger)');
SELECT is((SELECT token_hash FROM public.public_link_registry WHERE link_id = 'a8100000-0000-4000-8000-0000000000b1'),
  encode(sha256(convert_to('plTokenCreatorsAlpha00000000000000000000000000001', 'UTF8')), 'hex'), 'the registry holds the SHA-256 of the token');
SELECT is(public.public_link_backfill_registry() ->> 'approval_board', '0', 'backfill finds nothing missing');
-- A row copied with triggers off (session_replication_role = replica) still gets its hash row.
SET LOCAL session_replication_role = replica;
INSERT INTO public.approval_boards (id, client_slug, board_type, token, expires_at) VALUES
  ('a8100000-0000-4000-8000-0000000000b6', 'pl-alpha', 'creators', 'plTokenCopied0000000000000000000000000000000000006', now() + interval '7 days');
SET LOCAL session_replication_role = origin;
SELECT is((SELECT count(*)::int FROM public.public_link_registry WHERE link_id = 'a8100000-0000-4000-8000-0000000000b6'), 1, 'a board copied with triggers off still gets its registry row');
UPDATE public.approval_boards SET token = 'plTokenCopiedNew00000000000000000000000000000000006' WHERE id = 'a8100000-0000-4000-8000-0000000000b6';
SELECT is((SELECT token_hash FROM public.public_link_registry WHERE link_id = 'a8100000-0000-4000-8000-0000000000b6'),
  public.public_link_hash('plTokenCopiedNew00000000000000000000000000000000006'), 'a changed token changes the hash');
DELETE FROM public.approval_boards WHERE id = 'a8100000-0000-4000-8000-0000000000b6';
SELECT is((SELECT count(*)::int FROM public.public_link_registry WHERE link_id = 'a8100000-0000-4000-8000-0000000000b6'), 0, 'deleting a board removes its registry row');

-- ---------------------------------------------------------------- board get
SELECT is(public.public_board_get(public.public_link_hash('plTokenCreatorsAlpha00000000000000000000000000001'), 'creators') ->> 'status', 'ok', 'a live creators token opens the board');
SELECT is((SELECT jsonb_array_length(public.public_board_get(public.public_link_hash('plTokenCreatorsAlpha00000000000000000000000000001'), 'creators') -> 'people')), 1,
  'only the shortlisted creator of this client is on it (not the sourced one, not the other client''s)');
SELECT is(public.public_board_get(public.public_link_hash('plTokenCreatorsAlpha00000000000000000000000000001'), 'actors') ->> 'status', 'not_found', 'a creators token on the casting side is not found');
SELECT is(public.public_board_get(public.public_link_hash('plTokenActorsAlpha000000000000000000000000000002'), 'creators') ->> 'status', 'not_found', 'a casting token on the approval side is not found');
SELECT is(public.public_board_get(public.public_link_hash('not a real token'), 'creators') ->> 'status', 'not_found', 'a wrong token is not found');
SELECT is(public.public_board_get(NULL, 'creators') ->> 'status', 'not_found', 'no token is not found');
SELECT is(public.public_board_get(public.public_link_hash('plTokenRevoked000000000000000000000000000000000004'), 'creators') ->> 'status', 'revoked', 'a revoked link says revoked');
SELECT is(public.public_board_get(public.public_link_hash('plTokenExpired000000000000000000000000000000000005'), 'creators') ->> 'status', 'expired', 'an expired link says expired');
SELECT is(public.public_board_get(public.public_link_hash('plTokenRevoked000000000000000000000000000000000004'), 'creators') ? 'people', false, 'a revoked link returns no board data');
SELECT is((SELECT open_count FROM public.public_link_registry WHERE link_id = 'a8100000-0000-4000-8000-0000000000b1'), 2, 'opens were counted (two live gets so far)');
SELECT public.public_board_get(public.public_link_hash('plTokenCreatorsAlpha00000000000000000000000000001'), 'creators', false);
SELECT is((SELECT open_count FROM public.public_link_registry WHERE link_id = 'a8100000-0000-4000-8000-0000000000b1'), 2, 'a refresh does not count as an open');
SELECT is(public.public_board_get(public.public_link_hash('plTokenActorsAlpha000000000000000000000000000002'), 'actors') #>> '{people,0,name}', 'PL Actor', 'the casting board lists the actor');
SELECT is((public.public_board_get(public.public_link_hash('plTokenActorsAlpha000000000000000000000000000002'), 'actors') -> 'people' -> 0) ? 'email', false, 'the casting board carries no email');
SELECT is((public.public_board_get(public.public_link_hash('plTokenActorsAlpha000000000000000000000000000002'), 'actors') -> 'people' -> 0) ? 'phone', false, 'the casting board carries no phone number');

-- ---------------------------------------------------------------- votes
SELECT is(public.public_board_vote(public.public_link_hash('plTokenCreatorsAlpha00000000000000000000000000001'), 'creators', 'a8100000-0000-4000-8000-0000000000d1', 'up', E'  Sam\n\tLee  '), 'ok', 'a vote is recorded');
SELECT is((SELECT voted_by FROM public.approval_votes WHERE board_id = 'a8100000-0000-4000-8000-0000000000b1'), 'Sam Lee', 'the typed name is cleaned');
SELECT is(public.public_board_vote(public.public_link_hash('plTokenCreatorsAlpha00000000000000000000000000001'), 'creators', 'a8100000-0000-4000-8000-0000000000d1', 'down', NULL), 'ok', 'a second vote changes the first');
SELECT is((SELECT count(*)::int FROM public.approval_votes WHERE board_id = 'a8100000-0000-4000-8000-0000000000b1'), 1, 'still one vote row per creator');
SELECT is(public.public_board_vote(public.public_link_hash('plTokenCreatorsAlpha00000000000000000000000000001'), 'creators', 'a8100000-0000-4000-8000-0000000000d3', 'up', NULL), 'invalid', 'a creator of another client cannot be voted on through this link');
SELECT is(public.public_board_vote(public.public_link_hash('plTokenCreatorsAlpha00000000000000000000000000001'), 'creators', 'a8100000-0000-4000-8000-0000000000d2', 'up', NULL), 'invalid', 'a creator who is not on the board cannot be voted on');
SELECT is(public.public_board_vote(public.public_link_hash('plTokenCreatorsAlpha00000000000000000000000000001'), 'creators', 'a8100000-0000-4000-8000-0000000000d1', 'maybe', NULL), 'invalid', 'a vote other than up or down is refused');
SELECT is(public.public_board_vote(public.public_link_hash('plTokenRevoked000000000000000000000000000000000004'), 'creators', 'a8100000-0000-4000-8000-0000000000d1', 'up', NULL), 'revoked', 'a revoked link cannot vote');
SELECT is(public.public_board_vote(public.public_link_hash('plTokenExpired000000000000000000000000000000000005'), 'creators', 'a8100000-0000-4000-8000-0000000000d1', 'up', NULL), 'expired', 'an expired link cannot vote');
SELECT is(public.public_board_vote(public.public_link_hash('plTokenActorsAlpha000000000000000000000000000002'), 'creators', 'a8100000-0000-4000-8000-0000000000d1', 'up', NULL), 'not_found', 'a casting token cannot vote on creators');
SELECT is(public.public_board_vote(public.public_link_hash('plTokenActorsAlpha000000000000000000000000000002'), 'actors', 'a8100000-0000-4000-8000-0000000000f1', 'up', NULL), 'ok', 'a casting vote lands in the actor vote table');
SELECT is((SELECT count(*)::int FROM public.actor_approval_votes), 1, 'one actor vote');
SELECT is((SELECT count(*)::int FROM public.approval_votes WHERE board_id <> 'a8100000-0000-4000-8000-0000000000b1'), 0, 'no vote landed on any other board');

-- ---------------------------------------------------------------- media
SELECT is(public.public_board_media(public.public_link_hash('plTokenCreatorsAlpha00000000000000000000000000001'), 'creators', 'photo', 'a8100000-0000-4000-8000-0000000000e1') ->> 'status', 'ok', 'a photo on the board resolves');
SELECT is(public.public_board_media(public.public_link_hash('plTokenCreatorsAlpha00000000000000000000000000001'), 'creators', 'photo', 'a8100000-0000-4000-8000-0000000000e3') ->> 'status', 'not_found', 'another client''s photo does not resolve');

-- ---------------------------------------------------------------- rate limit
SELECT is(public.public_link_rate_hit('pl-test', 2, 60), true, 'first hit is allowed');
SELECT is(public.public_link_rate_hit('pl-test', 2, 60) AND NOT public.public_link_rate_hit('pl-test', 2, 60), true, 'the third hit in the window is refused');

-- ---------------------------------------------------------------- the wall
SET LOCAL role anon;
SELECT throws_ok($$SELECT * FROM public.public_link_registry$$, '42501', NULL, 'anon cannot read the registry');
SELECT throws_ok($$SELECT public.public_board_get('x', 'creators')$$, '42501', NULL, 'anon cannot call public_board_get');
SELECT throws_ok($$SELECT * FROM public.public_link_rate_limits$$, '42501', NULL, 'anon cannot read the rate limit table');

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'a8100000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.public_link_registry), 0, 'a client login reads no registry rows (no token hashes)');
SELECT throws_ok($$SELECT public.public_board_vote('x', 'creators', NULL, 'up', NULL)$$, '42501', NULL, 'a client login cannot call public_board_vote');
SELECT throws_ok($$SELECT * FROM public.public_link_rate_limits$$, '42501', NULL, 'a client login cannot read the rate limit table');
SELECT set_config('request.jwt.claim.sub', 'a8100000-0000-4000-8000-000000000002', true);
SELECT cmp_ok((SELECT count(*)::int FROM public.public_link_registry), '>=', 5, 'staff read the registry (open counts)');

SELECT * FROM finish();
ROLLBACK;
