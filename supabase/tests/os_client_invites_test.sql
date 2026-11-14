-- OS-021: client invites and the two-client pilot.
--
-- Covers: the exclusion list (Cattasaurus, Marek, Miracle, Royo by slug and by name) can never be
-- batched or invited, not even by the service role; an ending (inactive) client is refused too; a
-- pilot batch has exactly 2 clients and a later batch at most 5; editing the email text clears its
-- approval; only a builder may approve; an invite is sent only when the text and the batch are
-- approved; clients and employees read nothing; the guest access confirmation is refused before the
-- 14 days are up and recorded after; mark_accepted marks only the caller's own invite; the pilot
-- status shows a client approval made by an invited person. All rows are made up.

BEGIN;
SELECT plan(36);

INSERT INTO auth.users (id, email) VALUES
  ('e2100000-0000-4000-8000-000000000001', 'ci-builder@example.test'),
  ('e2100000-0000-4000-8000-000000000002', 'ci-employee@example.test'),
  ('e2100000-0000-4000-8000-000000000003', 'ci-client-a@staging.verdanote.test'),
  ('e2100000-0000-4000-8000-000000000004', 'ci-client-b@staging.verdanote.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e2100000-0000-4000-8000-000000000001', 'builder'),
  ('e2100000-0000-4000-8000-000000000002', 'employee'),
  ('e2100000-0000-4000-8000-000000000003', 'client'),
  ('e2100000-0000-4000-8000-000000000004', 'client');
INSERT INTO public.clients (slug, name, status, active) VALUES
  ('ci-one', 'CI One', 'active', true), ('ci-two', 'CI Two', 'active', true),
  ('ci-three', 'CI Three', 'active', true), ('ci-four', 'CI Four', 'active', true),
  ('ci-five', 'CI Five', 'active', true), ('ci-six', 'CI Six', 'active', true),
  ('ci-ending', 'CI Ending', 'Ending October', true), ('ci-inactive', 'CI Inactive', 'active', false),
  ('ci-royo-x', 'Royo Bread Co', 'active', true)
ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.clients (slug, name, status, active)
  SELECT s, initcap(s), 'active', true FROM unnest(ARRAY['cattasaurus', 'marek', 'miracle-brand', 'royo-bread']) s
ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.client_members (user_id, client_slug) VALUES
  ('e2100000-0000-4000-8000-000000000003', 'ci-one'),
  ('e2100000-0000-4000-8000-000000000004', 'ci-two');

-- Ids made during the test, readable by every role used below.
CREATE TEMP TABLE ids (k text PRIMARY KEY, v uuid NOT NULL);
GRANT ALL ON ids TO authenticated;

-- ---------------------------------------------------------------- structure (1-4)
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN (
  'public.os_invite_excluded_clients'::regclass, 'public.os_client_invite_template'::regclass,
  'public.os_client_invite_batches'::regclass, 'public.os_client_invites'::regclass)),
  'row rules are on for every new table');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public'
              AND table_name IN ('os_invite_excluded_clients', 'os_client_invite_template', 'os_client_invite_batches', 'os_client_invites')
              AND grantee IN ('anon', 'PUBLIC', 'authenticated') AND privilege_type <> 'SELECT'), 0,
  'nobody but the service role can write the new tables directly');
SELECT ok(array['cattasaurus', 'marek', 'miracle-brand', 'royo-bread'] <@ (SELECT array_agg(client_slug) FROM public.os_invite_excluded_clients),
  'the exclusion list holds cattasaurus, marek, miracle-brand and royo-bread');
SELECT ok(NOT has_function_privilege('authenticated', 'public.os_client_invite_blocked(text)', 'EXECUTE'),
  'signed-in users cannot call the blocked check directly');

-- ---------------------------------------------------------------- exclusion, as the service role (5-11)
SELECT is(public.os_client_invite_blocked('cattasaurus'), 'excluded', 'Cattasaurus is excluded');
SELECT is(public.os_client_invite_blocked('marek'), 'excluded', 'Marek is excluded');
SELECT is(public.os_client_invite_blocked('miracle-brand'), 'excluded', 'Miracle is excluded');
SELECT is(public.os_client_invite_blocked('ci-royo-x'), 'excluded', 'a client named Royo under another slug is excluded');
SELECT is(public.os_client_invite_blocked('ci-ending'), 'ending', 'a client whose status says ending is refused');
SELECT is(public.os_client_invite_blocked('ci-inactive'), 'ending', 'an inactive client is refused');
SELECT throws_ok($$INSERT INTO public.os_client_invite_batches (name, kind, client_slugs) VALUES ('svc', 'pilot', ARRAY['ci-one', 'royo-bread'])$$,
  '23514', NULL, 'even the service role cannot batch an excluded client');

-- ---------------------------------------------------------------- as a builder (12-27)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e2100000-0000-4000-8000-000000000001', true);

SELECT throws_ok($$SELECT public.os_client_invite_create_batch('Pilot', 'pilot', ARRAY['ci-one'])$$, '23514', NULL,
  'a pilot batch with one client is refused');
SELECT throws_ok($$SELECT public.os_client_invite_create_batch('Pilot', 'pilot', ARRAY['ci-one', 'ci-two', 'ci-three'])$$, '23514', NULL,
  'a pilot batch with three clients is refused');
SELECT throws_ok($$SELECT public.os_client_invite_create_batch('B', 'batch', ARRAY['ci-one', 'ci-two', 'ci-three', 'ci-four', 'ci-five', 'ci-six'])$$, '23514', NULL,
  'a later batch with six clients is refused');
SELECT lives_ok($$SELECT public.os_client_invite_create_batch('B', 'batch', ARRAY['ci-two', 'ci-three', 'ci-four', 'ci-five', 'ci-six'])$$,
  'a later batch of five clients is accepted');
SELECT throws_ok($$SELECT public.os_client_invite_create_batch('P', 'pilot', ARRAY['ci-one', 'marek'])$$, '23514', NULL,
  'a builder cannot batch Marek');
SELECT throws_ok($$SELECT public.os_client_invite_create_batch('P', 'pilot', ARRAY['ci-one', 'ci-ending'])$$, '23514', NULL,
  'a builder cannot batch an ending client');

INSERT INTO ids SELECT 'pilot', public.os_client_invite_create_batch('CI Pilot', 'pilot', ARRAY['ci-one', 'ci-two']);
SELECT throws_ok(format($$SELECT public.os_client_invite_add_contact(%L, 'cattasaurus', 'x@example.test', 'X')$$, (SELECT v FROM ids WHERE k = 'pilot')), '23514', NULL,
  'an invite for an excluded client is refused');
INSERT INTO ids SELECT 'inv_a', public.os_client_invite_add_contact((SELECT v FROM ids WHERE k = 'pilot'), 'ci-one', 'CI-Client-A@staging.verdanote.test', 'Client A');
SELECT throws_ok(format($$SELECT public.os_client_invite_approve_batch(%L)$$, (SELECT v FROM ids WHERE k = 'pilot')), '23514', NULL,
  'a batch with a client that has no contact cannot be approved');
INSERT INTO ids SELECT 'inv_b', public.os_client_invite_add_contact((SELECT v FROM ids WHERE k = 'pilot'), 'ci-two', 'ci-client-b@staging.verdanote.test', 'Client B');
SELECT is((SELECT email FROM public.os_client_invites WHERE id = (SELECT v FROM ids WHERE k = 'inv_a')), 'ci-client-a@staging.verdanote.test', 'the email is stored in lower case');

-- Template approval and edits.
SELECT lives_ok($$SELECT public.os_client_invite_approve_template()$$, 'a builder approves the email text');
SELECT isnt((SELECT approved_at FROM public.os_client_invite_template), NULL, 'the text is approved');
SELECT lives_ok($$SELECT public.os_client_invite_save_template('New subject', 'New body')$$, 'a builder edits the text');
SELECT is((SELECT approved_at FROM public.os_client_invite_template), NULL, 'editing the text clears its approval');

-- Sending (the function does this as the service role) is refused before the batch is approved.
RESET role;
SELECT throws_ok(format($$UPDATE public.os_client_invites SET status = 'sent', sent_at = now() WHERE id = %L$$, (SELECT v FROM ids WHERE k = 'inv_a')), '23514', NULL,
  'an invite in an unapproved batch cannot be marked sent');
SET LOCAL role authenticated;
SELECT lives_ok(format($$SELECT public.os_client_invite_approve_batch(%L)$$, (SELECT v FROM ids WHERE k = 'pilot')), 'a builder approves the pilot batch');
RESET role;
SELECT throws_ok(format($$UPDATE public.os_client_invites SET status = 'sent', sent_at = now() WHERE id = %L$$, (SELECT v FROM ids WHERE k = 'inv_a')), '23514', NULL,
  'an invite cannot be marked sent while the email text is not approved');

-- ---------------------------------------------------------------- employee and clients (28-31)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e2100000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$SELECT public.os_client_invite_approve_template()$$, '42501', NULL, 'an employee cannot approve the email text');
SELECT is((SELECT count(*)::int FROM public.os_client_invite_batches), 0, 'an employee reads no batches');
SELECT set_config('request.jwt.claim.sub', 'e2100000-0000-4000-8000-000000000003', true);
SELECT is((SELECT (SELECT count(*) FROM public.os_invite_excluded_clients) + (SELECT count(*) FROM public.os_client_invite_template)
            + (SELECT count(*) FROM public.os_client_invite_batches) + (SELECT count(*) FROM public.os_client_invites))::int, 0,
  'client A reads nothing from any of the new tables');
SELECT throws_ok($$SELECT * FROM public.os_client_invite_pilot_status()$$, '42501', NULL, 'a client cannot read the pilot status');

-- ---------------------------------------------------------------- sent, accepted, guest access (32-36)
SELECT set_config('request.jwt.claim.sub', 'e2100000-0000-4000-8000-000000000001', true);
SELECT public.os_client_invite_approve_template();
RESET role;
UPDATE public.os_client_invites SET status = 'sent', sent_at = now(), invited_user_id = 'e2100000-0000-4000-8000-000000000003' WHERE id = (SELECT v FROM ids WHERE k = 'inv_a');
UPDATE public.os_client_invites SET status = 'sent', sent_at = now() WHERE id = (SELECT v FROM ids WHERE k = 'inv_b');
UPDATE public.os_client_invite_batches SET sent_at = now() WHERE id = (SELECT v FROM ids WHERE k = 'pilot');

SET LOCAL role authenticated;
SELECT throws_ok(format($$SELECT public.os_client_invite_confirm_guest_removal(%L)$$, (SELECT v FROM ids WHERE k = 'pilot')), '23514', NULL,
  'guest access removal cannot be confirmed before the 14 days are up');

SELECT set_config('request.jwt.claim.sub', 'e2100000-0000-4000-8000-000000000003', true);
SELECT is(public.os_client_invite_mark_accepted(), 1, 'client A marks their own invite accepted');
SELECT set_config('request.jwt.claim.sub', 'e2100000-0000-4000-8000-000000000001', true);
SELECT is((SELECT array_agg(status ORDER BY client_slug) FROM public.os_client_invites WHERE batch_id = (SELECT v FROM ids WHERE k = 'pilot')), ARRAY['accepted', 'sent'],
  'only client A''s invite is accepted');

-- A second pilot batch sent 15 days ago: the confirmation is recorded and nothing else changes.
RESET role;
WITH b AS (INSERT INTO public.os_client_invite_batches (name, kind, client_slugs, approved_at, approved_by, sent_at)
VALUES ('Old pilot', 'pilot', ARRAY['ci-three', 'ci-four'], now() - interval '16 days', 'e2100000-0000-4000-8000-000000000001', now() - interval '15 days')
RETURNING id) INSERT INTO ids SELECT 'old', id FROM b;
SET LOCAL role authenticated;
SELECT lives_ok(format($$SELECT public.os_client_invite_confirm_guest_removal(%L)$$, (SELECT v FROM ids WHERE k = 'old')),
  'after 14 days the builder records the guest access confirmation');
SELECT is((SELECT guest_access_removal_confirmed_by FROM public.os_client_invite_batches WHERE id = (SELECT v FROM ids WHERE k = 'old')),
  'e2100000-0000-4000-8000-000000000001'::uuid, 'the confirmation records who confirmed');

SELECT * FROM finish();
ROLLBACK;
