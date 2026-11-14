-- Goodo OS time tracking (migration 20261123080001, story OS-011).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: row rules on and no grants for anon; end after start; the 24-hour cap (and that
-- stopping a long timer and copied rows are exempt); no overlaps per person, with a running
-- timer open-ended and touching ranges allowed; one running timer per person; archived
-- projects; an employee sees and writes only their own time; a builder sees and manages
-- everyone's; a client and a login with no role see nothing; an entry is on at most one
-- invoice and only its own person's; a sent invoice locks its time, fields and lines until a
-- builder reopens it; only a builder marks paid; only drafts are deleted; time_link_people()
-- links people to logins by email. All rows are made up.
--
-- Since OS-012 an app-made entry needs a task, or a client or Internal with a category, so the
-- entries made here are Internal time in the category Other. The rules checked are unchanged.

BEGIN;
SELECT plan(40);

INSERT INTO auth.users (id, email) VALUES
  ('e8100000-0000-4000-8000-000000000001', 'tt-builder@example.test'),
  ('e8100000-0000-4000-8000-000000000002', 'tt-alice@example.test'),
  ('e8100000-0000-4000-8000-000000000003', 'tt-bob@example.test'),
  ('e8100000-0000-4000-8000-000000000004', 'tt-client@example.test'),
  ('e8100000-0000-4000-8000-000000000005', 'tt-nobody@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e8100000-0000-4000-8000-000000000001', 'builder'),
  ('e8100000-0000-4000-8000-000000000002', 'employee'),
  ('e8100000-0000-4000-8000-000000000003', 'employee'),
  ('e8100000-0000-4000-8000-000000000004', 'client');

-- People. Carol has no app login: her time is kept and counted, user_id stays null.
INSERT INTO public.time_people (id, email, name, user_id, source_role) VALUES
  ('e8200000-0000-4000-8000-000000000001', 'tt-builder@example.test', 'Builder', 'e8100000-0000-4000-8000-000000000001', 'admin'),
  ('e8200000-0000-4000-8000-000000000002', 'tt-alice@example.test', 'Alice', NULL, 'member'),
  ('e8200000-0000-4000-8000-000000000003', 'tt-bob@example.test', 'Bob', 'e8100000-0000-4000-8000-000000000003', 'member'),
  ('e8200000-0000-4000-8000-000000000004', 'tt-carol@example.test', 'Carol', NULL, 'member');
INSERT INTO public.time_clients (id, name) VALUES ('e8300000-0000-4000-8000-000000000001', 'TT Bearaby');
INSERT INTO public.time_projects (id, client_id, name, archived) VALUES
  ('e8400000-0000-4000-8000-000000000001', 'e8300000-0000-4000-8000-000000000001', 'Brand film', false),
  ('e8400000-0000-4000-8000-000000000002', NULL, 'Old reels', true);
INSERT INTO public.time_entries (is_internal, category, person_id, description, start_at, end_at) VALUES
  (true, 'Other', 'e8200000-0000-4000-8000-000000000003', 'Bob cut', '2026-10-30 13:00Z', '2026-10-30 14:00Z'),
  (true, 'Other', 'e8200000-0000-4000-8000-000000000004', 'Carol cut', '2026-10-30 13:00Z', '2026-10-30 14:00Z');

-- ---------------------------------------------------------------- structure
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN (
  'public.time_people'::regclass, 'public.time_clients'::regclass, 'public.time_projects'::regclass,
  'public.time_entries'::regclass, 'public.time_invoices'::regclass, 'public.time_invoice_lines'::regclass)),
  'row rules are on for the six time tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name LIKE 'time\_%' AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on the time tables');
SELECT ok(NOT has_function_privilege('authenticated', 'public.time_link_people()', 'EXECUTE'),
  'signed-in users cannot call time_link_people');
SELECT ok(NOT has_function_privilege('authenticated', 'public.time_entries_guard()', 'EXECUTE'),
  'the entry rule trigger function is not callable');

-- ---------------------------------------------------------------- linking by email
SELECT is(public.time_link_people(), 1, 'time_link_people links the one person whose email has a login');
SELECT is((SELECT user_id::text FROM public.time_people WHERE email = 'tt-alice@example.test'),
  'e8100000-0000-4000-8000-000000000002', 'Alice is linked to her login by email');

-- ---------------------------------------------------------------- Alice (employee) writes her own time
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e8100000-0000-4000-8000-000000000002', true);

SELECT lives_ok($$INSERT INTO public.time_entries (is_internal, category, person_id, project_id, description, start_at, end_at)
  VALUES (true, 'Other', 'e8200000-0000-4000-8000-000000000002', 'e8400000-0000-4000-8000-000000000001', 'Rough cut',
          '2026-10-30 10:00Z', '2026-10-30 11:00Z')$$, 'an employee adds her own entry');
SELECT lives_ok($$INSERT INTO public.time_entries (is_internal, category, person_id, description, start_at, end_at)
  VALUES (true, 'Other', 'e8200000-0000-4000-8000-000000000002', 'Notes', '2026-10-30 11:00Z', '2026-10-30 12:00Z')$$,
  'an entry may start exactly when the last one ends');
SELECT throws_ok($$INSERT INTO public.time_entries (is_internal, category, person_id, start_at, end_at)
  VALUES (true, 'Other', 'e8200000-0000-4000-8000-000000000002', '2026-10-30 10:30Z', '2026-10-30 10:45Z')$$, '23P01', NULL,
  'an entry that overlaps another is refused');
SELECT throws_ok($$INSERT INTO public.time_entries (is_internal, category, person_id, start_at, end_at)
  VALUES (true, 'Other', 'e8200000-0000-4000-8000-000000000002', '2026-10-30 15:00Z', '2026-10-30 15:00Z')$$, '23514', NULL,
  'an entry must end after it starts');
SELECT throws_ok($$INSERT INTO public.time_entries (is_internal, category, person_id, start_at, end_at)
  VALUES (true, 'Other', 'e8200000-0000-4000-8000-000000000002', '2026-10-20 00:00Z', '2026-10-21 00:00:01Z')$$, '23514', NULL,
  'a typed-in entry longer than 24 hours is refused');
SELECT lives_ok($$INSERT INTO public.time_entries (is_internal, category, person_id, start_at, end_at)
  VALUES (true, 'Other', 'e8200000-0000-4000-8000-000000000002', '2026-10-20 00:00Z', '2026-10-21 00:00Z')$$,
  'an entry of exactly 24 hours is allowed');
SELECT throws_ok($$INSERT INTO public.time_entries (is_internal, category, person_id, project_id, start_at, end_at)
  VALUES (true, 'Other', 'e8200000-0000-4000-8000-000000000002', 'e8400000-0000-4000-8000-000000000002', '2026-10-22 10:00Z', '2026-10-22 11:00Z')$$,
  '23514', NULL, 'a new entry cannot use an archived project');

-- A running timer is open-ended.
SELECT lives_ok($$INSERT INTO public.time_entries (is_internal, category, person_id, description, start_at)
  VALUES (true, 'Other', 'e8200000-0000-4000-8000-000000000002', 'Running', '2026-10-31 09:00Z')$$, 'an employee starts a timer');
SELECT throws_ok($$INSERT INTO public.time_entries (is_internal, category, person_id, start_at, end_at)
  VALUES (true, 'Other', 'e8200000-0000-4000-8000-000000000002', '2026-11-05 09:00Z', '2026-11-05 10:00Z')$$, '23P01', NULL,
  'an entry after a running timer''s start overlaps it');
-- A second open-ended timer always overlaps the first, so either rule may report it.
SELECT throws_ok($$INSERT INTO public.time_entries (is_internal, category, person_id, start_at)
  VALUES (true, 'Other', 'e8200000-0000-4000-8000-000000000002', '2026-10-29 09:00Z')$$, NULL, NULL,
  'a second running timer is refused');
SELECT ok((SELECT indisunique FROM pg_index WHERE indexrelid = 'public.time_entries_one_running'::regclass),
  'one running timer per person is also a unique rule of its own');
SELECT lives_ok($$UPDATE public.time_entries SET end_at = '2026-11-02 09:00Z' WHERE description = 'Running'$$,
  'stopping a timer never fails on length');

SELECT is((SELECT count(*)::int FROM public.time_entries), 4, 'an employee sees only her own entries');
SELECT is((SELECT count(*)::int FROM public.time_people), 1, 'an employee sees only her own person row');
SELECT throws_ok($$INSERT INTO public.time_entries (is_internal, category, person_id, start_at, end_at)
  VALUES (true, 'Other', 'e8200000-0000-4000-8000-000000000003', '2026-10-25 10:00Z', '2026-10-25 11:00Z')$$, '42501', NULL,
  'an employee cannot add time for someone else');
UPDATE public.time_entries SET description = 'changed by Alice' WHERE description = 'Bob cut';
UPDATE public.time_people SET monthly_fee_cents = 1 WHERE email = 'tt-alice@example.test';

-- ---------------------------------------------------------------- Bob, client, no role
SELECT set_config('request.jwt.claim.sub', 'e8100000-0000-4000-8000-000000000003', true);
SELECT is((SELECT string_agg(description, ',') FROM public.time_entries), 'Bob cut',
  'another employee sees only his own entry, unchanged by Alice');
SELECT set_config('request.jwt.claim.sub', 'e8100000-0000-4000-8000-000000000004', true);
SELECT is((SELECT count(*)::int FROM public.time_entries) + (SELECT count(*)::int FROM public.time_people)
        + (SELECT count(*)::int FROM public.time_projects) + (SELECT count(*)::int FROM public.time_clients), 0,
  'a client sees no time, people, projects or clients');
SELECT throws_ok($$INSERT INTO public.time_entries (is_internal, category, person_id, start_at, end_at)
  VALUES (true, 'Other', 'e8200000-0000-4000-8000-000000000004', '2026-10-25 10:00Z', '2026-10-25 11:00Z')$$, '42501', NULL,
  'a client cannot add time');
SELECT set_config('request.jwt.claim.sub', 'e8100000-0000-4000-8000-000000000005', true);
SELECT is((SELECT count(*)::int FROM public.time_entries), 0, 'a login with no role sees no time');

-- ---------------------------------------------------------------- builder sees and manages all
SELECT set_config('request.jwt.claim.sub', 'e8100000-0000-4000-8000-000000000001', true);
SELECT is((SELECT count(*)::int FROM public.time_entries), 6, 'a builder sees everyone''s entries, including unlinked people''s');
SELECT is((SELECT monthly_fee_cents FROM public.time_people WHERE email = 'tt-alice@example.test'), NULL,
  'an employee cannot set her own fee');
SELECT lives_ok($$UPDATE public.time_people SET monthly_fee_cents = 500000 WHERE email = 'tt-alice@example.test'$$,
  'a builder sets a monthly fee');

-- ---------------------------------------------------------------- invoices
SELECT set_config('request.jwt.claim.sub', 'e8100000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$INSERT INTO public.time_invoices (person_id, number, period_from, period_to, issued_on)
  VALUES ('e8200000-0000-4000-8000-000000000002', 1, '2026-10-01', '2026-10-31', '2026-11-01')$$, '23514', NULL,
  'an invoice must cover a half-month');
INSERT INTO public.time_invoices (id, person_id, number, period_from, period_to, issued_on) VALUES
  ('e8500000-0000-4000-8000-000000000001', 'e8200000-0000-4000-8000-000000000002', 1, '2026-10-16', '2026-10-31', '2026-11-01');
INSERT INTO public.time_invoice_lines (invoice_id, kind, description, amount_cents)
  VALUES ('e8500000-0000-4000-8000-000000000001', 'fee', 'Monthly fee, second half (16 to 31 Oct 2026)', 250000);
UPDATE public.time_entries SET invoice_id = 'e8500000-0000-4000-8000-000000000001'
 WHERE description IN ('Rough cut', 'Notes');
SELECT throws_ok($$INSERT INTO public.time_entries (is_internal, category, person_id, start_at, invoice_id)
  VALUES (true, 'Other', 'e8200000-0000-4000-8000-000000000002', '2026-11-03 09:00Z', 'e8500000-0000-4000-8000-000000000001')$$,
  '23514', NULL, 'a running timer cannot be put on an invoice');
RESET role;
SELECT throws_ok($$UPDATE public.time_entries SET invoice_id = 'e8500000-0000-4000-8000-000000000001'
  WHERE description = 'Bob cut'$$, '23503', NULL, 'another person''s time cannot go on the invoice');
SET LOCAL role authenticated;

UPDATE public.time_invoices SET status = 'submitted', submitted_at = now() WHERE id = 'e8500000-0000-4000-8000-000000000001';
SELECT throws_ok($$UPDATE public.time_entries SET description = 'edited' WHERE description = 'Rough cut'$$, '42501', NULL,
  'time on a sent invoice cannot be edited');
SELECT throws_ok($$DELETE FROM public.time_entries WHERE description = 'Notes'$$, '42501', NULL,
  'time on a sent invoice cannot be deleted');
SELECT throws_ok($$INSERT INTO public.time_invoice_lines (invoice_id, kind, description, amount_cents)
  VALUES ('e8500000-0000-4000-8000-000000000001', 'fixed', 'Stock music', 4599)$$, '42501', NULL,
  'a sent invoice''s lines cannot change');
SELECT throws_ok($$UPDATE public.time_invoices SET notes = 'late change' WHERE number = 1$$, '42501', NULL,
  'a sent invoice''s fields cannot change');
SELECT throws_ok($$UPDATE public.time_invoices SET status = 'paid' WHERE number = 1$$, '42501', NULL,
  'an employee cannot mark her invoice paid');
SELECT throws_ok($$DELETE FROM public.time_invoices WHERE number = 1$$, '42501', NULL,
  'a sent invoice cannot be deleted');

SELECT set_config('request.jwt.claim.sub', 'e8100000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$UPDATE public.time_invoices SET status = 'draft', submitted_at = NULL
  WHERE id = 'e8500000-0000-4000-8000-000000000001'$$, 'a builder reopens a sent invoice');
SELECT set_config('request.jwt.claim.sub', 'e8100000-0000-4000-8000-000000000002', true);
SELECT lives_ok($$UPDATE public.time_entries SET description = 'Rough cut v2' WHERE description = 'Rough cut'$$,
  'once reopened, its time can be edited again');
DELETE FROM public.time_invoices WHERE id = 'e8500000-0000-4000-8000-000000000001';
SELECT is((SELECT count(*)::int FROM public.time_entries WHERE invoice_id IS NOT NULL), 0,
  'deleting a draft frees its time for another invoice');

SELECT * FROM finish();
ROLLBACK;
