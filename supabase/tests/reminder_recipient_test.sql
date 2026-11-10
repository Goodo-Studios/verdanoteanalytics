-- Reminders for a teammate, and the Notifications page's writes (migration 20261112000004,
-- phase 4 PR 4).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Fixtures, all made up: b builder, e employee, c client login, member m on the team list, and
-- one internal Slack destination that no builder has confirmed.
--
-- Checks: the new column; a client reads no reminder, destination or switch and cannot write a
-- reminder; an employee creates and reads a reminder for a teammate but cannot add a destination
-- or a switch; a builder adds a destination and turns the send switch on and off; removing the team
-- list entry keeps the reminder; a reminder for an unconfirmed destination is not queued, and is
-- once a builder confirms the destination. Nothing here sends: queuing only creates a job row.

BEGIN;
SELECT plan(14);

INSERT INTO auth.users (id, email) VALUES
  ('4e000000-0000-4000-8000-000000000001', 'rr-b@example.test'),
  ('4e000000-0000-4000-8000-000000000002', 'rr-e@example.test'),
  ('4e000000-0000-4000-8000-000000000003', 'rr-c@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('4e000000-0000-4000-8000-000000000001', 'builder'),
  ('4e000000-0000-4000-8000-000000000002', 'employee'),
  ('4e000000-0000-4000-8000-000000000003', 'client');
INSERT INTO public.app_users (id, name, email, role, active) VALUES
  ('4e100000-0000-4000-8000-000000000001', 'Maya Member', 'rr-m@example.test', 'producer', true);
INSERT INTO public.slack_destinations (id, label, channel_id, purpose, owner_confirmed, active) VALUES
  ('4e200000-0000-4000-8000-000000000001', 'team-reminders', 'C0RRTEAM01', 'internal', false, true);

SELECT col_type_is('public', 'reminders', 'for_member_id', 'uuid', 'a reminder can name the team list member it is for');

-- ---------------------------------------------------------------- client (2-4)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', '4e000000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.reminders) + (SELECT count(*)::int FROM public.slack_destinations)
          + (SELECT count(*)::int FROM public.outbound_switches), 0, 'a client reads no reminder, Slack destination or switch');
SELECT throws_ok($$INSERT INTO public.reminders (kind, destination_id, body, due_at) VALUES ('custom', '4e200000-0000-4000-8000-000000000001', 'x', now())$$,
  '42501', NULL, 'a client cannot create a reminder');
SELECT throws_ok($$INSERT INTO public.outbound_switches (name, enabled) VALUES ('slack_sends', true)$$, '42501', NULL, 'a client cannot turn sending on');

-- ---------------------------------------------------------------- employee (5-8)
SELECT set_config('request.jwt.claim.sub', '4e000000-0000-4000-8000-000000000002', true);
SELECT lives_ok($$INSERT INTO public.reminders (id, kind, destination_id, body, due_at, for_member_id)
                  VALUES ('4e300000-0000-4000-8000-000000000001', 'custom', '4e200000-0000-4000-8000-000000000001',
                          'Reminder for Maya Member: send the call sheet', now() - interval '1 minute', '4e100000-0000-4000-8000-000000000001')$$,
  'an employee creates a reminder for a teammate');
SELECT is((SELECT for_member_id::text || ':' || state FROM public.reminders WHERE id = '4e300000-0000-4000-8000-000000000001'),
  '4e100000-0000-4000-8000-000000000001:scheduled', 'an employee reads it back, scheduled');
SELECT throws_ok($$INSERT INTO public.slack_destinations (label, channel_id, purpose) VALUES ('mine', 'C0RREMP001', 'internal')$$, '42501', NULL, 'an employee cannot add a Slack destination');
SELECT throws_ok($$INSERT INTO public.outbound_switches (name, enabled) VALUES ('slack_sends', true)$$, '42501', NULL, 'an employee cannot turn sending on');

-- ---------------------------------------------------------------- builder (9-11)
SELECT set_config('request.jwt.claim.sub', '4e000000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$INSERT INTO public.slack_destinations (label, channel_id, purpose) VALUES ('owner-alerts', 'C0RROWN001', 'owner_alerts')$$, 'a builder adds a Slack destination, unconfirmed by default');
SELECT lives_ok($$INSERT INTO public.outbound_switches (name, enabled, note) VALUES ('slack_sends', false, 'off until the owner says so')$$, 'a builder adds the send switch, off');
SELECT lives_ok($$UPDATE public.outbound_switches SET enabled = true WHERE name = 'slack_sends'$$, 'a builder turns sending on');

-- ---------------------------------------------------------------- queueing (12-14)
RESET role;
SELECT is(public.enqueue_due_reminders(), 0, 'a reminder for a destination no builder confirmed is not queued');
UPDATE public.slack_destinations SET owner_confirmed = true WHERE id = '4e200000-0000-4000-8000-000000000001';
SELECT is(public.enqueue_due_reminders(), 1, 'once a builder confirms the destination the due reminder is queued');
DELETE FROM public.app_users WHERE id = '4e100000-0000-4000-8000-000000000001';
SELECT is((SELECT for_member_id IS NULL FROM public.reminders WHERE id = '4e300000-0000-4000-8000-000000000001'), true,
  'removing the team list entry keeps the reminder and clears who it is for');

SELECT * FROM finish();
ROLLBACK;
