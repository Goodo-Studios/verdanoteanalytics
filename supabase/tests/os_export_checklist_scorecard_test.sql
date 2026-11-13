-- OS-023: export checklist, its setting, and the scorecard from status history
-- (migration 20261205080001).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: the setting is off and no status was removed; row rules on and no anon grants; staff
-- start, tick and remove checklist items; a client sees no item, cannot add one and cannot start a
-- checklist; a client cannot read or change the setting; the scorecard counts October from the
-- history (milestones on time and late, revisions, completions, the total row) and gives a client
-- no rows. All rows are made up.

BEGIN;
SELECT plan(26);

INSERT INTO auth.users (id, email) VALUES
  ('ec000000-0000-4000-8000-000000000001', 'oc-builder@example.test'),
  ('ec000000-0000-4000-8000-000000000002', 'oc-employee@example.test'),
  ('ec000000-0000-4000-8000-000000000003', 'oc-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('ec000000-0000-4000-8000-000000000001', 'builder'),
  ('ec000000-0000-4000-8000-000000000002', 'employee'),
  ('ec000000-0000-4000-8000-000000000003', 'client');
INSERT INTO public.clients (slug, name, status) VALUES ('oc-alpha', 'OC Alpha', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('ec000000-0000-4000-8000-000000000003', 'oc-alpha');

INSERT INTO public.os_tasks (id, client_slug, title, status, is_asset, brief_due_date, cut_to_strategist_date, cut_to_client_date) VALUES
  ('ec100000-0000-4000-8000-000000000001', 'oc-alpha', 'OC task one', 'export versions', true, '2026-10-05', '2026-10-10', '2026-10-20'),
  ('ec100000-0000-4000-8000-000000000002', 'oc-alpha', 'OC task two', 'editing', true, '2026-10-01', null, null);

-- October history (the insert trigger already wrote a first row dated today, outside October).
INSERT INTO public.os_task_status_history (task_id, from_status, to_status, changed_at, source) VALUES
  ('ec100000-0000-4000-8000-000000000001', 'brief creation', 'client brief review', '2026-10-04 15:00+00', 'clickup'),
  ('ec100000-0000-4000-8000-000000000001', 'editing', 'internal review', '2026-10-12 15:00+00', 'clickup'),
  ('ec100000-0000-4000-8000-000000000001', 'internal review', 'internal review edits', '2026-10-13 15:00+00', 'clickup'),
  ('ec100000-0000-4000-8000-000000000001', 'internal review edits', 'internal review', '2026-10-14 15:00+00', 'clickup'),
  ('ec100000-0000-4000-8000-000000000001', 'versions exported', 'client review', '2026-10-19 15:00+00', 'clickup'),
  ('ec100000-0000-4000-8000-000000000001', 'client review', 'client revisions', '2026-10-21 15:00+00', 'clickup'),
  ('ec100000-0000-4000-8000-000000000001', 'client review', 'complete', '2026-10-28 15:00+00', 'clickup'),
  ('ec100000-0000-4000-8000-000000000002', 'brief creation', 'client brief review', '2026-10-03 15:00+00', 'clickup'),
  ('ec100000-0000-4000-8000-000000000002', 'brief creation', 'client brief review', '2026-09-20 15:00+00', 'clickup');

-- ---------------------------------------------------------------- structure (1-5)
SELECT is((SELECT value FROM public.os_settings WHERE key = 'export_checklist_replaces_statuses'), 'false'::jsonb,
  'the checklist setting is off');
SELECT is((SELECT count(*)::int FROM public.os_task_statuses
            WHERE status IN ('export versions', 'versions exported', 'ready to send to client', 'ready to transfer')), 4,
  'all four export statuses are still there');
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN (
  'public.os_settings'::regclass, 'public.os_export_checklist_template'::regclass, 'public.os_task_checklist_items'::regclass)),
  'row rules are on for the three new tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name IN ('os_settings', 'os_export_checklist_template', 'os_task_checklist_items')
              AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on the new tables');
SELECT ok(NOT has_function_privilege('anon', 'public.os_scorecard(date)', 'EXECUTE'), 'anon cannot run the scorecard');

-- ---------------------------------------------------------------- staff edit the checklist (6-11)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'ec000000-0000-4000-8000-000000000002', true);
SELECT is(public.os_task_checklist_start('ec100000-0000-4000-8000-000000000001'), 4, 'staff start the checklist with four items');
SELECT is(public.os_task_checklist_start('ec100000-0000-4000-8000-000000000001'), 0, 'starting again adds nothing');
UPDATE public.os_task_checklist_items SET done = true
 WHERE task_id = 'ec100000-0000-4000-8000-000000000001' AND position = 10;
SELECT is((SELECT done_by FROM public.os_task_checklist_items WHERE task_id = 'ec100000-0000-4000-8000-000000000001' AND position = 10),
  'ec000000-0000-4000-8000-000000000002'::uuid, 'ticking an item records who ticked it');
INSERT INTO public.os_task_checklist_items (task_id, label, position) VALUES ('ec100000-0000-4000-8000-000000000001', 'Extra square cut', 50);
SELECT is((SELECT count(*)::int FROM public.os_task_checklist_items WHERE task_id = 'ec100000-0000-4000-8000-000000000001'), 5,
  'staff add their own item');
DELETE FROM public.os_task_checklist_items WHERE task_id = 'ec100000-0000-4000-8000-000000000001' AND label = 'Extra square cut';
SELECT is((SELECT count(*)::int FROM public.os_task_checklist_items WHERE task_id = 'ec100000-0000-4000-8000-000000000001'), 4,
  'staff remove an item');
UPDATE public.os_settings SET value = 'true'::jsonb WHERE key = 'export_checklist_replaces_statuses';
SELECT is((SELECT value FROM public.os_settings WHERE key = 'export_checklist_replaces_statuses'), 'false'::jsonb,
  'an employee cannot turn the setting on');

-- ---------------------------------------------------------------- clients see nothing (12-18)
SELECT set_config('request.jwt.claim.sub', 'ec000000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.os_task_checklist_items), 0, 'a client sees no checklist item');
SELECT is((SELECT count(*)::int FROM public.os_export_checklist_template), 0, 'a client sees no checklist template');
SELECT is((SELECT count(*)::int FROM public.os_settings), 0, 'a client sees no setting');
SELECT throws_ok($$INSERT INTO public.os_task_checklist_items (task_id, label) VALUES ('ec100000-0000-4000-8000-000000000001', 'Sneaky')$$,
  '42501', NULL, 'a client cannot add a checklist item');
SELECT throws_ok($$SELECT public.os_task_checklist_start('ec100000-0000-4000-8000-000000000002')$$,
  '42501', 'staff only', 'a client cannot start a checklist');
SELECT is((SELECT count(*)::int FROM public.os_scorecard('2026-10-01')), 0, 'a client gets no scorecard rows');
UPDATE public.os_task_checklist_items SET done = true;
SELECT set_config('request.jwt.claim.sub', 'ec000000-0000-4000-8000-000000000002', true);
SELECT is((SELECT count(*)::int FROM public.os_task_checklist_items WHERE done), 1, 'a client update changed nothing');

-- ---------------------------------------------------------------- scorecard for October (19-26)
CREATE TEMP TABLE sc AS SELECT * FROM public.os_scorecard('2026-10-15') WHERE client_slug = 'oc-alpha' AND NOT is_total;
SELECT is((SELECT briefs_done || '/' || briefs_on_time FROM sc), '1/1',
  'one brief first reached in October and on time (task two first reached it in September)');
SELECT is((SELECT cuts_to_strategist || '/' || cuts_to_strategist_on_time FROM sc), '1/0',
  'one cut to the strategist, late, counted once though it came back');
SELECT is((SELECT cuts_to_client || '/' || cuts_to_client_on_time FROM sc), '1/1', 'one cut to the client, on time');
SELECT is((SELECT internal_revisions || '/' || client_revisions || '/' || completed FROM sc), '1/1/1',
  'one internal round, one client round, one completed');
SELECT ok((SELECT completed >= 1 AND briefs_done >= 1 FROM public.os_scorecard('2026-10-01') WHERE is_total), 'there is a total row');
SELECT is((SELECT count(*)::int FROM public.os_scorecard('2026-08-01') WHERE client_slug = 'oc-alpha'), 0, 'August has nothing for the client');
SELECT is((SELECT count(*)::int FROM public.os_scorecard('2026-10-01') WHERE is_total), 1, 'an employee gets the total row');
SELECT set_config('request.jwt.claim.sub', 'ec000000-0000-4000-8000-000000000001', true);
SELECT ok((SELECT count(*)::int FROM public.os_scorecard('2026-10-01') WHERE client_slug = 'oc-alpha' AND NOT is_total) = 1,
  'a builder gets the client row');

SELECT * FROM finish();
ROLLBACK;
