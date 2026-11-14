-- Goodo OS wave D: alerts (consolidation step 4d). Port of the alert parts of Goodo OS
-- migration 006_operations.sql and backend/monitoring/alerts.ts (US-017): expected exceptions
-- and false-positive acknowledgements that keep a known problem from alerting the owner.
--
--   alert_exceptions   a staff member's note that one integration health problem is expected
--                      or a false positive, for at most 24 hours: the connector, the problem
--                      code, the kind (idle testing, paused engagement, reconnect warm-up,
--                      false positive), a reason and when it ends. Immutable; it simply
--                      expires.
--
-- Merged with what exists: the Integration health page and function (step 4a) evaluate on read
-- and now leave out problems covered by an active exception. A builder's "check and alert"
-- turns the remaining problems into owner alerts through the step 3 path (enqueue_owner_alert,
-- one per problem per day); that call is made only from the production project, and
-- run-slack-jobs sends only from production with the slack_sends switch on, so staging never
-- alerts anyone. Owner alert jobs show on the Operations and Integration health pages.
--
-- Rules ported from Goodo OS: an exception lasts more than zero and at most 24 hours; idle
-- testing and paused engagement apply only to a stale connector; reconnect warm-up only to a
-- connector that has never synced; a false positive applies to any problem. Not ported: the
-- stored evaluations, incidents and incident scopes (Verdanote evaluates on read), command
-- receipts, per-engagement source scopes and capability grants (any builder or employee may
-- record an exception).
--
-- Staff read; clients read nothing. Writes go only through record_alert_exception
-- (SECURITY DEFINER, staff tested in its body). Tests: supabase/tests/alert_exceptions_test.sql.

create table public.alert_exceptions (
  id uuid primary key default gen_random_uuid(),
  connector text not null check (connector in ('clickup', 'fireflies', 'slack', 'verdanote_data', 'queue')),
  pattern text not null check (pattern ~ '^[a-z_]+\.[a-z_]+$'),
  kind text not null check (kind in ('idle_testing', 'paused_engagement', 'reconnect_warmup', 'false_positive')),
  reason text not null check (length(btrim(reason)) between 1 and 500),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  check (expires_at > starts_at and expires_at <= starts_at + interval '24 hours'),
  check (kind = 'false_positive'
         or (kind in ('idle_testing', 'paused_engagement') and pattern = 'connector.stale')
         or (kind = 'reconnect_warmup' and pattern = 'connector.unconfirmed'))
);
create index alert_exceptions_active_idx on public.alert_exceptions (expires_at desc);

comment on table public.alert_exceptions is 'Expected exceptions and false positives that keep an integration health problem from alerting the owner for up to 24 hours (port of Goodo OS baseline_exceptions). Staff only. Immutable.';

create or replace function public.prevent_alert_exception_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'alert exceptions are immutable; they expire on their own' using errcode = '23514';
end;
$$;
revoke all on function public.prevent_alert_exception_rewrite() from public, anon, authenticated;

create trigger alert_exceptions_immutable before update or delete on public.alert_exceptions
  for each row execute function public.prevent_alert_exception_rewrite();
create trigger alert_exceptions_no_truncate before truncate on public.alert_exceptions
  for each statement execute function public.prevent_alert_exception_rewrite();

alter table public.alert_exceptions enable row level security;
revoke all on table public.alert_exceptions from public, anon, authenticated;
grant select on table public.alert_exceptions to authenticated;
grant all on table public.alert_exceptions to service_role;

create policy "Builder/employee can read alert_exceptions" on public.alert_exceptions
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

-- Builder or employee: record an expected exception or a false positive for one problem, for
-- 1 to 24 hours from now. Returns the id.
create or replace function public.record_alert_exception(
  p_connector text,
  p_pattern text,
  p_kind text,
  p_reason text,
  p_hours integer
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can record an alert exception' using errcode = 'insufficient_privilege';
  end if;
  if p_connector is null or p_connector not in ('clickup', 'fireflies', 'slack', 'verdanote_data', 'queue')
     or p_pattern is null or p_pattern !~ '^[a-z_]+\.[a-z_]+$'
     or p_kind is null or p_kind not in ('idle_testing', 'paused_engagement', 'reconnect_warmup', 'false_positive')
     or p_reason is null or length(btrim(p_reason)) not between 1 and 500
     or p_hours is null or p_hours not between 1 and 24 then
    raise exception 'check the exception fields: hours are 1 to 24' using errcode = '22023';
  end if;
  if (p_kind in ('idle_testing', 'paused_engagement') and p_pattern <> 'connector.stale')
     or (p_kind = 'reconnect_warmup' and p_pattern <> 'connector.unconfirmed') then
    raise exception 'idle testing and paused engagement cover a stale connector; reconnect warm-up covers a connector that never synced'
      using errcode = '22023';
  end if;
  insert into public.alert_exceptions (connector, pattern, kind, reason, expires_at, created_by)
  values (p_connector, p_pattern, p_kind, btrim(p_reason), now() + make_interval(hours => p_hours), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.record_alert_exception(text, text, text, text, integer) from public, anon;
grant execute on function public.record_alert_exception(text, text, text, text, integer) to authenticated, service_role;
