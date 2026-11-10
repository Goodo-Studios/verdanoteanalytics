-- Read-only BID viewer (migration 20261111020001, step 6).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: row rules on, no grants for anon or public and no writes for signed-in users; the
-- import is callable by the service role only; importing the same body again returns the same
-- version and a new body the next version; a staging seed BID must be made up; staff read,
-- clients read nothing (including their own client's BID); versions are immutable. All rows
-- are made up.

BEGIN;
SELECT plan(18);

INSERT INTO auth.users (id, email) VALUES
  ('e7000000-0000-4000-8000-000000000001', 'bid-employee@example.test'),
  ('e7000000-0000-4000-8000-000000000002', 'bid-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e7000000-0000-4000-8000-000000000001', 'employee'),
  ('e7000000-0000-4000-8000-000000000002', 'client');
INSERT INTO public.clients (slug, name, status) VALUES ('bid-alpha', 'BID Alpha', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('e7000000-0000-4000-8000-000000000002', 'bid-alpha');

-- ---------------------------------------------------------------- structure (1-5)
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.client_bids'::regclass), 'row rules are on for client_bids');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'client_bids' AND grantee IN ('anon', 'PUBLIC')), 0, 'anon and public hold no privileges');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'client_bids' AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0,
  'signed-in users can only read client_bids');
SELECT ok(NOT has_function_privilege('authenticated', 'public.import_client_bid(text, text, text, text, text, text, timestamptz)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.import_client_bid(text, text, text, text, text, text, timestamptz)', 'EXECUTE'),
  'nobody signed in can import a BID');
SELECT ok(has_function_privilege('service_role', 'public.import_client_bid(text, text, text, text, text, text, timestamptz)', 'EXECUTE'),
  'the service role can import a BID');

-- ---------------------------------------------------------------- import as the service role (6-12)
SET LOCAL role service_role;
SELECT is(public.import_client_bid('bid-alpha', ' BID Alpha ', E'## 1. Company Analysis\n\nMade-up text.', 'staging-seed', 'test', 'made_up', '2026-11-01T00:00:00Z'), 1,
  'the first import is version 1');
SELECT is(public.import_client_bid('bid-alpha', 'BID Alpha again', E'## 1. Company Analysis\n\nMade-up text.', 'staging-seed', 'test', 'made_up', '2026-11-02T00:00:00Z'), 1,
  'importing the same body again returns version 1');
SELECT is(public.import_client_bid('bid-alpha', 'BID Alpha', E'## 1. Company Analysis\n\nRevised made-up text.', 'staging-seed', 'test', 'made_up', '2026-11-05T00:00:00Z'), 2,
  'a new body is version 2');
SELECT is((SELECT count(*)::int || ' ' || min(title) || ' ' || bool_and(body_sha256 ~ '^[0-9a-f]{64}$') FROM public.client_bids WHERE client_slug = 'bid-alpha'),
  '2 BID Alpha true', 'two versions with trimmed titles and sha256 fingerprints');
SELECT throws_ok($$SELECT public.import_client_bid('bid-alpha', 'X', 'Body', 'staging-seed', 'test', 'real', now())$$, '22023', NULL,
  'a staging seed BID cannot be marked real');
SELECT throws_ok($$SELECT public.import_client_bid('bid-alpha', 'X', '   ', 'bid-builder', 'test', 'real', now())$$, '22023', NULL, 'an empty body is refused');
SELECT throws_ok($$SELECT public.import_client_bid('no-such-client', 'X', 'Body', 'bid-builder', 'test', 'real', now())$$, 'P0002', NULL,
  'an unknown client is not found');
RESET role;

-- ---------------------------------------------------------------- readers (13-16)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e7000000-0000-4000-8000-000000000001', true);
SELECT is((SELECT count(*)::int FROM public.client_bids), 2, 'an employee reads the BIDs');
SELECT throws_ok($$SELECT public.import_client_bid('bid-alpha', 'X', 'Employee body', 'bid-builder', 'test', 'real', now())$$, '42501', NULL,
  'an employee cannot import a BID');
SELECT set_config('request.jwt.claim.sub', 'e7000000-0000-4000-8000-000000000002', true);
SELECT is((SELECT count(*)::int FROM public.client_bids), 0, 'a client reads no BIDs, not even its own client''s');
SELECT throws_ok($$INSERT INTO public.client_bids (client_slug, version, title, body_markdown, body_sha256, source, source_ref, data_origin, generated_at)
                   VALUES ('bid-alpha', 9, 'X', 'Y', repeat('0', 64), 'bid-builder', 'x', 'real', now())$$, '42501', NULL,
  'a signed-in user cannot write a BID directly');

-- ---------------------------------------------------------------- immutable (17-18)
RESET role;
SELECT throws_ok($$UPDATE public.client_bids SET title = 'Changed'$$, '23514', NULL, 'a BID version cannot be changed');
SELECT throws_ok($$DELETE FROM public.client_bids$$, '23514', NULL, 'a BID version cannot be deleted');

SELECT * FROM finish();
ROLLBACK;
