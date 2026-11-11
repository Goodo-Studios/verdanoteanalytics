-- Client approvals and change requests (migration 20261115000002, phase 5b).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Who is who (all made up):
--   client A   a client login linked to client cd-alpha (client_members)
--   client B   a client login with no links
--   client C   a second login of cd-alpha (a colleague of A)
--   employee   staff
-- Cards: cd-t-review (cd-alpha, Client Review), cd-t-edit (cd-alpha, Editing), cd-t-done (cd-alpha,
-- Ready to Launch on the board), cd-d-old (cd-alpha, delivered list), cd-t-beta (cd-beta, Client Review).
--
-- Checks: table, columns, grants and row rules; record_client_decision is refused to every browser
-- role; approve and request changes; note rules; idempotency; changing a decision only in Client Review;
-- delivered work approved once then closed; other stages refused; wrong client answers not found;
-- rate limit; one current decision per card; history rules; the unsent ClickUp write-back job and the
-- outbound switch staying off; client and staff reads; the login id stays hidden from clients.

BEGIN;
SELECT plan(48);

INSERT INTO auth.users (id, email) VALUES
  ('f1000000-0000-4000-8000-000000000002', 'cd-employee@example.test'),
  ('f1000000-0000-4000-8000-000000000003', 'cd-client-a@example.test'),
  ('f1000000-0000-4000-8000-000000000004', 'cd-client-b@example.test'),
  ('f1000000-0000-4000-8000-000000000005', 'cd-client-c@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('f1000000-0000-4000-8000-000000000002', 'employee'),
  ('f1000000-0000-4000-8000-000000000003', 'client'),
  ('f1000000-0000-4000-8000-000000000004', 'client'),
  ('f1000000-0000-4000-8000-000000000005', 'client');
INSERT INTO public.clients (slug, name, status) VALUES
  ('cd-alpha', 'CD Alpha', 'active'), ('cd-beta', 'CD Beta', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES
  ('f1000000-0000-4000-8000-000000000003', 'cd-alpha'),
  ('f1000000-0000-4000-8000-000000000005', 'cd-alpha');
INSERT INTO public.pipeline_tasks (clickup_task_id, client_slug, task_name, stage) VALUES
  ('cd-t-review', 'cd-alpha', 'November Asset 1', 'Client Review'),
  ('cd-t-edit', 'cd-alpha', 'November Asset 2', 'Editing'),
  ('cd-t-done', 'cd-alpha', 'November Asset 3', 'Ready to Launch'),
  ('cd-t-beta', 'cd-beta', 'November Asset 4', 'Client Review'),
  ('cd-t-rate', 'cd-alpha', 'November Asset 5', 'Client Review');
INSERT INTO public.pipeline_delivered (clickup_task_id, client_slug, task_name, delivered_at) VALUES
  ('cd-d-old', 'cd-alpha', 'September Asset 1', '2026-09-20');

-- ---------------------------------------------------------------- structure (1-9)
SELECT has_table('public', 'client_task_decisions', 'the decisions table exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.client_task_decisions'::regclass), 'row rules are on');
SELECT policies_are('public', 'client_task_decisions',
  ARRAY['Builder/employee can read client_task_decisions', 'Client can view own client_task_decisions'],
  'exactly the staff read rule and the client read rule');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'client_task_decisions' AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'client_task_decisions' AND grantee = 'authenticated'), 0,
  'signed-in users hold no table-level privilege (column grants only)');
SELECT is((SELECT has_column_privilege('authenticated', 'public.client_task_decisions', 'decided_by', 'SELECT')), false,
  'signed-in users cannot read decided_by');
SELECT is((SELECT has_column_privilege('authenticated', 'public.client_task_decisions', 'note', 'SELECT')), true,
  'signed-in users can read the note (their own, by row rule)');
SELECT is((SELECT has_table_privilege('authenticated', 'public.client_task_decisions', 'INSERT')), false,
  'signed-in users cannot insert');
SELECT is((SELECT has_function_privilege('authenticated', 'public.record_client_decision(uuid,text,text[],text,text,text)', 'EXECUTE')
        OR has_function_privilege('anon', 'public.record_client_decision(uuid,text,text[],text,text,text)', 'EXECUTE')), false,
  'no browser role can call record_client_decision');

-- ---------------------------------------------------------------- recording (10-27)
SELECT is((SELECT public.record_client_decision('f1000000-0000-4000-8000-000000000003', 'Alex', ARRAY['cd-alpha'], 'cd-t-review', 'approved', NULL)->>'status'),
  'recorded', 'a client approves a card in Client Review');
SELECT is((SELECT public.record_client_decision('f1000000-0000-4000-8000-000000000003', 'Alex', ARRAY['cd-alpha'], 'cd-t-review', 'approved', NULL)->>'status'),
  'unchanged', 'approving again changes nothing (idempotent)');
SELECT is((SELECT count(*)::int FROM public.client_task_decisions WHERE clickup_task_id = 'cd-t-review'), 1,
  'and adds no row');
SELECT is((SELECT public.record_client_decision('f1000000-0000-4000-8000-000000000005', 'Sam', ARRAY['cd-alpha'], 'cd-t-review', 'changes_requested', 'Please shorten the intro')->>'status'),
  'recorded', 'a colleague may change the decision while the card is in Client Review');
SELECT is((SELECT count(*)::int FROM public.client_task_decisions WHERE clickup_task_id = 'cd-t-review'), 2, 'the earlier decision stays as history');
SELECT is((SELECT count(*)::int FROM public.client_task_decisions WHERE clickup_task_id = 'cd-t-review' AND superseded_at IS NULL), 1,
  'exactly one decision is current');
SELECT is((SELECT decision FROM public.client_task_decisions WHERE clickup_task_id = 'cd-t-review' AND superseded_at IS NULL), 'changes_requested',
  'the newest one is current');
SELECT is((SELECT public.record_client_decision('f1000000-0000-4000-8000-000000000005', 'Sam', ARRAY['cd-alpha'], 'cd-t-review', 'changes_requested', '  Please shorten the intro ')->>'status'),
  'unchanged', 'the same request with the same note (spaces trimmed) changes nothing');
SELECT throws_ok($$SELECT public.record_client_decision('f1000000-0000-4000-8000-000000000003', 'Alex', ARRAY['cd-alpha'], 'cd-t-rate', 'changes_requested', NULL)$$,
  '22023', NULL, 'changes without a note are refused');
SELECT throws_ok($$SELECT public.record_client_decision('f1000000-0000-4000-8000-000000000003', 'Alex', ARRAY['cd-alpha'], 'cd-t-rate', 'changes_requested', '   ')$$,
  '22023', NULL, 'changes with a blank note are refused');
SELECT throws_ok($$SELECT public.record_client_decision('f1000000-0000-4000-8000-000000000003', 'Alex', ARRAY['cd-alpha'], 'cd-t-rate', 'changes_requested', repeat('x', 1001))$$,
  '22023', NULL, 'a note over 1000 characters is refused');
SELECT throws_ok($$SELECT public.record_client_decision('f1000000-0000-4000-8000-000000000003', 'Alex', ARRAY['cd-alpha'], 'cd-t-rate', 'maybe', NULL)$$,
  '22023', NULL, 'an unknown decision is refused');
SELECT throws_ok($$SELECT public.record_client_decision('f1000000-0000-4000-8000-000000000003', 'Alex', ARRAY['cd-alpha'], 'cd-t-beta', 'approved', NULL)$$,
  'P0002', NULL, 'another client''s card answers not found');
SELECT throws_ok($$SELECT public.record_client_decision('f1000000-0000-4000-8000-000000000004', 'Bea', ARRAY[]::text[], 'cd-t-review', 'approved', NULL)$$,
  'P0002', NULL, 'a login with no clients gets not found');
SELECT throws_ok($$SELECT public.record_client_decision('f1000000-0000-4000-8000-000000000003', 'Alex', ARRAY['cd-alpha'], 'cd-no-such', 'approved', NULL)$$,
  'P0002', NULL, 'a card that does not exist answers not found');
SELECT throws_ok($$SELECT public.record_client_decision('f1000000-0000-4000-8000-000000000003', 'Alex', ARRAY['cd-alpha'], 'cd-t-edit', 'approved', NULL)$$,
  'P0409', NULL, 'a card still in Editing is not open for a decision');
SELECT is((SELECT count(*)::int FROM public.client_task_decisions WHERE clickup_task_id IN ('cd-t-edit', 'cd-t-beta', 'cd-t-rate')), 0,
  'the refused calls recorded nothing');

-- ---------------------------------------------------------------- delivered work (28-31)
SELECT is((SELECT public.record_client_decision('f1000000-0000-4000-8000-000000000003', 'Alex', ARRAY['cd-alpha'], 'cd-t-done', 'approved', NULL)->>'status'),
  'recorded', 'delivered work with no decision can be approved');
SELECT throws_ok($$SELECT public.record_client_decision('f1000000-0000-4000-8000-000000000003', 'Alex', ARRAY['cd-alpha'], 'cd-t-done', 'changes_requested', 'Too late')$$,
  'P0409', NULL, 'a delivered, decided item cannot be changed');
SELECT throws_ok($$SELECT public.record_client_decision('f1000000-0000-4000-8000-000000000003', 'Alex', ARRAY['cd-alpha'], 'cd-d-old', 'changes_requested', 'Too late')$$,
  'P0409', NULL, 'delivered work takes no change request');
SELECT is((SELECT public.record_client_decision('f1000000-0000-4000-8000-000000000003', 'Alex', ARRAY['cd-alpha'], 'cd-d-old', 'approved', NULL)->>'status'),
  'recorded', 'delivered work from an earlier cycle can be approved');

-- A decided card that moved on (ClickUp sent it back to editing) is closed.
UPDATE public.pipeline_tasks SET stage = 'Editing' WHERE clickup_task_id = 'cd-t-review';
SELECT throws_ok($$SELECT public.record_client_decision('f1000000-0000-4000-8000-000000000003', 'Alex', ARRAY['cd-alpha'], 'cd-t-review', 'approved', NULL)$$,
  'P0409', NULL, 'once the card has left Client Review the decision can no longer be changed');
UPDATE public.pipeline_tasks SET stage = 'Client Review' WHERE clickup_task_id = 'cd-t-review';

-- ---------------------------------------------------------------- rate limit (32-33)
SELECT lives_ok($$
  SELECT public.record_client_decision('f1000000-0000-4000-8000-000000000003', 'Alex', ARRAY['cd-alpha'], 'cd-t-rate', 'changes_requested', 'one');
  SELECT public.record_client_decision('f1000000-0000-4000-8000-000000000003', 'Alex', ARRAY['cd-alpha'], 'cd-t-rate', 'approved', NULL);
  SELECT public.record_client_decision('f1000000-0000-4000-8000-000000000003', 'Alex', ARRAY['cd-alpha'], 'cd-t-rate', 'changes_requested', 'two');
  SELECT public.record_client_decision('f1000000-0000-4000-8000-000000000003', 'Alex', ARRAY['cd-alpha'], 'cd-t-rate', 'approved', NULL);
  SELECT public.record_client_decision('f1000000-0000-4000-8000-000000000003', 'Alex', ARRAY['cd-alpha'], 'cd-t-rate', 'changes_requested', 'three');
$$, 'five quick decisions on one card go through');
SELECT throws_ok($$SELECT public.record_client_decision('f1000000-0000-4000-8000-000000000003', 'Alex', ARRAY['cd-alpha'], 'cd-t-rate', 'approved', NULL)$$,
  'P0429', NULL, 'the sixth within 10 minutes is refused');

-- ---------------------------------------------------------------- write-back job, unsent (34-37)
SELECT is((SELECT count(*)::int FROM public.durable_jobs WHERE kind = 'clickup.decision_writeback' AND client_slug = 'cd-alpha'
            AND payload->>'clickup_task_id' = 'cd-t-review'), 2,
  'each decision on a card has its own write-back job');
SELECT is((SELECT count(*)::int FROM public.durable_jobs WHERE kind = 'clickup.decision_writeback' AND state = 'queued'
            AND payload->>'clickup_task_id' = 'cd-t-review'), 1,
  'the superseded decision''s job was canceled, the current one stays queued');
SELECT is((SELECT count(*)::int FROM public.durable_jobs WHERE kind = 'clickup.decision_writeback' AND state NOT IN ('queued', 'canceled')), 0,
  'no write-back job is claimed, sent or delivered');
SELECT is((SELECT count(*)::int FROM public.outbound_switches WHERE name = 'clickup_writeback' AND enabled), 0,
  'the ClickUp write-back switch is off (no enabled row)');

-- ---------------------------------------------------------------- history rules (38-40)
SELECT throws_ok($$UPDATE public.client_task_decisions SET note = 'edited' WHERE clickup_task_id = 'cd-t-done'$$,
  '23514', NULL, 'a decision cannot be edited');
SELECT throws_ok($$DELETE FROM public.client_task_decisions WHERE clickup_task_id = 'cd-t-done'$$,
  '23514', NULL, 'a decision cannot be deleted');
SELECT throws_ok($$INSERT INTO public.client_task_decisions (clickup_task_id, client_slug, decision, note, decided_by, decided_by_label)
                    VALUES ('cd-t-review', 'cd-alpha', 'approved', NULL, 'f1000000-0000-4000-8000-000000000003', 'Alex')$$,
  '23505', NULL, 'a second current decision on one card is refused by the database');

-- ---------------------------------------------------------------- client A reads (41-44)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.client_task_decisions WHERE clickup_task_id = 'cd-t-review'), 2,
  'client A reads the whole history of its own card');
SELECT is((SELECT count(*)::int FROM public.client_task_decisions WHERE client_slug = 'cd-beta'), 0,
  'client A reads no decision of another client');
SELECT throws_ok($$SELECT decided_by FROM public.client_task_decisions$$, '42501', NULL, 'client A cannot read decided_by');
SELECT throws_ok($$INSERT INTO public.client_task_decisions (clickup_task_id, client_slug, decision, decided_by, decided_by_label)
                    VALUES ('cd-t-edit', 'cd-alpha', 'approved', 'f1000000-0000-4000-8000-000000000003', 'Alex')$$,
  '42501', NULL, 'client A cannot write a decision directly');

-- ---------------------------------------------------------------- client B and staff (45-48)
SELECT set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000004', true);
SELECT is((SELECT count(*)::int FROM public.client_task_decisions), 0, 'client B reads no decisions');
SELECT set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000002', true);
SELECT ok((SELECT count(*) FROM public.client_task_decisions WHERE decided_by_label IN ('Alex', 'Sam')) >= 4, 'employee reads every client''s decisions');
SELECT throws_ok($$SELECT decided_by FROM public.client_task_decisions$$, '42501', NULL, 'the login id is for the service role only, even for staff');
SELECT throws_ok($$UPDATE public.client_task_decisions SET note = 'x'$$, '42501', NULL, 'staff cannot change decisions from the browser');
RESET role;

SELECT * FROM finish();
ROLLBACK;
