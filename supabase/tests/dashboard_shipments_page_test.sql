-- Old dashboard batch 3 (step 5c): the Shipments page reads studio_shipments
-- and the delivery columns of creator_assignments, and writes them only through
-- the checked functions of migration 20261101000002.
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Who is who (all made up):
--   client A   linked to ad account act_c54_a, which belongs to client c54-alpha
--   client B   member of client c54-alpha
--   employee   staff
-- Shipments say what is in a client's boxes and where product is, so no client
-- login reads them, not even its own client's.

BEGIN;
SELECT plan(26);

-- ---------------------------------------------------------------- fixtures
INSERT INTO auth.users (id, email) VALUES
  ('c5400000-0000-4000-8000-000000000002', 'c54-employee@example.test'),
  ('c5400000-0000-4000-8000-000000000003', 'c54-client-a@example.test'),
  ('c5400000-0000-4000-8000-000000000004', 'c54-client-b@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c5400000-0000-4000-8000-000000000002', 'employee'),
  ('c5400000-0000-4000-8000-000000000003', 'client'),
  ('c5400000-0000-4000-8000-000000000004', 'client');
INSERT INTO public.ad_accounts (id, name) VALUES ('act_c54_a', 'C54 Alpha');
INSERT INTO public.user_accounts (user_id, account_id) VALUES ('c5400000-0000-4000-8000-000000000003', 'act_c54_a');
INSERT INTO public.clients (slug, name, status, origin, does_creators, does_production) VALUES
  ('c54-alpha', 'C54 Alpha', 'active', 'manual', true, true),
  ('c54-beta', 'C54 Beta', 'active', 'manual', false, true);
INSERT INTO public.client_ad_accounts (account_id, client_slug) VALUES ('act_c54_a', 'c54-alpha');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('c5400000-0000-4000-8000-000000000004', 'c54-alpha');
INSERT INTO public.dashboard_creators (id, name) VALUES ('c5400000-0000-4000-8000-0000000000c1', 'C54 Creator');
INSERT INTO public.creator_assignments (id, creator_id, client_slug, stage, tracking_number, delivery_notes) VALUES
  ('c5400000-0000-4000-8000-0000000000d1', 'c5400000-0000-4000-8000-0000000000c1', 'c54-alpha', 'product_shipped', '1ZC54', 'Leave at the side door');
INSERT INTO public.actors (id, name) VALUES ('c5400000-0000-4000-8000-0000000000a1', 'C54 Actor');
INSERT INTO public.actor_assignments (id, actor_id, client_slug, stage, scheduled_shoot_date) VALUES
  ('c5400000-0000-4000-8000-0000000000b1', 'c5400000-0000-4000-8000-0000000000a1', 'c54-beta', 'booked', current_date + 9);
INSERT INTO public.studio_shipments (id, client_slug, description, carrier, tracking_number) VALUES
  ('c5400000-0000-4000-8000-0000000000e1', 'c54-alpha', 'C54 candles', 'UPS', '1ZSTUDIO');

-- ---------------------------------------------------------------- client wall
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'c5400000-0000-4000-8000-000000000003', true);

SELECT is((SELECT count(*)::int FROM public.studio_shipments), 0, 'client A reads no studio shipments, not even its own client''s');
SELECT is((SELECT count(*)::int FROM public.creator_assignments), 0, 'client A reads no creator rows, so no tracking or delivery notes');
SELECT throws_ok($$INSERT INTO public.studio_shipments (client_slug, description) VALUES ('c54-alpha', 'client made')$$, '42501', NULL, 'client A cannot write studio shipments directly');
SELECT throws_ok($$SELECT public.create_studio_shipment('c54-alpha', 'client made')$$, '42501', NULL, 'client A is refused create_studio_shipment');
SELECT throws_ok($$SELECT public.update_studio_shipment('c5400000-0000-4000-8000-0000000000e1', 'c54-alpha', 'renamed')$$, '42501', NULL, 'client A is refused update_studio_shipment');
SELECT throws_ok($$SELECT public.set_studio_shipment_delivered('c5400000-0000-4000-8000-0000000000e1', current_date)$$, '42501', NULL, 'client A is refused set_studio_shipment_delivered');
SELECT throws_ok($$SELECT public.set_studio_shipment_notes('c5400000-0000-4000-8000-0000000000e1', 'x')$$, '42501', NULL, 'client A is refused set_studio_shipment_notes');
SELECT throws_ok($$SELECT public.delete_studio_shipment('c5400000-0000-4000-8000-0000000000e1')$$, '42501', NULL, 'client A is refused delete_studio_shipment');
SELECT throws_ok($$SELECT public.set_creator_assignment_delivery('c5400000-0000-4000-8000-0000000000d1', '1ZX', current_date, NULL)$$, '42501', NULL, 'client A is refused set_creator_assignment_delivery');

SELECT set_config('request.jwt.claim.sub', 'c5400000-0000-4000-8000-000000000004', true);
SELECT is((SELECT count(*)::int FROM public.studio_shipments), 0, 'client B (member of the client) reads no studio shipments');
SELECT throws_ok($$SELECT public.create_studio_shipment('c54-alpha', 'client made')$$, '42501', NULL, 'client B is refused create_studio_shipment');

-- ---------------------------------------------------------------- employee
SELECT set_config('request.jwt.claim.sub', 'c5400000-0000-4000-8000-000000000002', true);

SELECT is((SELECT description FROM public.studio_shipments WHERE id = 'c5400000-0000-4000-8000-0000000000e1'), 'C54 candles', 'employee reads the studio shipment and nothing a client tried changed it');
SELECT is((SELECT count(*)::int FROM public.creator_assignments WHERE id = 'c5400000-0000-4000-8000-0000000000d1' AND (tracking_number IS NOT NULL OR product_delivered_at IS NOT NULL OR delivery_notes IS NOT NULL)), 1,
  'employee reads the creator shipment the page lists');
SELECT is((public.create_studio_shipment('c54-beta', '  C54 lamps  ', p_carrier => 'FedEx', p_actor_assignment_id => 'c5400000-0000-4000-8000-0000000000b1'))->>'description', 'C54 lamps', 'employee adds a studio shipment for a shoot, description trimmed');
SELECT throws_ok($$SELECT public.create_studio_shipment('c54-gone', 'x')$$, 'P0002', NULL, 'a client that does not exist is refused');
SELECT throws_ok($$SELECT public.create_studio_shipment('c54-alpha', '   ')$$, '22023', NULL, 'a blank description is refused');
SELECT throws_ok($$SELECT public.create_studio_shipment('c54-alpha', 'x', p_actor_assignment_id => 'c5400000-0000-4000-8000-0000000000b1')$$, '22023', NULL, 'a shoot of another client is refused');
SELECT lives_ok($$SELECT public.update_studio_shipment('c5400000-0000-4000-8000-0000000000e1', 'c54-alpha', 'C54 candles', p_carrier => 'UPS', p_tracking_number => '1ZSTUDIO', p_expected_delivery_at => current_date + 2)$$, 'employee edits a studio shipment');
SELECT lives_ok($$SELECT public.set_studio_shipment_delivered('c5400000-0000-4000-8000-0000000000e1', current_date)$$, 'employee marks it delivered');
SELECT lives_ok($$SELECT public.set_studio_shipment_notes('c5400000-0000-4000-8000-0000000000e1', 'Two arrived broken')$$, 'employee adds delivery notes');
SELECT is((SELECT row(delivered_at = current_date, delivery_notes)::text FROM public.studio_shipments WHERE id = 'c5400000-0000-4000-8000-0000000000e1'), '(t,"Two arrived broken")', 'delivery and notes are saved');
SELECT is((public.set_creator_assignment_delivery('c5400000-0000-4000-8000-0000000000d1', '1ZC54', current_date, 'Leave at the side door'))->>'next_follow_up_source', 'delivery',
  'marking a creator delivered sets the footage follow-up');
SELECT is((SELECT row(next_follow_up_at - current_date, delivery_notes)::text FROM public.creator_assignments WHERE id = 'c5400000-0000-4000-8000-0000000000d1'), '(5,"Leave at the side door")', 'footage is due five days after delivery and the notes the page sent are kept');
SELECT lives_ok($$SELECT public.set_creator_assignment_delivery('c5400000-0000-4000-8000-0000000000d1', '1ZC54', NULL, 'Leave at the side door')$$, 'employee clears the delivered date');
SELECT is((SELECT next_follow_up_at FROM public.creator_assignments WHERE id = 'c5400000-0000-4000-8000-0000000000d1'), NULL::date, 'and the footage follow-up goes with it');
SELECT is((public.delete_studio_shipment('c5400000-0000-4000-8000-0000000000e1'))->>'id', 'c5400000-0000-4000-8000-0000000000e1', 'employee deletes a studio shipment');

SELECT * FROM finish();
ROLLBACK;
