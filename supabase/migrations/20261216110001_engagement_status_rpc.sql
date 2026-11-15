-- Engagement status changes through a checked function (audit finding: closing or
-- cancelling an engagement was a direct client-side UPDATE on public.engagements, guarded
-- only by the table policy).
--
-- Adds public.set_engagement_status(p_engagement_id, p_status, p_reason). It
--   * refuses anyone who is not builder or employee (same gate as the other engagement
--     functions in migration 20261110120001),
--   * locks the row (FOR UPDATE) and checks the move against the allow-list below,
--   * writes the status, the closed_at / cancelled_at stamp, the reason and who did it,
--   * returns the updated row.
--
-- Allowed moves (anything else raises 22023):
--     planned -> cancelled      a cycle that never kicked off
--     active  -> closed         a cycle that ran
--   closed and cancelled are final: nothing reopens them (the app has no reopen path).
--   planned -> active stays with record_engagement_kickoff, which also records the start
--   date, so 'planned' and 'active' are not accepted as targets here.
--
-- No audit or activity table exists for engagements, so none is invented. The row itself
-- carries the trail: closed_at, cancelled_at, status_reason, status_changed_by (new,
-- nullable; rows closed or cancelled before this migration keep them null).
--
-- Direct writes: the UPDATE policy cannot limit columns, and the staff area still updates
-- other engagement columns through the table, so the policy and grants stay as they are.
-- A BEFORE UPDATE trigger instead refuses a status change that arrives as the signed-in
-- user (current_user is authenticated). Inside a SECURITY DEFINER function current_user is
-- the function owner, so set_engagement_status and record_engagement_kickoff pass, and so
-- does the service role (edge functions, admin repairs).
--
-- Tests: supabase/tests/engagement_status_rpc_test.sql.

alter table public.engagements
  add column if not exists closed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists status_reason text,
  add column if not exists status_changed_by uuid;

alter table public.engagements
  add constraint engagements_status_reason_length
  check (status_reason is null or char_length(status_reason) between 1 and 2000);

comment on column public.engagements.closed_at is 'When set_engagement_status closed the engagement. Null for rows closed before the function existed.';
comment on column public.engagements.cancelled_at is 'When set_engagement_status cancelled the engagement. Null for rows cancelled before the function existed.';
comment on column public.engagements.status_reason is 'Optional reason given when the engagement was closed or cancelled.';
comment on column public.engagements.status_changed_by is 'auth.uid() of the staff member who closed or cancelled the engagement.';

-- ------------------------------------------------------------------ direct write guard

create or replace function public.guard_engagement_status_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.status is distinct from old.status
          or new.closed_at is distinct from old.closed_at
          or new.cancelled_at is distinct from old.cancelled_at
          or new.status_reason is distinct from old.status_reason
          or new.status_changed_by is distinct from old.status_changed_by) then
    raise exception 'engagement status changes go through set_engagement_status' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_engagement_status_writes() from public, anon;
create trigger engagements_status_via_rpc_only before update on public.engagements
  for each row execute function public.guard_engagement_status_writes();

-- ------------------------------------------------------------------ the function

create or replace function public.set_engagement_status(
  p_engagement_id uuid,
  p_status text,
  p_reason text default null
)
returns public.engagements
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_engagement public.engagements;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can change an engagement status' using errcode = 'insufficient_privilege';
  end if;
  if p_status is null or p_status not in ('closed', 'cancelled') then
    raise exception 'an engagement can only be set to closed or cancelled here' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 2000 then
    raise exception 'the reason is 1 to 2000 characters' using errcode = '22023';
  end if;

  select * into v_engagement from public.engagements where id = p_engagement_id for update;
  if not found then
    raise exception 'engagement not found' using errcode = 'P0002';
  end if;

  if not ((v_engagement.status = 'planned' and p_status = 'cancelled')
          or (v_engagement.status = 'active' and p_status = 'closed')) then
    raise exception 'an engagement cannot move from % to %', v_engagement.status, p_status using errcode = '22023';
  end if;

  update public.engagements
     set status = p_status,
         closed_at = case when p_status = 'closed' then now() end,
         cancelled_at = case when p_status = 'cancelled' then now() end,
         status_reason = v_reason,
         status_changed_by = v_uid
   where id = p_engagement_id
  returning * into v_engagement;
  return v_engagement;
end;
$$;

revoke all on function public.set_engagement_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_engagement_status(uuid, text, text) to authenticated, service_role;
