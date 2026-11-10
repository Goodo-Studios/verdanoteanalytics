-- Handoffs (migration 20261110120004, consolidation step 4b).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: row rules on, no grants for anon or public and no direct writes for
-- signed-in users; the helpers are not callable from the browser; clients read
-- nothing and every checked function refuses them; the receiver and owner must be
-- staff; a QA handoff needs every deliverable in internal QA; only the receiver
-- acknowledges or returns, a return needs a reason; the snapshot goes stale when a
-- deliverable moves on; a reassignment is a new revision by the owner, the creator
-- or a builder, with the same brief and a fresh snapshot; history cannot be
-- changed. All rows are made up.

BEGIN;
SELECT plan(30);

INSERT INTO auth.users (id, email) VALUES
  ('e8000000-0000-4000-8000-000000000001', 'ho-builder@example.test'),
  ('e8000000-0000-4000-8000-000000000002', 'ho-strategist@example.test'),
  ('e8000000-0000-4000-8000-000000000003', 'ho-client@example.test'),
  ('e8000000-0000-4000-8000-000000000004', 'ho-editor@example.test'),
  ('e8000000-0000-4000-8000-000000000005', 'ho-editor2@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e8000000-0000-4000-8000-000000000001', 'builder'),
  ('e8000000-0000-4000-8000-000000000002', 'employee'),
  ('e8000000-0000-4000-8000-000000000003', 'client'),
  ('e8000000-0000-4000-8000-000000000004', 'employee'),
  ('e8000000-0000-4000-8000-000000000005', 'employee');
INSERT INTO public.clients (slug, name, status) VALUES ('ho-alpha', 'HO Alpha', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('e8000000-0000-4000-8000-000000000003', 'ho-alpha');
INSERT INTO public.engagements (id, client_slug, cycle_number, engagement_type, status, start_date) VALUES
  ('e8100000-0000-4000-8000-000000000001', 'ho-alpha', 1, 'standard_sprint', 'active', '2026-11-02');

-- ---------------------------------------------------------------- structure (1-4)
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN (
  'public.handoff_packets'::regclass, 'public.handoff_packet_versions'::regclass, 'public.handoff_acknowledgements'::regclass)),
  'row rules are on for the three handoff tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name LIKE 'handoff_%' AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on the handoff tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name LIKE 'handoff_%' AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0,
  'signed-in users only read; writes go through the checked functions');
SELECT ok(NOT has_function_privilege('authenticated', 'public.handoff_asset_snapshot(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.is_staff_login(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.check_handoff_source(text, jsonb)', 'EXECUTE'),
  'the handoff helpers are not callable by signed-in users');

-- ---------------------------------------------------------------- staff options and creation (5-10)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e8000000-0000-4000-8000-000000000002', true);
SELECT ok((SELECT bool_and(user_id <> 'e8000000-0000-4000-8000-000000000003') AND bool_or(user_id = 'e8000000-0000-4000-8000-000000000004')
             FROM public.handoff_staff_options()), 'the receiver list holds staff logins and no client');
CREATE TEMP TABLE d1 AS SELECT public.add_engagement_deliverable('e8100000-0000-4000-8000-000000000001', 'UGC cut', 'video') AS id;
GRANT SELECT ON d1 TO authenticated;
CREATE TEMP TABLE rv1 AS SELECT public.add_deliverable_revision((SELECT id FROM d1), 0, 'https://air.inc/review/u1') AS r;
SELECT throws_ok($$SELECT public.create_handoff_packet('e8100000-0000-4000-8000-000000000001', 'qa_reviewer', 'e8000000-0000-4000-8000-000000000004',
                   'e8000000-0000-4000-8000-000000000002', '2026-11-20', 'Brief', 'Angle', 'Goal', ARRAY['Raw footage'])$$, '22023', NULL,
  'a QA reviewer handoff needs every deliverable in internal QA');
SELECT throws_ok($$SELECT public.create_handoff_packet('e8100000-0000-4000-8000-000000000001', 'editor', 'e8000000-0000-4000-8000-000000000003',
                   'e8000000-0000-4000-8000-000000000002', '2026-11-20', 'Brief', 'Angle', 'Goal', ARRAY['Raw footage'])$$, '22023', NULL,
  'a client login cannot be the receiver');
CREATE TEMP TABLE p1 AS SELECT public.create_handoff_packet('e8100000-0000-4000-8000-000000000001', 'editor', 'e8000000-0000-4000-8000-000000000004',
  'e8000000-0000-4000-8000-000000000002', '2026-11-20', 'Cut a 30 second UGC ad', 'Morning routine', 'Lower CPA', ARRAY['Raw footage', ' Brand fonts ']) AS id;
GRANT SELECT ON p1 TO authenticated;
SELECT is((SELECT (assets -> 0 ->> 'title') || ':' || (assets -> 0 ->> 'revision') || ':' || array_to_string(required_inputs, '|') || ':' || length(fingerprint)
             FROM public.handoff_packet_versions WHERE packet_id = (SELECT id FROM p1) AND revision = 1),
  'UGC cut:1:Raw footage|Brand fonts:64', 'version 1 snapshots the deliverables, trims the inputs and keeps a fingerprint');
SELECT is(public.handoff_source_status((SELECT id FROM p1)), 'current', 'the snapshot matches the engagement');

-- ---------------------------------------------------------------- client wall (11-18)
SELECT set_config('request.jwt.claim.sub', 'e8000000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.handoff_packets), 0, 'a client reads no handoff packets');
SELECT is((SELECT count(*)::int FROM public.handoff_packet_versions), 0, 'a client reads no packet versions');
SELECT is((SELECT count(*)::int FROM public.handoff_acknowledgements), 0, 'a client reads no acknowledgements');
SELECT throws_ok($$SELECT * FROM public.handoff_staff_options()$$, '42501', NULL, 'a client cannot list staff');
SELECT throws_ok($$SELECT public.create_handoff_packet('e8100000-0000-4000-8000-000000000001', 'editor', 'e8000000-0000-4000-8000-000000000004',
                   'e8000000-0000-4000-8000-000000000002', '2026-11-20', 'B', 'A', 'G', ARRAY['x'])$$, '42501', NULL, 'a client cannot create a handoff');
SELECT throws_ok($$SELECT public.acknowledge_handoff((SELECT id FROM p1), 1, 'acknowledged')$$, '42501', NULL, 'a client cannot acknowledge');
SELECT throws_ok($$SELECT public.reassign_handoff((SELECT id FROM p1), 1, 'e8000000-0000-4000-8000-000000000005', 'editor', '2026-11-21', 'x')$$, '42501', NULL,
  'a client cannot reassign');
SELECT throws_ok($$SELECT public.handoff_source_status((SELECT id FROM p1))$$, '42501', NULL, 'a client cannot read the source status');

-- ---------------------------------------------------------------- acknowledgement (19-23)
SELECT set_config('request.jwt.claim.sub', 'e8000000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$SELECT public.acknowledge_handoff((SELECT id FROM p1), 1, 'acknowledged')$$, '42501', NULL, 'only the receiver acknowledges');
SELECT set_config('request.jwt.claim.sub', 'e8000000-0000-4000-8000-000000000004', true);
SELECT throws_ok($$SELECT public.acknowledge_handoff((SELECT id FROM p1), 1, 'returned')$$, '23514', NULL, 'a return needs a reason');
SELECT throws_ok($$SELECT public.acknowledge_handoff((SELECT id FROM p1), 2, 'acknowledged')$$, '40001', NULL, 'a stale revision is refused');
SELECT is(public.acknowledge_handoff((SELECT id FROM p1), 1, 'acknowledged'), 'acknowledged', 'the receiver acknowledges revision 1');
SELECT throws_ok($$SELECT public.acknowledge_handoff((SELECT id FROM p1), 1, 'returned', 'late')$$, '40001', NULL, 'a revision is answered once');

-- ---------------------------------------------------------------- staleness and reassignment (24-31)
SELECT set_config('request.jwt.claim.sub', 'e8000000-0000-4000-8000-000000000002', true);
CREATE TEMP TABLE rv2 AS SELECT public.add_deliverable_revision((SELECT id FROM d1), 1, 'https://air.inc/review/u2') AS r;
SELECT is(public.handoff_source_status((SELECT id FROM p1)), 'stale', 'a new deliverable revision makes the packet stale');
SELECT set_config('request.jwt.claim.sub', 'e8000000-0000-4000-8000-000000000005', true);
SELECT throws_ok($$SELECT public.reassign_handoff((SELECT id FROM p1), 1, 'e8000000-0000-4000-8000-000000000005', 'editor', '2026-11-21', 'mine now')$$, '42501', NULL,
  'someone who is not the owner, creator or a builder cannot reassign');
SELECT set_config('request.jwt.claim.sub', 'e8000000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$SELECT public.reassign_handoff((SELECT id FROM p1), 1, 'e8000000-0000-4000-8000-000000000005', 'editor', '2026-11-21', ' ')$$, '22023', NULL,
  'a reassignment needs a reason');
SELECT is(public.reassign_handoff((SELECT id FROM p1), 1, 'e8000000-0000-4000-8000-000000000005', 'editor', '2026-11-21', 'First editor is out sick'), 2,
  'the owner reassigns as revision 2');
SELECT is((SELECT p.status || ':' || p.receiver_id::text || ':' || v.action || ':' || v.brief || ':' || (v.assets -> 0 ->> 'revision')
             FROM public.handoff_packets p JOIN public.handoff_packet_versions v ON v.packet_id = p.id AND v.revision = p.current_revision
            WHERE p.id = (SELECT id FROM p1)),
  'ready:e8000000-0000-4000-8000-000000000005:reassigned:Cut a 30 second UGC ad:2',
  'revision 2 waits for the new receiver with the same brief and a fresh snapshot');
SELECT is(public.handoff_source_status((SELECT id FROM p1)), 'current', 'the fresh snapshot is current');
SELECT throws_ok($$SELECT public.reassign_handoff((SELECT id FROM p1), 2, 'e8000000-0000-4000-8000-000000000005', 'delivery_owner', '2026-11-22', 'ship it')$$, '22023', NULL,
  'a delivery handoff needs every deliverable final');
RESET role;
SELECT throws_ok($$UPDATE public.handoff_packet_versions SET brief = 'changed'$$, '23514', NULL, 'packet versions cannot be changed');

SELECT * FROM finish();
ROLLBACK;
