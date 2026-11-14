-- Client progress ingest (migrations 20261116000001, P9, and 20261118090001, manual clients accepted).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Fixtures, all made up: b builder, e employee, c client login; client ing-glow (synced, origin coda),
-- client ing-hand (made by hand, origin manual).
--
-- Checks: both tables have row rules on and no login of any role reads or writes them; only a
-- builder creates, lists and revokes tokens; the raw token is returned once and only its sha256 hash
-- is stored; list_ingest_tokens shows no hash; apply_client_progress is service role only; it
-- refuses unknown clients, applies hand-made clients (owner decision 2026-11-11), writes only the fields a call names, sets last_synced,
-- never touches active or origin, is idempotent on replay, refuses a revoked token, and audits.

BEGIN;
SELECT plan(29);

INSERT INTO auth.users (id, email) VALUES
  ('5e000000-0000-4000-8000-000000000001', 'ing-b@example.test'),
  ('5e000000-0000-4000-8000-000000000002', 'ing-e@example.test'),
  ('5e000000-0000-4000-8000-000000000003', 'ing-c@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('5e000000-0000-4000-8000-000000000001', 'builder'),
  ('5e000000-0000-4000-8000-000000000002', 'employee'),
  ('5e000000-0000-4000-8000-000000000003', 'client');
INSERT INTO public.clients (slug, name, status, origin, active, pct_complete, strategist) VALUES
  ('ing-glow', 'Ing Glow', 'active', 'coda', true, 10, 'Sam Strategist'),
  ('ing-hand', 'Ing Hand', 'active', 'manual', true, 5, NULL);

SELECT is((SELECT count(*)::int FROM pg_class WHERE oid IN ('public.ingest_tokens'::regclass, 'public.ingest_audit'::regclass) AND relrowsecurity), 2,
  'both ingest tables have row rules on');

-- ---------------------------------------------------------------- client, employee (2-9)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', '5e000000-0000-4000-8000-000000000003', true);
SELECT throws_ok($$SELECT count(*) FROM public.ingest_tokens$$, '42501', NULL, 'a client cannot read ingest_tokens');
SELECT throws_ok($$SELECT count(*) FROM public.ingest_audit$$, '42501', NULL, 'a client cannot read ingest_audit');
SELECT throws_ok($$SELECT public.create_ingest_token('mine')$$, '42501', NULL, 'a client cannot create a token');
SELECT throws_ok($$SELECT * FROM public.list_ingest_tokens()$$, '42501', NULL, 'a client cannot list tokens');
SELECT throws_ok($$SELECT public.apply_client_progress('00000000-0000-4000-8000-000000000000', 'x', '[]'::jsonb)$$, '42501', NULL, 'a client cannot call apply_client_progress');
SELECT set_config('request.jwt.claim.sub', '5e000000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$SELECT public.create_ingest_token('mine')$$, '42501', NULL, 'an employee cannot create a token');
SELECT throws_ok($$SELECT * FROM public.list_ingest_audit(5)$$, '42501', NULL, 'an employee cannot read the audit');
SELECT throws_ok($$SELECT public.revoke_ingest_token('00000000-0000-4000-8000-000000000000')$$, '42501', NULL, 'an employee cannot revoke a token');

-- ---------------------------------------------------------------- builder (10-16)
SELECT set_config('request.jwt.claim.sub', '5e000000-0000-4000-8000-000000000001', true);
CREATE TEMP TABLE made (token text, id uuid);
GRANT ALL ON made TO authenticated;
INSERT INTO made SELECT (r ->> 'token'), (r ->> 'id')::uuid FROM (SELECT public.create_ingest_token('hq-test') AS r) q;
SELECT matches((SELECT token FROM made), '^vni_[0-9a-f]{64}$', 'a builder gets a token once, in the documented shape');
SELECT throws_ok($$SELECT count(*) FROM public.ingest_tokens$$, '42501', NULL, 'not even a builder reads ingest_tokens directly');
SELECT throws_ok($$SELECT public.create_ingest_token('   ')$$, '22023', NULL, 'a blank name is refused');
SELECT throws_ok($$SELECT public.create_ingest_token('x', 'everything')$$, '22023', NULL, 'an unknown scope is refused');
SELECT is((SELECT count(*)::int FROM public.list_ingest_tokens() WHERE name = 'hq-test' AND revoked_at IS NULL AND last_used_at IS NULL), 1,
  'the builder lists the token, active and unused');
SELECT is((SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ingest_tokens' AND column_name = 'token'), 0,
  'there is no column holding the raw token');


-- ---------------------------------------------------------------- stored hash (17)
RESET role;
SELECT is((SELECT t.token_hash FROM public.ingest_tokens t JOIN made m ON m.id = t.id),
  (SELECT encode(extensions.digest(m.token, 'sha256'), 'hex') FROM made m), 'only the sha256 hash of the token is stored');

-- ---------------------------------------------------------------- apply (18-26), service role
SELECT is((public.apply_client_progress((SELECT id FROM made), 'run-cycle',
  '[{"slug":"ing-glow","pct_complete":60,"month":"2026-11","deliverables":[{"month":"2026-11","type":"cycle_brief","status":"in_progress","file_path":"a/b.md"}]},
    {"slug":"ing-nobody","pct_complete":1},
    {"slug":"ing-hand","pct_complete":99}]'::jsonb, 400)) -> 'rejected',
  '[{"slug":"ing-nobody","reason":"unknown_client"}]'::jsonb,
  'an unknown client is refused per entry and a hand-made client is not');
SELECT is((SELECT pct_complete::text || ':' || month || ':' || (last_synced IS NOT NULL)::text FROM public.clients WHERE slug = 'ing-glow'), '60:2026-11:true',
  'a synced client gets the fields named and last_synced from the database clock');
SELECT is((SELECT strategist FROM public.clients WHERE slug = 'ing-glow'), 'Sam Strategist', 'a field the call did not name is left alone');
SELECT is((SELECT pct_complete::text || ':' || (last_synced IS NOT NULL)::text || ':' || origin || ':' || active::text FROM public.clients WHERE slug = 'ing-hand'), '99:true:manual:true',
  'a hand-made client is written and stamped, and its origin and active are untouched');
SELECT is((SELECT active::text || ':' || origin FROM public.clients WHERE slug = 'ing-glow'), 'true:coda', 'active and origin are untouched');
SELECT is((SELECT count(*)::int FROM public.clients WHERE slug = 'ing-nobody'), 0, 'an unknown client is never created');

-- Replay with the same batch, then change one deliverable status.
SELECT lives_ok($$SELECT public.apply_client_progress((SELECT id FROM made), 'run-cycle',
  '[{"slug":"ing-glow","pct_complete":60,"month":"2026-11","deliverables":[{"month":"2026-11","type":"cycle_brief","status":"in_progress","file_path":"a/b.md"}]}]'::jsonb)$$,
  'the same batch can be sent again');
SELECT is((SELECT count(*)::int FROM public.deliverables WHERE client_slug = 'ing-glow'), 1, 'a replay leaves one deliverable row');
SELECT public.apply_client_progress((SELECT id FROM made), 'run-cycle',
  '[{"slug":"ing-glow","deliverables":[{"month":"2026-11","type":"cycle_brief","status":"complete"}]}]'::jsonb);
SELECT is((SELECT status || ':' || file_path FROM public.deliverables WHERE client_slug = 'ing-glow'), 'complete:a/b.md',
  'a later call updates the status and keeps the file path it did not name');

-- ---------------------------------------------------------------- audit and token use (27-28)
SELECT is((SELECT count(*)::int FROM public.ingest_audit WHERE token_id = (SELECT id FROM made) AND source = 'run-cycle'), 3, 'every call wrote one audit row');
SELECT isnt((SELECT last_used_at FROM public.ingest_tokens WHERE id = (SELECT id FROM made)), NULL, 'last_used_at is set');

-- ---------------------------------------------------------------- revoke (29-30)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', '5e000000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$SELECT public.revoke_ingest_token((SELECT id FROM made))$$, 'a builder revokes the token');
RESET role;
SELECT throws_ok($$SELECT public.apply_client_progress((SELECT id FROM made), 'run-cycle', '[{"slug":"ing-glow","pct_complete":1}]'::jsonb)$$,
  '28000', NULL, 'a revoked token cannot write');

SELECT * FROM finish();
ROLLBACK;
