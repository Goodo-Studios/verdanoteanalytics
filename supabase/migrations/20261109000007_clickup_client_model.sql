-- Goodo OS foundations: the ClickUp connector on the one client model
-- (consolidation step 3, last PR). Design: docs/goodo-os-foundations.md.
--
-- 1. pipeline_tasks gets client_slug (required). account_id becomes optional:
--    sync-clickup-tasks still writes it when the client has exactly one linked ad
--    account, so the /pipeline page (which filters by ad account) keeps working.
-- 2. The client read rule on pipeline_tasks is widened: a client also reads rows
--    whose client_slug is one of get_user_client_slugs(). The account rule stays.
--    The staff rule is not touched.
-- 3. clickup_client_folders (folder -> ad account) is retired. Its rows become
--    source_mappings rows (provider clickup, kind folder, folder -> client), and
--    the table is dropped once nothing else references it.
--
-- Tests: supabase/tests/clickup_client_model_test.sql.

-- ------------------------------------------------------------------ 1. client_slug

alter table public.pipeline_tasks
  add column client_slug text references public.clients(slug) on delete cascade;

-- Existing rows take the client that owns their ad account.
update public.pipeline_tasks pt
   set client_slug = ca.client_slug
  from public.client_ad_accounts ca
 where ca.account_id = pt.account_id
   and pt.client_slug is null;

-- A row whose ad account belongs to no client cannot be written by the new sync
-- either. The table holds derived data that the next sync run rewrites, so these
-- rows are removed rather than given a guessed client.
delete from public.pipeline_tasks where client_slug is null;

alter table public.pipeline_tasks alter column client_slug set not null;
alter table public.pipeline_tasks alter column account_id drop not null;

create index if not exists pipeline_tasks_client_slug_idx on public.pipeline_tasks (client_slug);

comment on column public.pipeline_tasks.client_slug is
  'Client the board row belongs to (clients.slug). Set by sync-clickup-tasks.';
comment on column public.pipeline_tasks.account_id is
  'Ad account of the client, written only when the client has exactly one linked ad account.';

-- ------------------------------------------------------------------ 2. client read rule

drop policy "Client can view linked pipeline_tasks" on public.pipeline_tasks;

create policy "Client can view linked pipeline_tasks"
  on public.pipeline_tasks for select to authenticated
  using (
    public.has_role(auth.uid(), 'client'::public.app_role)
    and (
      account_id in (select public.get_user_account_ids(auth.uid()))
      or client_slug in (select public.get_user_client_slugs())
    )
  );

-- ------------------------------------------------------------------ 3. retire clickup_client_folders

do $$
declare
  n_without_client int;
  n_conflicting int;
  n_refs int;
begin
  if to_regclass('public.clickup_client_folders') is null then
    return;
  end if;

  -- Every folder row must reach a client through its ad account. Stop rather than
  -- drop a staff-set mapping that cannot be carried over.
  select count(*) into n_without_client
    from public.clickup_client_folders f
    left join public.client_ad_accounts ca on ca.account_id = f.account_id
   where ca.client_slug is null;
  if n_without_client > 0 then
    raise exception 'clickup_client_folders: % row(s) point at an ad account that belongs to no client. Link the ad account in client_ad_accounts, then rerun.', n_without_client;
  end if;

  -- An active ClickUp folder mapping to a different client already exists.
  select count(*) into n_conflicting
    from public.clickup_client_folders f
    join public.client_ad_accounts ca on ca.account_id = f.account_id
    join public.source_mappings sm
      on sm.provider = 'clickup' and sm.kind = 'folder' and sm.active and sm.external_id = f.folder_id
   where sm.client_slug <> ca.client_slug;
  if n_conflicting > 0 then
    raise exception 'clickup_client_folders: % row(s) disagree with an existing source_mappings row for the same folder. Resolve them by hand, then rerun.', n_conflicting;
  end if;

  insert into public.source_mappings (client_slug, provider, kind, external_id, label, created_by)
  select ca.client_slug, 'clickup', 'folder', f.folder_id, f.folder_name, null
    from public.clickup_client_folders f
    join public.client_ad_accounts ca on ca.account_id = f.account_id
   where not exists (
     select 1 from public.source_mappings sm
      where sm.provider = 'clickup' and sm.kind = 'folder' and sm.active and sm.external_id = f.folder_id
   );

  -- Drop only if nothing else in the database uses the table: no function body,
  -- no view, no foreign key.
  select count(*) into n_refs
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema')
     and p.prosrc ilike '%clickup_client_folders%';
  select n_refs + count(*) into n_refs
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid
   where d.refobjid = 'public.clickup_client_folders'::regclass
     and r.ev_class <> 'public.clickup_client_folders'::regclass;
  select n_refs + count(*) into n_refs
    from pg_constraint c
   where c.confrelid = 'public.clickup_client_folders'::regclass;
  if n_refs > 0 then
    raise exception 'clickup_client_folders is still referenced (% object(s)); not dropping it.', n_refs;
  end if;

  drop table public.clickup_client_folders;
end
$$;
