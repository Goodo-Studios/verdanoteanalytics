-- Strategy proposals (migration 20261110200001, consolidation step 4c).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: row rules on, no grants for anon or public and no direct writes for
-- signed-in users; the helpers are not callable from the browser; clients read
-- nothing and every checked function refuses them; a proposal names a published
-- idea or shot list of the same engagement; the author neither reviews nor accepts
-- their own version; acceptance needs a "reviewed" latest review; a source that moved
-- on is refused; publication needs acceptance; the published strategy prefills a
-- handoff, which keeps the reference through a reassignment; history cannot be
-- changed. All rows are made up.

BEGIN;
SELECT plan(33);

INSERT INTO auth.users (id, email) VALUES
  ('e9000000-0000-4000-8000-000000000001', 'sp-builder@example.test'),
  ('e9000000-0000-4000-8000-000000000002', 'sp-author@example.test'),
  ('e9000000-0000-4000-8000-000000000003', 'sp-client@example.test'),
  ('e9000000-0000-4000-8000-000000000004', 'sp-reviewer@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e9000000-0000-4000-8000-000000000001', 'builder'),
  ('e9000000-0000-4000-8000-000000000002', 'employee'),
  ('e9000000-0000-4000-8000-000000000003', 'client'),
  ('e9000000-0000-4000-8000-000000000004', 'employee');
INSERT INTO public.clients (slug, name, status) VALUES ('sp-alpha', 'SP Alpha', 'active'), ('sp-beta', 'SP Beta', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('e9000000-0000-4000-8000-000000000003', 'sp-alpha');
INSERT INTO public.engagements (id, client_slug, cycle_number, engagement_type, status, start_date) VALUES
  ('e9100000-0000-4000-8000-000000000001', 'sp-alpha', 1, 'standard_sprint', 'active', '2026-11-02'),
  ('e9100000-0000-4000-8000-000000000002', 'sp-beta', 1, 'standard_sprint', 'active', '2026-11-02');

-- ---------------------------------------------------------------- structure (1-4)
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN (
  'public.strategy_proposals'::regclass, 'public.strategy_proposal_versions'::regclass, 'public.strategy_proposal_reviews'::regclass,
  'public.strategy_proposal_acceptances'::regclass, 'public.strategy_proposal_publications'::regclass)),
  'row rules are on for the five strategy tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name LIKE 'strategy_proposal%' AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on the strategy tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name LIKE 'strategy_proposal%' AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0,
  'signed-in users only read; writes go through the checked functions');
SELECT ok(NOT has_function_privilege('authenticated', 'public.check_strategy_source(uuid, uuid, integer)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.clean_required_inputs(text[])', 'EXECUTE'),
  'the strategy helpers are not callable by signed-in users');

-- ---------------------------------------------------------------- a published source (5-9)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e9000000-0000-4000-8000-000000000002', true);
CREATE TEMP TABLE s1 AS SELECT public.create_approval_subject('e9100000-0000-4000-8000-000000000001', 'idea', 'Morning routine') AS id;
CREATE TEMP TABLE s2 AS SELECT public.create_approval_subject('e9100000-0000-4000-8000-000000000002', 'idea', 'Other client idea') AS id;
GRANT SELECT ON s1, s2 TO authenticated;
SELECT is(public.save_approval_draft((SELECT id FROM s1), 0, 'Three morning routine hooks'), 1, 'idea draft version 1');
SELECT throws_ok($$SELECT public.create_strategy_proposal('e9100000-0000-4000-8000-000000000001', (SELECT id FROM s1), 1, 'T', 'S', 'B', 'A', 'G', ARRAY['x'])$$,
  '40001', NULL, 'a draft idea is not a source');
SELECT is(public.publish_approval_version((SELECT id FROM s1), 1), 1, 'the idea is published');
SELECT is(public.save_approval_draft((SELECT id FROM s2), 0, 'Other'), 1, 'other idea draft');
SELECT is(public.publish_approval_version((SELECT id FROM s2), 1), 1, 'other idea published');

-- ---------------------------------------------------------------- creating (10-13)
SELECT throws_ok($$SELECT public.create_strategy_proposal('e9100000-0000-4000-8000-000000000001', (SELECT id FROM s2), 1, 'T', 'S', 'B', 'A', 'G', ARRAY['x'])$$,
  'P0002', NULL, 'a source from another engagement is refused');
SELECT throws_ok($$SELECT public.create_strategy_proposal('e9100000-0000-4000-8000-000000000001', (SELECT id FROM s1), 1, 'T', 'S', 'B', 'A', 'G', ARRAY['x', ' '])$$,
  '22023', NULL, 'an empty required input is refused');
CREATE TEMP TABLE p1 AS SELECT public.create_strategy_proposal('e9100000-0000-4000-8000-000000000001', (SELECT id FROM s1), 1,
  'Routine strategy', 'Lead with the routine', 'Film three routines', 'Morning routine', 'Lower CPA', ARRAY[' Raw footage ', 'Brand fonts']) AS id;
GRANT SELECT ON p1 TO authenticated;
SELECT is((SELECT current_version FROM public.strategy_proposals WHERE id = (SELECT id FROM p1)), 1, 'the proposal starts at version 1');
SELECT is((SELECT array_to_string(required_inputs, '|') || ':' || source_version FROM public.strategy_proposal_versions WHERE proposal_id = (SELECT id FROM p1)),
  'Raw footage|Brand fonts:1', 'version 1 trims the inputs and names the source version');

-- ---------------------------------------------------------------- client wall (14-20)
SELECT set_config('request.jwt.claim.sub', 'e9000000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.strategy_proposals) + (SELECT count(*)::int FROM public.strategy_proposal_versions), 0,
  'a client reads no proposals or versions, even for its own client');
SELECT is((SELECT count(*)::int FROM public.strategy_proposal_reviews) + (SELECT count(*)::int FROM public.strategy_proposal_acceptances)
          + (SELECT count(*)::int FROM public.strategy_proposal_publications), 0, 'a client reads no reviews, acceptances or publications');
SELECT throws_ok($$SELECT public.create_strategy_proposal('e9100000-0000-4000-8000-000000000001', (SELECT id FROM s1), 1, 'T', 'S', 'B', 'A', 'G', ARRAY['x'])$$,
  '42501', NULL, 'a client cannot write a proposal');
SELECT throws_ok($$SELECT public.review_strategy_proposal((SELECT id FROM p1), 1, 'reviewed', 'ok')$$, '42501', NULL, 'a client cannot review');
SELECT throws_ok($$SELECT public.accept_strategy_proposal((SELECT id FROM p1), 1)$$, '42501', NULL, 'a client cannot accept');
SELECT throws_ok($$SELECT public.publish_strategy_proposal((SELECT id FROM p1), 1)$$, '42501', NULL, 'a client cannot publish');
SELECT throws_ok($$SELECT * FROM public.published_strategy_for_engagement('e9100000-0000-4000-8000-000000000001')$$, '42501', NULL,
  'a client cannot read the published strategy');

-- ---------------------------------------------------------------- review and acceptance (21-27)
SELECT set_config('request.jwt.claim.sub', 'e9000000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$SELECT public.review_strategy_proposal((SELECT id FROM p1), 1, 'reviewed', 'mine')$$, '42501', NULL, 'the author cannot review their own version');
SELECT set_config('request.jwt.claim.sub', 'e9000000-0000-4000-8000-000000000004', true);
SELECT throws_ok($$SELECT public.accept_strategy_proposal((SELECT id FROM p1), 1)$$, '22023', NULL, 'acceptance needs a review first');
SELECT ok(public.review_strategy_proposal((SELECT id FROM p1), 1, 'reviewed', 'Fits the approved idea') IS NOT NULL, 'another staff member reviews version 1');
SELECT set_config('request.jwt.claim.sub', 'e9000000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$SELECT public.accept_strategy_proposal((SELECT id FROM p1), 1)$$, '42501', NULL, 'the author cannot accept their own version');
SELECT set_config('request.jwt.claim.sub', 'e9000000-0000-4000-8000-000000000004', true);
SELECT throws_ok($$SELECT public.publish_strategy_proposal((SELECT id FROM p1), 1)$$, '22023', NULL, 'publication needs acceptance');
SELECT ok(public.accept_strategy_proposal((SELECT id FROM p1), 1) IS NOT NULL, 'the reviewer accepts version 1');
SELECT throws_ok($$SELECT public.revise_strategy_proposal((SELECT id FROM p1), 1, (SELECT id FROM s1), 1, 'T', 'S', 'B', 'A', 'G', ARRAY['x'])$$,
  '22023', NULL, 'an accepted version is not revised');

-- ---------------------------------------------------------------- publication and handoff prefill (28-32)
SELECT ok(public.publish_strategy_proposal((SELECT id FROM p1), 1) IS NOT NULL, 'the accepted version is published');
SELECT is((SELECT title || ':' || version || ':' || angle FROM public.published_strategy_for_engagement('e9100000-0000-4000-8000-000000000001')),
  'Routine strategy:1:Morning routine', 'the engagement strategy is the published version');
SELECT throws_ok($$SELECT public.create_handoff_packet('e9100000-0000-4000-8000-000000000002', 'editor', 'e9000000-0000-4000-8000-000000000004',
                   'e9000000-0000-4000-8000-000000000002', '2026-11-20', 'B', 'A', 'G', ARRAY['x'], (SELECT id FROM p1), 1)$$, '22023', NULL,
  'a handoff cannot cite the strategy of another engagement');
CREATE TEMP TABLE h1 AS SELECT public.create_handoff_packet('e9100000-0000-4000-8000-000000000001', 'editor', 'e9000000-0000-4000-8000-000000000004',
  'e9000000-0000-4000-8000-000000000002', '2026-11-20', 'Film three routines, keep it short', 'Morning routine', 'Lower CPA', ARRAY['Raw footage'],
  (SELECT id FROM p1), 1) AS id;
GRANT SELECT ON h1 TO authenticated;
SELECT is((SELECT public.reassign_handoff((SELECT id FROM h1), 1, 'e9000000-0000-4000-8000-000000000001', 'editor', '2026-11-21', 'Builder takes it')), 2,
  'the edited packet is reassigned');
SELECT is((SELECT count(*)::int FROM public.handoff_packet_versions WHERE packet_id = (SELECT id FROM h1)
            AND strategy_proposal_id = (SELECT id FROM p1) AND strategy_proposal_version = 1), 2,
  'both packet revisions keep the strategy reference');

-- ---------------------------------------------------------------- history (33)
RESET role;
SELECT throws_ok($$UPDATE public.strategy_proposal_versions SET title = 'changed'$$, '23514', NULL, 'proposal versions cannot be changed');

SELECT * FROM finish();
ROLLBACK;
