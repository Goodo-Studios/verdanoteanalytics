-- Public links, part 2: location boards and call sheets.
-- Run with the local stack (requires Docker):  supabase test db
-- Everything is made up.

BEGIN;
SELECT plan(29);

INSERT INTO auth.users (id, email) VALUES
  ('a8200000-0000-4000-8000-000000000002', 'pl2-employee@example.test'),
  ('a8200000-0000-4000-8000-000000000003', 'pl2-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('a8200000-0000-4000-8000-000000000002', 'employee'),
  ('a8200000-0000-4000-8000-000000000003', 'client');
INSERT INTO public.clients (slug, name, status, origin, does_production) VALUES ('pl2-alpha', 'PL2 Alpha', 'active', 'manual', true);

INSERT INTO public.locations (id, name, neighborhood, rental_type, cost, listing_url, contact_email, notes, parking_instructions, wifi_name, wifi_password, entry_instructions, contact_name) VALUES
  ('a8200000-0000-4000-8000-0000000000a1', 'PL2 Loft', 'Mission', 'house', 900, 'https://listing.example/1', 'host@example.test', 'internal note', 'Street', 'net', 'pw', 'Side door', 'Host'),
  ('a8200000-0000-4000-8000-0000000000a2', 'PL2 Not Shared', 'Sunset', 'house', 100, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.location_photos (id, location_id, storage_path, caption) VALUES
  ('a8200000-0000-4000-8000-0000000000f1', 'a8200000-0000-4000-8000-0000000000a1', 'pl2/front.jpg', 'Front'),
  ('a8200000-0000-4000-8000-0000000000f2', 'a8200000-0000-4000-8000-0000000000a2', 'pl2/other.jpg', 'Other');
INSERT INTO public.location_boards (id, client_slug, label, token, revoked) VALUES
  ('a8200000-0000-4000-8000-0000000000b1', 'pl2-alpha', 'Spring', 'pl2LocBoardLive000000000000000000000000000000001', false),
  ('a8200000-0000-4000-8000-0000000000b2', 'pl2-alpha', 'Old', 'pl2LocBoardRevoked0000000000000000000000000000002', true),
  ('a8200000-0000-4000-8000-0000000000b3', 'pl2-alpha', 'Timed', 'pl2LocBoardTimed00000000000000000000000000000003', false);
INSERT INTO public.location_board_items (board_id, location_id) VALUES
  ('a8200000-0000-4000-8000-0000000000b1', 'a8200000-0000-4000-8000-0000000000a1');
UPDATE public.public_link_registry SET expires_at = now() - interval '1 hour' WHERE link_id = 'a8200000-0000-4000-8000-0000000000b3';

INSERT INTO public.shoots (id, client_slug, shoot_date, location, location_id) VALUES
  ('a8200000-0000-4000-8000-0000000000e1', 'pl2-alpha', current_date + 3, 'PL2 Loft', 'a8200000-0000-4000-8000-0000000000a1'),
  ('a8200000-0000-4000-8000-0000000000e2', 'pl2-alpha', current_date - 40, 'Old place', NULL);
INSERT INTO public.actors (id, name, email, phone, notes) VALUES ('a8200000-0000-4000-8000-0000000000c1', 'PL2 Actor', 'pl2-actor@example.test', '555-0190', 'private note');
INSERT INTO public.actor_assignments (id, actor_id, client_slug, stage, shoot_id) VALUES
  ('a8200000-0000-4000-8000-0000000000d1', 'a8200000-0000-4000-8000-0000000000c1', 'pl2-alpha', 'booked', 'a8200000-0000-4000-8000-0000000000e1');
INSERT INTO public.crew_members (id, name, role, phone, email, rate_notes) VALUES
  ('a8200000-0000-4000-8000-0000000000c2', 'PL2 Crew', 'DP', '555-0191', 'pl2-crew@example.test', 'secret rate');
INSERT INTO public.call_sheets (id, shoot_id, token, call_time, general_notes, revoked) VALUES
  ('a8200000-0000-4000-8000-0000000000b4', 'a8200000-0000-4000-8000-0000000000e1', 'pl2SheetLive00000000000000000000000000000000004', '08:00', 'Bring ID', false),
  ('a8200000-0000-4000-8000-0000000000b5', 'a8200000-0000-4000-8000-0000000000e2', 'pl2SheetOld000000000000000000000000000000000005', '08:00', NULL, false);
INSERT INTO public.call_sheet_crew (call_sheet_id, crew_member_id) VALUES ('a8200000-0000-4000-8000-0000000000b4', 'a8200000-0000-4000-8000-0000000000c2');

-- registry
SELECT is((SELECT count(*)::int FROM public.public_link_registry WHERE link_id::text LIKE 'a8200000%'), 5, 'every new link has a registry row');
SELECT is((SELECT count(*)::int FROM public.public_link_registry WHERE link_type = 'call_sheet' AND token_hash = public.public_link_hash('pl2SheetLive00000000000000000000000000000000004')), 1, 'the call sheet hash row is there');
SELECT is(public.public_link_backfill_registry() ->> 'call_sheet', '0', 'backfill finds no call sheet missing');
SELECT is(public.public_link_backfill_registry() ->> 'location_board', '0', 'backfill finds no location board missing');

-- location board
SELECT is(public.public_location_board_get(public.public_link_hash('pl2LocBoardLive000000000000000000000000000000001')) ->> 'status', 'ok', 'a live location token opens the board');
SELECT is((SELECT jsonb_array_length(public.public_location_board_get(public.public_link_hash('pl2LocBoardLive000000000000000000000000000000001')) -> 'locations')), 1, 'only the shared location is on it');
SELECT is((public.public_location_board_get(public.public_link_hash('pl2LocBoardLive000000000000000000000000000000001')) #> '{locations,0}') ?| ARRAY['cost','listing_url','contact_email','notes','contact_name'], false, 'no cost, listing link, host contact or notes');
SELECT is(public.public_location_board_get(public.public_link_hash('pl2LocBoardRevoked0000000000000000000000000000002')) ->> 'status', 'revoked', 'revoked says revoked');
SELECT is(public.public_location_board_get(public.public_link_hash('pl2LocBoardTimed00000000000000000000000000000003')) ->> 'status', 'expired', 'a link past its expiry says expired');
SELECT is(public.public_location_board_get(public.public_link_hash('pl2SheetLive00000000000000000000000000000000004')) ->> 'status', 'not_found', 'a call sheet token does not open a location board');
SELECT is(public.public_location_board_get(public.public_link_hash('nope')) ->> 'status', 'not_found', 'a wrong token is not found');
SELECT is(public.public_location_board_get(NULL) ->> 'status', 'not_found', 'no token is not found');
SELECT is((SELECT open_count FROM public.public_link_registry WHERE link_id = 'a8200000-0000-4000-8000-0000000000b1'), 3, 'opens are counted');

-- call sheet
SELECT is(public.public_call_sheet_get(public.public_link_hash('pl2SheetLive00000000000000000000000000000000004')) ->> 'status', 'ok', 'a live call sheet token opens it');
SELECT is(public.public_call_sheet_get(public.public_link_hash('pl2SheetLive00000000000000000000000000000000004'), false) #>> '{crew,0,name}', 'PL2 Crew', 'the crew is listed');
SELECT is(public.public_call_sheet_get(public.public_link_hash('pl2SheetLive00000000000000000000000000000000004'), false) #>> '{talent,0,name}', 'PL2 Actor', 'the talent on the shoot is listed');
SELECT is((public.public_call_sheet_get(public.public_link_hash('pl2SheetLive00000000000000000000000000000000004'), false) #> '{crew,0}') ? 'rate_notes', false, 'no crew rate notes');
SELECT is((public.public_call_sheet_get(public.public_link_hash('pl2SheetLive00000000000000000000000000000000004'), false) #> '{talent,0}') ? 'notes', false, 'no talent notes');
SELECT is((public.public_call_sheet_get(public.public_link_hash('pl2SheetLive00000000000000000000000000000000004'), false) #> '{location}') ?| ARRAY['cost','listing_url','notes'], false, 'no location cost, listing link or notes');
SELECT is(public.public_call_sheet_get(public.public_link_hash('pl2SheetOld000000000000000000000000000000000005')) ->> 'status', 'expired', 'a call sheet stops 30 days after the shoot');
UPDATE public.call_sheets SET revoked = true WHERE id = 'a8200000-0000-4000-8000-0000000000b4';
SELECT is(public.public_call_sheet_get(public.public_link_hash('pl2SheetLive00000000000000000000000000000000004')) ->> 'status', 'revoked', 'revoking takes effect at once');
SELECT is(public.public_call_sheet_get(public.public_link_hash('pl2LocBoardLive000000000000000000000000000000001')) ->> 'status', 'not_found', 'a location token does not open a call sheet');

-- the wall
SET LOCAL role anon;
SELECT throws_ok($$SELECT public.public_location_board_get('x')$$, '42501', NULL, 'anon cannot call public_location_board_get');
SELECT throws_ok($$SELECT public.public_call_sheet_get('x')$$, '42501', NULL, 'anon cannot call public_call_sheet_get');
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'a8200000-0000-4000-8000-000000000003', true);
SELECT throws_ok($$SELECT public.public_call_sheet_get('x')$$, '42501', NULL, 'a client login cannot call public_call_sheet_get');
SELECT is((SELECT count(*)::int FROM public.public_link_registry), 0, 'a client login reads no registry rows');
SELECT lives_ok($$UPDATE public.public_link_registry SET expires_at = NULL$$, 'a client login expiry update runs but matches no row');
SELECT set_config('request.jwt.claim.sub', 'a8200000-0000-4000-8000-000000000002', true);
SELECT lives_ok($$UPDATE public.public_link_registry SET expires_at = now() + interval '5 days' WHERE link_id = 'a8200000-0000-4000-8000-0000000000b3'$$, 'staff can set a link expiry');
SELECT throws_ok($$UPDATE public.public_link_registry SET token_hash = repeat('0', 64) WHERE link_id = 'a8200000-0000-4000-8000-0000000000b3'$$, '42501', NULL, 'staff cannot change a token hash');

SELECT * FROM finish();
ROLLBACK;
