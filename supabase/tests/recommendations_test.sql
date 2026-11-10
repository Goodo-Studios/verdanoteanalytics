-- Recommendations (migration 20261110200003, consolidation step 4c).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: row rules on, no grants for anon or public and no direct writes for
-- signed-in users; the helpers are not callable from the browser; clients read
-- nothing and are refused the checked functions; accepting needs a hypothesis and a
-- final action; cited evidence and linked ads must be the client's; versions compare
-- and set; the evaluation reads the ad metrics (not executed, insufficient, stale,
-- measured) and stores the numbers it read; a learning needs a measured outcome whose
-- evidence is unchanged; the proposal cannot be changed. All rows are made up.

BEGIN;
SELECT plan(29);

INSERT INTO auth.users (id, email) VALUES
  ('eb000000-0000-4000-8000-000000000001', 'rc-builder@example.test'),
  ('eb000000-0000-4000-8000-000000000002', 'rc-employee@example.test'),
  ('eb000000-0000-4000-8000-000000000003', 'rc-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('eb000000-0000-4000-8000-000000000001', 'builder'),
  ('eb000000-0000-4000-8000-000000000002', 'employee'),
  ('eb000000-0000-4000-8000-000000000003', 'client');
INSERT INTO public.clients (slug, name, status) VALUES ('rc-alpha', 'RC Alpha', 'active'), ('rc-beta', 'RC Beta', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('eb000000-0000-4000-8000-000000000003', 'rc-alpha');
INSERT INTO public.engagements (id, client_slug, cycle_number, engagement_type, status, start_date) VALUES
  ('eb100000-0000-4000-8000-000000000001', 'rc-alpha', 1, 'standard_sprint', 'active', '2026-11-02');
INSERT INTO public.ad_accounts (id, name, last_synced_at) VALUES ('act_rc_a', 'RC A', now()), ('act_rc_b', 'RC B', now());
INSERT INTO public.client_ad_accounts (account_id, client_slug) VALUES ('act_rc_a', 'rc-alpha'), ('act_rc_b', 'rc-beta');
INSERT INTO public.creatives (ad_id, account_id, ad_name) VALUES
  ('rc_ad_a1', 'act_rc_a', 'RC A1'), ('rc_ad_a2', 'act_rc_a', 'RC A2'), ('rc_ad_b1', 'act_rc_b', 'RC B1');
INSERT INTO public.creative_daily_metrics (ad_id, account_id, date, impressions, spend, clicks, purchases, purchase_value) VALUES
  ('rc_ad_a1', 'act_rc_a', '2020-01-02', 1000, 50, 20, 2, 120);

-- ---------------------------------------------------------------- structure (1-4)
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN (
  'public.recommendations'::regclass, 'public.recommendation_decisions'::regclass, 'public.recommendation_execution_links'::regclass,
  'public.recommendation_outcomes'::regclass, 'public.recommendation_outcome_evidence'::regclass, 'public.recommendation_learnings'::regclass)),
  'row rules are on for the six recommendation tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name LIKE 'recommendation%' AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on the recommendation tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name LIKE 'recommendation%' AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0,
  'signed-in users only read; writes go through the checked functions');
SELECT ok(NOT has_function_privilege('authenticated', 'public.recommendation_evaluation(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.check_recommendation_evidence(text, jsonb)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.ad_belongs_to_client(text, text)', 'EXECUTE'),
  'the recommendation helpers are not callable by signed-in users');

-- ---------------------------------------------------------------- proposing and the client wall (5-9)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'eb000000-0000-4000-8000-000000000002', true);
CREATE TEMP TABLE r1 AS SELECT public.propose_recommendation('eb100000-0000-4000-8000-000000000001', 'creative', 'Test routine hooks',
  'Run three morning routine hooks against the current winner') AS id;
GRANT SELECT ON r1 TO authenticated;
SELECT is((SELECT state || ':' || version FROM public.recommendations WHERE id = (SELECT id FROM r1)), 'proposed:1', 'a recommendation starts proposed at version 1');
SELECT set_config('request.jwt.claim.sub', 'eb000000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.recommendations) + (SELECT count(*)::int FROM public.recommendation_decisions), 0,
  'a client reads no recommendations or decisions, even its own client''s');
SELECT throws_ok($$SELECT public.propose_recommendation('eb100000-0000-4000-8000-000000000001', 'creative', 'x', 'x')$$, '42501', NULL, 'a client cannot propose');
SELECT throws_ok($$SELECT public.decide_recommendation((SELECT id FROM r1), 1, 'accepted', 'x', 'x', 'x', '[]'::jsonb)$$, '42501', NULL, 'a client cannot decide');
SELECT throws_ok($$SELECT * FROM public.recommendation_ad_options('rc-alpha')$$, '42501', NULL, 'a client cannot list ads');

-- ---------------------------------------------------------------- deciding (10-14)
SELECT set_config('request.jwt.claim.sub', 'eb000000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$SELECT public.decide_recommendation((SELECT id FROM r1), 1, 'accepted', 'Strong hook data', NULL, 'Brief three hooks', '[]'::jsonb)$$,
  '22023', NULL, 'accepting needs a hypothesis');
SELECT throws_ok($$SELECT public.decide_recommendation((SELECT id FROM r1), 1, 'accepted', 'r', 'h', 'f', '[{"kind":"ad","id":"rc_ad_b1"}]'::jsonb)$$,
  '22023', NULL, 'an ad of another client cannot be cited');
SELECT throws_ok($$SELECT public.decide_recommendation((SELECT id FROM r1), 1, 'accepted', 'r', 'h', 'f', '[{"kind":"meeting_recap_item","id":"eb900000-0000-4000-8000-000000000001"}]'::jsonb)$$,
  '22023', NULL, 'a recap item that is not a confirmed item of this client cannot be cited');
SELECT throws_ok($$SELECT public.decide_recommendation((SELECT id FROM r1), 2, 'accepted', 'r', 'h', 'f', '[]'::jsonb)$$, '40001', NULL, 'a stale version is refused');
SELECT is(public.decide_recommendation((SELECT id FROM r1), 1, 'accepted', 'The current winner opens on a routine',
  'Routine openers lower CPA', 'Brief three routine hooks', '[{"kind":"ad","id":"rc_ad_a1"}]'::jsonb), 2, 'accepted with a cited ad, version 2');

-- ---------------------------------------------------------------- linking and evaluating (15-23)
SELECT is(public.record_recommendation_outcome((SELECT id FROM r1), 2), 'not_executed', 'without a link the outcome is not executed');
SELECT throws_ok($$SELECT public.link_recommendation_execution((SELECT id FROM r1), 3, ARRAY['rc_ad_b1'], NULL, 'eb000000-0000-4000-8000-000000000002', '2020-01-01', '2020-01-07')$$,
  '22023', NULL, 'another client''s ad cannot be linked');
SELECT throws_ok($$SELECT public.link_recommendation_execution((SELECT id FROM r1), 3, ARRAY['rc_ad_a1'], NULL, 'eb000000-0000-4000-8000-000000000003', '2020-01-01', '2020-01-07')$$,
  '22023', NULL, 'a client login cannot be the accountable owner');
SELECT is(public.link_recommendation_execution((SELECT id FROM r1), 3, ARRAY['rc_ad_a1', 'rc_ad_a2'], NULL, 'eb000000-0000-4000-8000-000000000002',
  '2020-01-01', '2020-01-07'), 4, 'two ads linked, version 4');
SELECT is(public.record_recommendation_outcome((SELECT id FROM r1), 4) || ':' || (SELECT reason FROM public.recommendation_outcomes WHERE recommendation_id = (SELECT id FROM r1) AND recommendation_version = 5),
  'insufficient:insufficient_testing', 'an ad with no impressions in the window leaves the outcome insufficient');
SELECT throws_ok($$SELECT public.review_recommendation_learning((SELECT id FROM r1), 5, (SELECT id FROM public.recommendation_outcomes WHERE recommendation_id = (SELECT id FROM r1) AND recommendation_version = 5), 'supported', 'x')$$,
  '40001', NULL, 'a learning needs a measured outcome');
SELECT is(public.link_recommendation_execution((SELECT id FROM r1), 5, ARRAY['rc_ad_a1'], NULL, 'eb000000-0000-4000-8000-000000000002',
  '2020-01-01', '2020-01-07'), 6, 'a new link supersedes the first, version 6');
SELECT is(public.record_recommendation_outcome((SELECT id FROM r1), 6), 'measured', 'the linked ad ran in the window and the account synced since: measured');
SELECT is((SELECT impressions || ':' || round(spend) || ':' || round(purchases) || ':' || metric_days FROM public.recommendation_outcome_evidence
            WHERE outcome_id = (SELECT id FROM public.recommendation_outcomes WHERE recommendation_id = (SELECT id FROM r1) AND recommendation_version = 7)),
  '1000:50:2:1', 'the outcome stores the numbers it read from the ad metrics');

-- ---------------------------------------------------------------- learning (24-26)
RESET role;
INSERT INTO public.creative_daily_metrics (ad_id, account_id, date, impressions, spend, clicks, purchases, purchase_value)
VALUES ('rc_ad_a1', 'act_rc_a', '2020-01-03', 500, 25, 5, 1, 60);
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'eb000000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$SELECT public.review_recommendation_learning((SELECT id FROM r1), 7, (SELECT id FROM public.recommendation_outcomes WHERE recommendation_id = (SELECT id FROM r1) AND recommendation_version = 7), 'supported', 'x')$$,
  '40001', NULL, 'new metrics in the window make the recorded outcome stale');
SELECT is(public.record_recommendation_outcome((SELECT id FROM r1), 7), 'measured', 'evaluated again: measured');
SELECT is(public.review_recommendation_learning((SELECT id FROM r1), 8,
  (SELECT id FROM public.recommendation_outcomes WHERE recommendation_id = (SELECT id FROM r1) AND recommendation_version = 8),
  'supported', 'Routine openers held CPA in the window'), 9, 'the learning is recorded, version 9');

-- ---------------------------------------------------------------- stale sync, ad options, history (27-29)
RESET role;
UPDATE public.ad_accounts SET last_synced_at = '2020-01-05' WHERE id = 'act_rc_a';
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'eb000000-0000-4000-8000-000000000002', true);
SELECT is(public.record_recommendation_outcome((SELECT id FROM r1), 9), 'inconclusive', 'an account last synced before the window closed is inconclusive');
SELECT ok((SELECT bool_or(ad_id = 'rc_ad_a1') AND NOT bool_or(ad_id = 'rc_ad_b1') FROM public.recommendation_ad_options('rc-alpha')),
  'the ad options list the client''s ads only');
RESET role;
SELECT throws_ok($$UPDATE public.recommendations SET title = 'changed', version = version + 1$$, '23514', NULL, 'the proposal cannot be changed');

SELECT * FROM finish();
ROLLBACK;
