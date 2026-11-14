-- Phase 4, PR 4: reminders for a teammate.
--
-- The Notifications page lets a builder or employee create a reminder for themselves or a
-- teammate. A reminder already has what (body), when (due_at) and where (destination); this adds
-- who: the team list member (app_users) it is for. Slack cannot @-mention a person without their
-- Slack id, which Verdanote does not hold, so the page also puts the person's name at the start of
-- the message. for_member_id keeps the list readable ("for Pat") and survives as null if the team
-- list entry is removed.
--
-- No new table and no new policy: slack_destinations and outbound_switches stay builder-write /
-- staff-read, and reminders stay staff-only, as set in 20261109000005 and 20261109000006. A
-- reminder is queued only for an active, builder-confirmed destination outside quiet hours, and
-- run-slack-jobs sends only from production with the slack_sends switch on and the Slack key set.
-- Tests: supabase/tests/reminder_recipient_test.sql.

alter table public.reminders
  add column for_member_id uuid references public.app_users(id) on delete set null;

comment on column public.reminders.for_member_id is 'Team list member this reminder is for (phase 4). Null when it is not for one person.';
