-- Old dashboard batch 3 (step 5c): the Props page reads props and writes them
-- only through the checked functions of migration 20261101000002.
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Who is who (all made up):
--   client A   linked to ad account act_c52_a, which belongs to client c52-alpha
--   client B   member of client c52-alpha
--   employee   staff
-- Props name the client a purchase was for and what it cost, so no client
-- login reads them, not even the props bought for its own shoot.

BEGIN;
SELECT plan(24);

-- ---------------------------------------------------------------- fixtures
INSERT INTO auth.users (id, email) VALUES
  ('c5200000-0000-4000-8000-000000000002', 'c52-employee@example.test'),
  ('c5200000-0000-4000-8000-000000000003', 'c52-client-a@example.test'),
  ('c5200000-0000-4000-8000-000000000004', 'c52-client-b@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c5200000-0000-4000-8000-000000000002', 'employee'),
  ('c5200000-0000-4000-8000-000000000003', 'client'),
  ('c5200000-0000-4000-8000-000000000004', 'client');
INSERT INTO public.ad_accounts (id, name) VALUES ('act_c52_a', 'C52 Alpha');
INSERT INTO public.user_accounts (user_id, account_id) VALUES ('c5200000-0000-4000-8000-000000000003', 'act_c52_a');
INSERT INTO public.clients (slug, name, status, origin, does_creators, does_production) VALUES
  ('c52-alpha', 'C52 Alpha', 'active', 'manual', false, true);
INSERT INTO public.client_ad_accounts (account_id, client_slug) VALUES ('act_c52_a', 'c52-alpha');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('c5200000-0000-4000-8000-000000000004', 'c52-alpha');
INSERT INTO public.props (id, name, store, price, client, at_studio) VALUES
  ('c5200000-0000-4000-8000-0000000000a1', 'C52 Lamp', 'Target', 40, 'C52 Alpha', true),
  ('c5200000-0000-4000-8000-0000000000a2', 'C52 Rug', 'IKEA', 120, 'C52 Alpha', true);

-- ---------------------------------------------------------------- client wall
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'c5200000-0000-4000-8000-000000000003', true);

SELECT is((SELECT count(*)::int FROM public.props), 0, 'client A reads no props, not even its own shoot''s');
SELECT throws_ok($$INSERT INTO public.props (name) VALUES ('client made')$$, '42501', NULL, 'client A cannot write props directly');
SELECT throws_ok($$UPDATE public.props SET price = 0$$, '42501', NULL, 'client A cannot change a price directly');
SELECT throws_ok($$SELECT public.create_prop('client made')$$, '42501', NULL, 'client A is refused create_prop');
SELECT throws_ok($$SELECT public.update_prop('c5200000-0000-4000-8000-0000000000a1', 'renamed')$$, '42501', NULL, 'client A is refused update_prop');
SELECT throws_ok($$SELECT public.set_prop_at_studio('c5200000-0000-4000-8000-0000000000a1', false)$$, '42501', NULL, 'client A is refused set_prop_at_studio');
SELECT throws_ok($$SELECT public.set_prop_client_supplied('c5200000-0000-4000-8000-0000000000a1', true)$$, '42501', NULL, 'client A is refused set_prop_client_supplied');
SELECT throws_ok($$SELECT public.set_prop_return_status('c5200000-0000-4000-8000-0000000000a1', 'Kept')$$, '42501', NULL, 'client A is refused set_prop_return_status');
SELECT throws_ok($$SELECT public.delete_prop('c5200000-0000-4000-8000-0000000000a2')$$, '42501', NULL, 'client A is refused delete_prop');

SELECT set_config('request.jwt.claim.sub', 'c5200000-0000-4000-8000-000000000004', true);
SELECT is((SELECT count(*)::int FROM public.props), 0, 'client B (member of the client) reads no props');
SELECT throws_ok($$SELECT public.create_prop('client made')$$, '42501', NULL, 'client B is refused create_prop');

-- ---------------------------------------------------------------- employee
SELECT set_config('request.jwt.claim.sub', 'c5200000-0000-4000-8000-000000000002', true);

SELECT is((SELECT count(*)::int FROM public.props WHERE name LIKE 'C52 %'), 2, 'employee reads the props and nothing a client tried was saved');
SELECT is((public.create_prop('  C52 Vase  ', p_price => 12.5, p_at_studio => true))->>'name', 'C52 Vase', 'employee adds a prop, name trimmed');
SELECT throws_ok($$SELECT public.create_prop('   ')$$, '22023', NULL, 'a blank name is refused');
SELECT throws_ok($$SELECT public.create_prop('C52 Bad', p_return_status => 'Lost')$$, '22023', NULL, 'an outcome other than Returned, Thrown away or Kept is refused');
SELECT lives_ok($$SELECT public.update_prop('c5200000-0000-4000-8000-0000000000a1', 'C52 Lamp', p_store => 'Target', p_price => 45, p_bin_number => 'B3')$$, 'employee edits a prop');
SELECT is((SELECT bin_number FROM public.props WHERE id = 'c5200000-0000-4000-8000-0000000000a1'), 'B3', 'the bin is saved');
SELECT lives_ok($$SELECT public.set_prop_at_studio('c5200000-0000-4000-8000-0000000000a1', false)$$, 'employee marks a prop as away');
SELECT lives_ok($$SELECT public.set_prop_client_supplied('c5200000-0000-4000-8000-0000000000a1', true)$$, 'employee marks a prop as client supplied');
SELECT lives_ok($$SELECT public.set_prop_return_status('c5200000-0000-4000-8000-0000000000a1', 'Returned')$$, 'employee records the outcome');
SELECT is((SELECT row(at_studio, client_supplied, return_status)::text FROM public.props WHERE id = 'c5200000-0000-4000-8000-0000000000a1'), '(f,t,Returned)', 'place, supplier and outcome are saved');
SELECT throws_ok($$SELECT public.set_prop_return_status('c5200000-0000-4000-8000-00000000ffff', 'Kept')$$, 'P0002', NULL, 'a prop that does not exist is refused');
SELECT is((public.delete_prop('c5200000-0000-4000-8000-0000000000a2'))->>'name', 'C52 Rug', 'employee deletes a prop');
SELECT is((SELECT count(*)::int FROM public.props WHERE id = 'c5200000-0000-4000-8000-0000000000a2'), 0, 'and it is gone');

SELECT * FROM finish();
ROLLBACK;
