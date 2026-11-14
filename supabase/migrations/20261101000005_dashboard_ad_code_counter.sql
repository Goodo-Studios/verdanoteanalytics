-- Dashboard data foundation 5/6: ad name counter
--
-- The sequential ad code counter used by the ad name generator. In the old
-- dashboard database it is readable and claimable by anon. Here only Verdanote
-- staff can call peek_ad_code() and claim_ad_code().
--
-- The seed value is the generator's own seed. The one-time data copy raises it
-- to the live counter value and never lowers it, so a code issued by the old
-- database cannot be issued a second time. See scripts/dashboard-copy/README.md.

create table if not exists public.ad_name_counter (
  id smallint primary key default 1,
  value bigint not null,
  updated_at timestamptz not null default now(),
  constraint ad_name_counter_singleton check (id = 1)
);

insert into public.ad_name_counter (id, value)
values (1, 199999)
on conflict (id) do nothing;

alter table public.ad_name_counter enable row level security;
revoke all on table public.ad_name_counter from public, anon, authenticated;
grant select on table public.ad_name_counter to authenticated;

create policy "Staff read ad_name_counter" on public.ad_name_counter
  for select to authenticated
  using (
    public.has_role(auth.uid(), 'builder'::public.app_role)
    or public.has_role(auth.uid(), 'employee'::public.app_role)
  );

-- The number that will be issued next. Read only.
create or replace function public.peek_ad_code()
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_next bigint;
begin
  if not (
    public.has_role(auth.uid(), 'builder'::public.app_role)
    or public.has_role(auth.uid(), 'employee'::public.app_role)
  ) then
    raise exception 'only staff can read the ad code counter'
      using errcode = 'insufficient_privilege';
  end if;

  select value + 1 into v_next from public.ad_name_counter where id = 1;
  return v_next;
end;
$$;

-- Atomically issue the next number. The UPDATE takes a row lock, so concurrent
-- callers queue and each receives a distinct code.
create or replace function public.claim_ad_code()
returns bigint
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_value bigint;
begin
  if not (
    public.has_role(auth.uid(), 'builder'::public.app_role)
    or public.has_role(auth.uid(), 'employee'::public.app_role)
  ) then
    raise exception 'only staff can claim an ad code'
      using errcode = 'insufficient_privilege';
  end if;

  update public.ad_name_counter
     set value = value + 1,
         updated_at = now()
   where id = 1
  returning value into v_value;

  return v_value;
end;
$$;

revoke all on function public.peek_ad_code() from public, anon, authenticated;
revoke all on function public.claim_ad_code() from public, anon, authenticated;
grant execute on function public.peek_ad_code() to authenticated;
grant execute on function public.claim_ad_code() to authenticated;
