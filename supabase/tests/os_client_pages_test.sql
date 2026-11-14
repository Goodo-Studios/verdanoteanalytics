-- OS-019: client home and the Briefs, Review and Assets pages.
--
-- Covers: the field allow-list (a throwaway os_tasks column added inside this transaction never
-- reaches a client until it is allow-listed); a client sees only their own clients' tasks and only
-- allow-listed fields; approve and request changes move the task, write status history and notify
-- the strategist (or every builder when there is none); another client, staff and anon are refused;
-- a client cannot change title, due date or status directly; internal comments never reach a client.
-- All rows are made up.

BEGIN;
SELECT plan(38);

INSERT INTO auth.users (id, email) VALUES
  ('e1900000-0000-4000-8000-000000000001', 'cp-builder@example.test'),
  ('e1900000-0000-4000-8000-000000000002', 'cp-strategist@example.test'),
  ('e1900000-0000-4000-8000-000000000003', 'cp-client-a@example.test'),
  ('e1900000-0000-4000-8000-000000000004', 'cp-client-b@example.test'),
  ('e1900000-0000-4000-8000-000000000005', 'cp-nobody@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e1900000-0000-4000-8000-000000000001', 'builder'),
  ('e1900000-0000-4000-8000-000000000002', 'employee'),
  ('e1900000-0000-4000-8000-000000000003', 'client'),
  ('e1900000-0000-4000-8000-000000000004', 'client');
INSERT INTO public.clients (slug, name, status) VALUES ('cp-alpha', 'CP Alpha', 'active'), ('cp-beta', 'CP Beta', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES
  ('e1900000-0000-4000-8000-000000000003', 'cp-alpha'),
  ('e1900000-0000-4000-8000-000000000004', 'cp-beta');

-- Tasks: two Alpha tasks in Client Review (one with a strategist, one without), one Alpha brief,
-- one Alpha delivered, one Beta in Client Review.
INSERT INTO public.os_tasks (id, client_slug, title, status, due_date, brief, asset_url, strategist_id, hooks, stuck_reason, is_stuck) VALUES
  ('a1900000-0000-4000-8000-000000000001', 'cp-alpha', 'Alpha review 1', 'client review', '2026-12-01', 'Brief one',
   'https://example.test/a1', 'e1900000-0000-4000-8000-000000000002', ARRAY['secret hook'], 'internal reason', true),
  ('a1900000-0000-4000-8000-000000000002', 'cp-alpha', 'Alpha review 2', 'client review', '2026-12-05', NULL,
   'https://example.test/a2', NULL, '{}', NULL, false),
  ('a1900000-0000-4000-8000-000000000003', 'cp-alpha', 'Alpha brief', 'client brief review', '2026-12-10', 'Brief three',
   NULL, NULL, '{}', NULL, false),
  ('a1900000-0000-4000-8000-000000000004', 'cp-alpha', 'Alpha delivered', 'ready for launch', '2026-11-03', NULL,
   'https://example.test/a4', NULL, '{}', NULL, false),
  ('a1900000-0000-4000-8000-000000000005', 'cp-beta', 'Beta review', 'client review', '2026-12-02', NULL,
   'https://example.test/b1', NULL, '{}', NULL, false);

-- Acceptance 2: a column added after this story. It holds a value, and no one has allow-listed it.
ALTER TABLE public.os_tasks ADD COLUMN cp_throwaway_secret text;
UPDATE public.os_tasks SET cp_throwaway_secret = 'do not show' WHERE client_slug = 'cp-alpha';

-- ---------------------------------------------------------------- structure (1-6)
SELECT set_eq('SELECT field FROM public.os_client_visible_fields',
  ARRAY['title', 'stage', 'due_date', 'brief', 'asset_url'],
  'the allow-list holds exactly title, stage, due_date, brief and asset_url');
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN (
  'public.os_client_visible_fields'::regclass, 'public.os_task_client_decisions'::regclass)),
  'row rules are on for the allow-list and the decisions');
SELECT ok(NOT has_function_privilege('anon', 'public.os_client_task_cards()', 'EXECUTE'), 'anon cannot call os_client_task_cards');
SELECT ok(NOT has_function_privilege('anon', 'public.os_client_decide(uuid, text, text)', 'EXECUTE'), 'anon cannot call os_client_decide');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name IN ('os_client_visible_fields', 'os_task_client_decisions')
              AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0,
  'signed-in users cannot write the allow-list or the decisions directly');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name IN ('os_client_visible_fields', 'os_task_client_decisions')
              AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on the new tables');

-- An internal comment and a client comment on Alpha review 1, posted by the builder.
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e1900000-0000-4000-8000-000000000001', true);
SELECT public.post_task_comment('a1900000-0000-4000-8000-000000000001', 'internal', 'CP internal only');
SELECT public.post_task_comment('a1900000-0000-4000-8000-000000000001', 'client', 'CP for the client');

-- ---------------------------------------------------------------- staff and no role (7-9)
SELECT is((SELECT count(*)::int FROM public.os_client_task_cards()), 0, 'staff get no rows from the client cards');
SELECT throws_ok($$SELECT public.os_client_decide('a1900000-0000-4000-8000-000000000001', 'approved', NULL)$$, '42501', NULL,
  'staff cannot decide for a client');
SELECT set_config('request.jwt.claim.sub', 'e1900000-0000-4000-8000-000000000005', true);
SELECT is((SELECT count(*)::int FROM public.os_client_task_cards()), 0, 'a login with no role gets no cards');

-- ---------------------------------------------------------------- client A reads (10-20)
SELECT set_config('request.jwt.claim.sub', 'e1900000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.os_client_task_cards()), 4, 'client A gets their four tasks');
SELECT is((SELECT count(*)::int FROM public.os_client_task_cards() c WHERE c->>'title' LIKE 'Beta%'), 0,
  'client A never gets another client''s task');
SELECT set_eq($$SELECT DISTINCT k FROM public.os_client_task_cards() c, jsonb_object_keys(c) k$$,
  ARRAY['id', 'decision', 'title', 'stage', 'due_date', 'brief', 'asset_url'],
  'each card has exactly id, decision and the allow-listed fields');
SELECT is((SELECT count(*)::int FROM public.os_client_task_cards() c WHERE c ? 'cp_throwaway_secret'), 0,
  'a new column that is not allow-listed never reaches a client');
SELECT is((SELECT count(*)::int FROM public.os_client_task_cards() c WHERE c::text LIKE '%do not show%'), 0,
  'the new column''s value is nowhere in the client output');
SELECT is((SELECT count(*)::int FROM public.os_client_task_cards() c
            WHERE c ?| ARRAY['status', 'strategist_id', 'producer_id', 'editor_id', 'hooks', 'qa_checklist',
                             'is_stuck', 'stuck_reason', 'clickup_task_id', 'assignees', 'description', 'client_slug']), 0,
  'no internal field reaches a client');
SELECT is((SELECT c->>'stage' FROM public.os_client_task_cards() c WHERE c->>'title' = 'Alpha review 1'), 'Client Review',
  'the phase is the stage, not the internal status');
SELECT is((SELECT c->>'brief' FROM public.os_client_task_cards() c WHERE c->>'title' = 'Alpha brief'), 'Brief three',
  'a client sees the brief');
SELECT is((SELECT count(*)::int FROM public.os_tasks), 0, 'a client reads no task rows directly');
SELECT is((SELECT count(*)::int FROM public.os_task_client_decisions), 0, 'a client reads no decision rows directly');
SELECT is((SELECT string_agg(body, '|') FROM public.list_task_comments('a1900000-0000-4000-8000-000000000001')),
  'CP for the client', 'a client gets the client thread and never an internal comment');

-- ---------------------------------------------------------------- client A cannot edit (21-24)
UPDATE public.os_tasks SET title = 'Changed by client', due_date = '2030-01-01', status = 'complete'
 WHERE id = 'a1900000-0000-4000-8000-000000000001';
SELECT throws_ok($$INSERT INTO public.os_task_client_decisions (task_id, client_slug, decision, decided_by, decided_by_label)
                   VALUES ('a1900000-0000-4000-8000-000000000001', 'cp-alpha', 'approved', auth.uid(), 'x')$$, '42501', NULL,
  'a client cannot write a decision directly');
RESET role;
SELECT is((SELECT title || ' ' || due_date::text || ' ' || status FROM public.os_tasks WHERE id = 'a1900000-0000-4000-8000-000000000001'),
  'Alpha review 1 2026-12-01 client review', 'a client cannot change the title, due date or status');
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e1900000-0000-4000-8000-000000000003', true);
SELECT throws_ok($$SELECT public.os_client_decide('a1900000-0000-4000-8000-000000000003', 'approved', NULL)$$, 'P0409', NULL,
  'a task that is not in Client Review cannot be decided');
SELECT throws_ok($$SELECT public.os_client_decide('a1900000-0000-4000-8000-000000000005', 'approved', NULL)$$, 'P0002', NULL,
  'another client''s task is not found');

-- ---------------------------------------------------------------- approve (25-30)
SELECT is((SELECT public.os_client_decide('a1900000-0000-4000-8000-000000000001', 'approved', 'ignored note')->>'task_status'),
  'ready to transfer', 'approve moves the task to ready to transfer');
SELECT is((SELECT c->'decision'->>'decision' FROM public.os_client_task_cards() c WHERE c->>'id' = 'a1900000-0000-4000-8000-000000000001'),
  'approved', 'the client sees their own decision on the card');
SELECT is((SELECT c->>'stage' FROM public.os_client_task_cards() c WHERE c->>'id' = 'a1900000-0000-4000-8000-000000000001'),
  'Ready to Launch', 'the approved task is now in Ready to Launch');
RESET role;
SELECT is((SELECT count(*)::int FROM public.os_task_status_history
            WHERE task_id = 'a1900000-0000-4000-8000-000000000001' AND from_status = 'client review'
              AND to_status = 'ready to transfer' AND changed_by = 'e1900000-0000-4000-8000-000000000003'), 1,
  'the move is in status history, by the client');
SELECT is((SELECT count(*)::int FROM public.notifications
            WHERE user_id = 'e1900000-0000-4000-8000-000000000002' AND type = 'client_decision'
              AND task_id = 'a1900000-0000-4000-8000-000000000001'), 1,
  'the strategist is notified with a link to the task');
SELECT is((SELECT note FROM public.os_task_client_decisions WHERE task_id = 'a1900000-0000-4000-8000-000000000001'), NULL,
  'an approval keeps no note');

-- ---------------------------------------------------------------- request changes (31-36)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e1900000-0000-4000-8000-000000000003', true);
SELECT throws_ok($$SELECT public.os_client_decide('a1900000-0000-4000-8000-000000000002', 'changes_requested', '  ')$$, '22023', NULL,
  'a change request needs a note');
SELECT throws_ok($$SELECT public.os_client_decide('a1900000-0000-4000-8000-000000000002', 'maybe', NULL)$$, '22023', NULL,
  'only approved or changes_requested');
SELECT is((SELECT public.os_client_decide('a1900000-0000-4000-8000-000000000002', 'changes_requested', 'Shorter intro')->>'task_status'),
  'client revisions', 'request changes moves the task back to client revisions');
SELECT throws_ok($$SELECT public.os_client_decide('a1900000-0000-4000-8000-000000000002', 'approved', NULL)$$, 'P0409', NULL,
  'once moved out of review the task takes no more decisions');
RESET role;
SELECT is((SELECT count(*)::int FROM public.notifications
            WHERE user_id = 'e1900000-0000-4000-8000-000000000001' AND type = 'client_decision'
              AND task_id = 'a1900000-0000-4000-8000-000000000002' AND body = 'Shorter intro'), 1,
  'with no strategist, the builders are notified with the note');
SELECT is((SELECT count(*)::int FROM public.notifications
            WHERE user_id = 'e1900000-0000-4000-8000-000000000002' AND task_id = 'a1900000-0000-4000-8000-000000000002'), 0,
  'an employee who is not the strategist is not notified');

-- ---------------------------------------------------------------- the allow-list gates the field (37-38)
INSERT INTO public.os_client_visible_fields (field) VALUES ('cp_throwaway_secret');
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e1900000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.os_client_task_cards() c WHERE c->>'cp_throwaway_secret' = 'do not show'), 4,
  'once allow-listed, the field shows (so the allow-list is what hides it)');
SELECT set_config('request.jwt.claim.sub', 'e1900000-0000-4000-8000-000000000004', true);
SELECT is((SELECT count(*)::int FROM public.os_client_task_cards()), 1, 'client B gets only their own task');

SELECT * FROM finish();
ROLLBACK;
