-- The review link on cards (migration 20261115000001, phase 5b).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Who is who (all made up):
--   client A   linked to client al-alpha through client_members
--   client B   a client login with no links
--   employee   staff
--
-- Checks: both card tables gained asset_link; the database refuses anything that is not an https
-- address on air.inc or a subdomain (javascript:, http, look-alike hosts, user names, ports, spaces,
-- very long values); null is allowed; a client reads asset_link of its own client's cards only and
-- cannot change it; staff read it; the browser role cannot write it.

BEGIN;
SELECT plan(24);

INSERT INTO auth.users (id, email) VALUES
  ('e1000000-0000-4000-8000-000000000002', 'al-employee@example.test'),
  ('e1000000-0000-4000-8000-000000000003', 'al-client-a@example.test'),
  ('e1000000-0000-4000-8000-000000000004', 'al-client-b@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e1000000-0000-4000-8000-000000000002', 'employee'),
  ('e1000000-0000-4000-8000-000000000003', 'client'),
  ('e1000000-0000-4000-8000-000000000004', 'client');
INSERT INTO public.clients (slug, name, status) VALUES
  ('al-alpha', 'AL Alpha', 'active'), ('al-beta', 'AL Beta', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('e1000000-0000-4000-8000-000000000003', 'al-alpha');

INSERT INTO public.pipeline_tasks (clickup_task_id, client_slug, stage, asset_link) VALUES
  ('al-t-1', 'al-alpha', 'Client Review', 'https://app.air.inc/a/baf09d5e3'),
  ('al-t-2', 'al-alpha', 'Editing', NULL),
  ('al-t-3', 'al-beta', 'Client Review', 'https://app.air.inc/a/beta0001');
INSERT INTO public.pipeline_delivered (clickup_task_id, client_slug, delivered_at, asset_link) VALUES
  ('al-d-1', 'al-alpha', '2026-09-20', 'https://goodo.shares.air.inc/s/abc?x=1'),
  ('al-d-2', 'al-beta', '2026-09-21', 'https://app.air.inc/a/beta0002');

-- ---------------------------------------------------------------- structure (1-2)
SELECT has_column('public', 'pipeline_tasks', 'asset_link', 'pipeline_tasks has asset_link');
SELECT has_column('public', 'pipeline_delivered', 'asset_link', 'pipeline_delivered has asset_link');

-- ---------------------------------------------------------------- the constraint (3-12)
SELECT lives_ok($$UPDATE public.pipeline_tasks SET asset_link = 'https://air.inc/a/x' WHERE clickup_task_id = 'al-t-2'$$,
  'the bare host air.inc is accepted');
SELECT lives_ok($$UPDATE public.pipeline_tasks SET asset_link = NULL WHERE clickup_task_id = 'al-t-2'$$,
  'null is accepted');
SELECT throws_ok($$UPDATE public.pipeline_tasks SET asset_link = 'javascript:alert(1)' WHERE clickup_task_id = 'al-t-2'$$,
  '23514', NULL, 'a javascript: address is refused');
SELECT throws_ok($$UPDATE public.pipeline_tasks SET asset_link = 'http://app.air.inc/a/x' WHERE clickup_task_id = 'al-t-2'$$,
  '23514', NULL, 'http (not https) is refused');
SELECT throws_ok($$UPDATE public.pipeline_tasks SET asset_link = 'https://air.inc.evil.com/a' WHERE clickup_task_id = 'al-t-2'$$,
  '23514', NULL, 'air.inc.evil.com is refused');
SELECT throws_ok($$UPDATE public.pipeline_tasks SET asset_link = 'https://evilair.inc/a' WHERE clickup_task_id = 'al-t-2'$$,
  '23514', NULL, 'evilair.inc is refused');
SELECT throws_ok($$UPDATE public.pipeline_tasks SET asset_link = 'https://app.air.inc@evil.com/a' WHERE clickup_task_id = 'al-t-2'$$,
  '23514', NULL, 'a user name trick is refused');
SELECT throws_ok($$UPDATE public.pipeline_tasks SET asset_link = 'https://app.air.inc:8443/a' WHERE clickup_task_id = 'al-t-2'$$,
  '23514', NULL, 'a custom port is refused');
SELECT throws_ok($$UPDATE public.pipeline_delivered SET asset_link = 'https://air.inc.evil.com/a' WHERE clickup_task_id = 'al-d-1'$$,
  '23514', NULL, 'the delivered table refuses a look-alike host too');
SELECT throws_ok($$UPDATE public.pipeline_tasks SET asset_link = 'https://app.air.inc/a b' WHERE clickup_task_id = 'al-t-2'$$,
  '23514', NULL, 'a value with a space is refused');

-- ---------------------------------------------------------------- client A (13-17)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000003', true);

SELECT is(ARRAY(SELECT asset_link FROM public.pipeline_tasks WHERE clickup_task_id = 'al-t-1'), ARRAY['https://app.air.inc/a/baf09d5e3'],
  'client A reads the link of its own client''s card');
SELECT is((SELECT count(*)::int FROM public.pipeline_tasks WHERE asset_link LIKE '%beta%'), 0,
  'client A reads no link of another client''s card');
SELECT is(ARRAY(SELECT asset_link FROM public.pipeline_delivered), ARRAY['https://goodo.shares.air.inc/s/abc?x=1'],
  'client A reads the link of its own delivered work and no other');
-- No update rule applies to a client, so the statement matches no row (the last checks show the value is unchanged).
SELECT lives_ok($$UPDATE public.pipeline_tasks SET asset_link = 'https://app.air.inc/a/own' WHERE clickup_task_id = 'al-t-1'$$,
  'client A''s attempt to change a link matches no row');
SELECT throws_ok($$UPDATE public.pipeline_delivered SET asset_link = 'https://app.air.inc/a/own'$$,
  '42501', NULL, 'client A cannot change a delivered link');

-- ---------------------------------------------------------------- client B (18-19)
SELECT set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000004', true);
SELECT is((SELECT count(*)::int FROM public.pipeline_tasks WHERE asset_link IS NOT NULL), 0, 'client B reads no card links');
SELECT is((SELECT count(*)::int FROM public.pipeline_delivered WHERE asset_link IS NOT NULL), 0, 'client B reads no delivered links');

-- ---------------------------------------------------------------- staff (20-22)
SELECT set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000002', true);
SELECT is((SELECT count(*)::int FROM public.pipeline_tasks WHERE clickup_task_id LIKE 'al-t-%' AND asset_link IS NOT NULL), 2,
  'employee reads the links of every client''s cards');
SELECT is((SELECT count(*)::int FROM public.pipeline_delivered WHERE clickup_task_id LIKE 'al-d-%' AND asset_link IS NOT NULL), 2,
  'employee reads the links of all delivered work');
-- Staff may write pipeline_tasks through their own row rule, but the value is still checked.
SELECT throws_ok($$UPDATE public.pipeline_tasks SET asset_link = 'https://evil.com/a' WHERE clickup_task_id = 'al-t-1'$$,
  '23514', NULL, 'a staff write of a non-Air link is refused too');
RESET role;

-- ---------------------------------------------------------------- the stored values (23-24)
SELECT is((SELECT asset_link FROM public.pipeline_tasks WHERE clickup_task_id = 'al-t-1'), 'https://app.air.inc/a/baf09d5e3',
  'the client update changed nothing');
SELECT is((SELECT count(*)::int FROM public.pipeline_delivered WHERE clickup_task_id = 'al-d-1' AND asset_link = 'https://goodo.shares.air.inc/s/abc?x=1'), 1,
  'the delivered link is unchanged');

SELECT * FROM finish();
ROLLBACK;
