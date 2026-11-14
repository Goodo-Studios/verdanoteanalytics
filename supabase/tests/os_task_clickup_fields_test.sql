-- Goodo OS: the task modal shows and edits every ClickUp field (migration 20261207080001).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: the new os_tasks columns exist; staff edit a ClickUp custom field with os_set_task_field
-- (drop-down by name, link, hooks, date, number, checkbox), the value is stored in clickup_fields and
-- in the column that mirrors the field, and a bad value, a field the task does not have, a field of a
-- type the app cannot edit and a read-only task are refused; the edit queues one write-back row per
-- field (a second edit folds into it, changing back skips it); an app edit of the description,
-- priority or start date queues; a write by the ClickUp sync (service role) or with
-- app.sync_source = 'clickup' queues nothing; the outbox accepts the new kinds only with a matching
-- field; a client reads no row, cannot edit and gets none of the new columns from os_client_tasks().
-- All rows are made up.

BEGIN;
SELECT plan(33);

INSERT INTO auth.users (id, email) VALUES
  ('e7180000-0000-4000-8000-000000000001', 'fx-builder@example.test'),
  ('e7180000-0000-4000-8000-000000000002', 'fx-employee@example.test'),
  ('e7180000-0000-4000-8000-000000000003', 'fx-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e7180000-0000-4000-8000-000000000001', 'builder'),
  ('e7180000-0000-4000-8000-000000000002', 'employee'),
  ('e7180000-0000-4000-8000-000000000003', 'client');
INSERT INTO public.clients (slug, name, status) VALUES ('fx-alpha', 'FX Alpha', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('e7180000-0000-4000-8000-000000000003', 'fx-alpha');

CREATE TEMP TABLE r AS SELECT NULL::uuid AS a, NULL::uuid AS ro;
GRANT ALL ON r TO authenticated, service_role;

-- ---------------------------------------------------------------- structure and sync (1-4)
SELECT is((SELECT count(*)::int FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'os_tasks'
              AND column_name IN ('description_markdown', 'priority', 'start_date', 'clickup_tags',
                                  'clickup_created_at', 'clickup_creator', 'time_estimate_ms', 'clickup_fields')), 8,
  'os_tasks has the eight new ClickUp columns');
SELECT ok(has_function_privilege('authenticated', 'public.os_set_task_field(uuid, text, text)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.os_set_task_field(uuid, text, text)', 'EXECUTE'),
  'signed-in users can call os_set_task_field and anon cannot');

SET LOCAL role service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);

INSERT INTO public.os_tasks (client_slug, title, status, raw_status, clickup_task_id, clickup_list_id, is_asset,
                             description, description_markdown, priority, start_date, hooks, content_type, clickup_fields)
VALUES ('fx-alpha', 'December Asset 1', 'editing', 'editing', 'cu-fx-a', 'l-fx', true,
        'Old brief', 'Old brief', 'normal', '2026-12-01', '{First}', 'Hook',
        '[{"id":"f58bc404-0076-4b16-8950-1fce77e04b2a","name":"Type of Content","type":"drop_down","display":"Hook","options":[{"id":"o1","name":"Hook"},{"id":"o2","name":"UGC"},{"id":"o3","name":"Testimonial"}]},
          {"id":"43b89e72-8575-49e6-bf6a-fc90f373291c","name":"Link to Asset","type":"url","display":null},
          {"id":"0c49e3b4-6081-4294-9fc6-59f461a0da30","name":"Goodo Ad Name Hook 1","type":"short_text","display":"First"},
          {"id":"6a1c6c8f-4565-4075-8f57-fbc34b503096","name":"Goodo Ad Name Hook 2","type":"short_text","display":null},
          {"id":"91bf5fcc-9265-4c23-86b2-ce160074f2aa","name":"Brief due","type":"date","display":null},
          {"id":"0c2895bf-ef32-436d-803a-f24aa422a791","name":"Reviewed By","type":"users","display":"sam@example.test"},
          {"id":"cf-num","name":"Budget","type":"number","display":"5"},
          {"id":"cf-chk","name":"Rush","type":"checkbox","display":"false"}]'::jsonb),
       ('fx-alpha', 'October Asset 9', 'complete', 'complete', 'cu-fx-r', 'l-old', true,
        NULL, NULL, NULL, NULL, '{}', NULL,
        '[{"id":"cf-num","name":"Budget","type":"number","display":"1"}]'::jsonb);
UPDATE public.os_tasks SET read_only = true WHERE clickup_task_id = 'cu-fx-r';
UPDATE r SET a = (SELECT id FROM public.os_tasks WHERE clickup_task_id = 'cu-fx-a'),
             ro = (SELECT id FROM public.os_tasks WHERE clickup_task_id = 'cu-fx-r');

UPDATE public.os_tasks
   SET description_markdown = 'Synced brief', description = 'Synced brief', priority = 'urgent', start_date = '2026-12-02',
       clickup_fields = jsonb_set(clickup_fields, '{0,display}', '"UGC"')
 WHERE id = (SELECT a FROM r);
SELECT is((SELECT count(*)::int FROM public.os_clickup_outbox), 0,
  'a change to the new fields by the ClickUp sync (service role) queues nothing');
SELECT is((SELECT description_markdown || ' ' || priority || ' ' || start_date::text FROM public.os_tasks WHERE id = (SELECT a FROM r)),
  'Synced brief urgent 2026-12-02', 'the sync can write the new columns');
UPDATE public.os_tasks
   SET description_markdown = 'Old brief', description = 'Old brief', priority = 'normal', start_date = '2026-12-01',
       clickup_fields = jsonb_set(clickup_fields, '{0,display}', '"Hook"')
 WHERE id = (SELECT a FROM r);

-- ---------------------------------------------------------------- staff edit fields (5-20)
RESET role;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'e7180000-0000-4000-8000-000000000002', true);

SELECT lives_ok($$SELECT public.os_set_task_field((SELECT a FROM r), 'f58bc404-0076-4b16-8950-1fce77e04b2a', 'ugc')$$,
  'staff set a drop-down by option name, ignoring case');
SELECT is((SELECT content_type || ' ' || (clickup_fields -> 0 ->> 'display') FROM public.os_tasks WHERE id = (SELECT a FROM r)),
  'UGC UGC', 'the drop-down choice is stored in the field and in the content_type column');
RESET role;
SELECT is((SELECT kind || ' ' || field || ' ' || (payload ->> 'from') || '>' || (payload ->> 'to') || ' ' || state
             FROM public.os_clickup_outbox WHERE task_id = (SELECT a FROM r)),
  'custom_field cf:f58bc404-0076-4b16-8950-1fce77e04b2a Hook>UGC queued', 'the edit queues one write-back row with both values');
SET LOCAL role authenticated;

SELECT public.os_set_task_field((SELECT a FROM r), 'f58bc404-0076-4b16-8950-1fce77e04b2a', 'Testimonial');
RESET role;
SELECT is((SELECT count(*)::int || ' ' || min(payload ->> 'from') || '>' || min(payload ->> 'to')
             FROM public.os_clickup_outbox WHERE field LIKE 'cf:%' AND state = 'queued'),
  '1 Hook>Testimonial', 'a second edit before sending folds into the same row');
SET LOCAL role authenticated;

SELECT public.os_set_task_field((SELECT a FROM r), 'f58bc404-0076-4b16-8950-1fce77e04b2a', 'Hook');
RESET role;
SELECT is((SELECT state FROM public.os_clickup_outbox WHERE field = 'cf:f58bc404-0076-4b16-8950-1fce77e04b2a'), 'skipped',
  'changing the field back before sending marks the row skipped');
SET LOCAL role authenticated;

SELECT throws_ok($$SELECT public.os_set_task_field((SELECT a FROM r), 'f58bc404-0076-4b16-8950-1fce77e04b2a', 'Podcast')$$,
  '22023', NULL, 'a choice the field does not have is refused');
SELECT throws_ok($$SELECT public.os_set_task_field((SELECT a FROM r), '43b89e72-8575-49e6-bf6a-fc90f373291c', 'ftp://files.example.test/a')$$,
  '22023', NULL, 'a link that is not http or https is refused');
SELECT lives_ok($$SELECT public.os_set_task_field((SELECT a FROM r), '43b89e72-8575-49e6-bf6a-fc90f373291c', 'https://files.example.test/a')$$,
  'staff set the asset link');
SELECT is((SELECT asset_url FROM public.os_tasks WHERE id = (SELECT a FROM r)), 'https://files.example.test/a',
  'the asset link column follows the field');

SELECT public.os_set_task_field((SELECT a FROM r), '6a1c6c8f-4565-4075-8f57-fbc34b503096', '  Second hook ');
SELECT is((SELECT hooks FROM public.os_tasks WHERE id = (SELECT a FROM r)), '{First,"Second hook"}'::text[],
  'the hooks column holds both hook fields in order, trimmed');
SELECT public.os_set_task_field((SELECT a FROM r), '0c49e3b4-6081-4294-9fc6-59f461a0da30', '');
SELECT is((SELECT hooks FROM public.os_tasks WHERE id = (SELECT a FROM r)), '{"Second hook"}'::text[],
  'clearing a hook removes it from the hooks column');

SELECT public.os_set_task_field((SELECT a FROM r), '91bf5fcc-9265-4c23-86b2-ce160074f2aa', '2026-12-12');
SELECT is((SELECT brief_due_date::text FROM public.os_tasks WHERE id = (SELECT a FROM r)), '2026-12-12',
  'a date field sets the matching date column');
SELECT throws_ok($$SELECT public.os_set_task_field((SELECT a FROM r), '91bf5fcc-9265-4c23-86b2-ce160074f2aa', '12/12/2026')$$,
  '22023', NULL, 'a date that is not YYYY-MM-DD is refused');

SELECT public.os_set_task_field((SELECT a FROM r), 'cf-num', '12.50');
SELECT public.os_set_task_field((SELECT a FROM r), 'cf-chk', 'TRUE');
SELECT is((SELECT (clickup_fields -> 6 ->> 'display') || ' ' || (clickup_fields -> 7 ->> 'display') FROM public.os_tasks WHERE id = (SELECT a FROM r)),
  '12.5 true', 'a number is stored without trailing zeros and a checkbox as true or false');
SELECT throws_ok($$SELECT public.os_set_task_field((SELECT a FROM r), 'cf-num', 'lots')$$,
  '22023', NULL, 'a number field refuses text');
SELECT throws_ok($$SELECT public.os_set_task_field((SELECT a FROM r), '0c2895bf-ef32-436d-803a-f24aa422a791', 'x@example.test')$$,
  '22023', NULL, 'a people field cannot be edited with it');
SELECT throws_ok($$SELECT public.os_set_task_field((SELECT a FROM r), 'no-such-field', 'x')$$,
  'P0002', NULL, 'a field the task does not have is refused');
SELECT throws_ok($$SELECT public.os_set_task_field((SELECT ro FROM r), 'cf-num', '3')$$,
  '42501', NULL, 'a read-only task refuses the edit');

-- ---------------------------------------------------------------- description, priority, start date (21-24)
RESET role;
DELETE FROM public.os_clickup_outbox;
SET LOCAL role authenticated;

UPDATE public.os_tasks SET description_markdown = 'New brief', description = 'New brief', priority = 'high',
       start_date = '2026-12-03' WHERE id = (SELECT a FROM r);
RESET role;
SELECT is((SELECT kind || ' ' || (payload ->> 'from') || '>' || (payload ->> 'to') FROM public.os_clickup_outbox WHERE field = 'description'),
  'description Old brief>New brief', 'an app edit of the brief queues the old and new text');
SELECT is((SELECT (payload ->> 'from') || '>' || (payload ->> 'to') FROM public.os_clickup_outbox WHERE field = 'priority'),
  'normal>high', 'an app priority change queues');
SELECT is((SELECT (payload ->> 'from') || '>' || (payload ->> 'to') FROM public.os_clickup_outbox WHERE field = 'start_date'),
  '2026-12-01>2026-12-03', 'an app start date change queues');
SET LOCAL role authenticated;
SELECT throws_ok($$UPDATE public.os_tasks SET priority = 'extreme' WHERE id = (SELECT a FROM r)$$,
  '23514', NULL, 'a priority other than urgent, high, normal or low is refused');

-- ---------------------------------------------------------------- nothing else queues (25-26)
RESET role;
DELETE FROM public.os_clickup_outbox;
SET LOCAL role authenticated;
SELECT set_config('app.sync_source', 'clickup', true);
UPDATE public.os_tasks SET description_markdown = 'From ClickUp', description = 'From ClickUp', priority = 'low'
 WHERE id = (SELECT a FROM r);
SELECT public.os_set_task_field((SELECT a FROM r), 'cf-num', '99');
SELECT set_config('app.sync_source', '', true);
RESET role;
SELECT is((SELECT count(*)::int FROM public.os_clickup_outbox), 0,
  'writes marked app.sync_source = clickup queue nothing, including a custom field');

SET LOCAL role service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT lives_ok($$INSERT INTO public.os_clickup_outbox (clickup_task_id, kind, field) VALUES ('cu-fx-a', 'custom_field', 'cf:abc')$$,
  'the outbox accepts a custom_field row with a cf: field');
SELECT throws_ok($$INSERT INTO public.os_clickup_outbox (clickup_task_id, kind, field) VALUES ('cu-fx-a', 'custom_field', 'status')$$,
  '23514', NULL, 'the outbox refuses a custom_field row with another field');
SELECT throws_ok($$INSERT INTO public.os_clickup_outbox (clickup_task_id, kind, field) VALUES ('cu-fx-a', 'priority', 'cf:abc')$$,
  '23514', NULL, 'the outbox refuses a priority row with another field');
DELETE FROM public.os_clickup_outbox;

-- ---------------------------------------------------------------- the client wall (30-32)
RESET role;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'e7180000-0000-4000-8000-000000000003', true);

SELECT is((SELECT count(*)::int FROM public.os_tasks), 0, 'a client reads no task rows directly');
SELECT is((SELECT count(*)::int FROM public.os_client_tasks() t, jsonb_object_keys(to_jsonb(t)) k
            WHERE k IN ('description_markdown', 'priority', 'start_date', 'clickup_tags', 'clickup_created_at',
                        'clickup_creator', 'time_estimate_ms', 'clickup_fields')), 0,
  'os_client_tasks() returns none of the new columns to a client');
SELECT throws_ok($$SELECT public.os_set_task_field((SELECT a FROM r), 'cf-num', '1')$$, 'P0002', NULL,
  'a client cannot edit a ClickUp field');

RESET role;
SELECT * FROM finish();
ROLLBACK;
