-- Goodo OS wave C: recommendations from decision to measured outcome (consolidation
-- step 4c). Port of Goodo OS migration 051_recommendation_outcomes.sql and
-- backend/services/recommendations.ts (US-085), on the engagements of migration
-- 20261109000004, the confirmed meeting recap items of migration 20261110000002 and
-- Verdanote's own ad data (creatives, creative_daily_metrics, client_ad_accounts).
--
--   recommendations                  a creative or service recommendation for one
--                                    engagement. The proposal never changes; only its
--                                    state and version move forward.
--   recommendation_decisions         accepted, rejected or deferred, with the reason,
--                                    the hypothesis and final action (accepted), and the
--                                    evidence cited. Immutable.
--   recommendation_execution_links   the work that executes an accepted recommendation:
--                                    the client's Meta ads, an optional Content Pipeline
--                                    task, a review window and an accountable owner. A
--                                    later link supersedes an earlier one. Immutable.
--   recommendation_outcomes          an evaluation computed from the database, never
--                                    typed: not executed, insufficient, inconclusive or
--                                    measured. Never a win. Immutable.
--   recommendation_outcome_evidence  the ad numbers each evaluation read (impressions,
--                                    spend, clicks, purchases, purchase value in the
--                                    review window, and when the account last synced).
--                                    Immutable.
--   recommendation_learnings         a staff conclusion (supported, not supported,
--                                    inconclusive) and learning after a measured outcome
--                                    whose evidence is still current. Immutable.
--
-- Rules ported from Goodo OS: decisions, links, evaluations and learnings compare and set
-- the recommendation version (40001 when stale); accepting needs a hypothesis and a final
-- action; cited evidence must belong to the recommendation's client; the evaluation never
-- produces a win and "measured" only means the evidence is complete enough to review; a
-- learning needs the latest outcome to be measured and a fresh evaluation to give the same
-- fingerprint. Every number shown comes from creative_daily_metrics; nothing is estimated.
--
-- Evaluation (recommendation_evaluation): not executed when the recommendation is not
-- accepted, deferred, or has no link; insufficient while the review window is open, when
-- no linked ad has any metrics (not launched), or when a linked ad has no impressions in
-- the window; inconclusive when an ad account was last synced before the window closed
-- (stale); otherwise measured.
--
-- Differences (conservative stand-ins, see "Needs the owner" in the plan): Goodo OS read
-- asset-to-ad mappings and performance evidence records; Verdanote already holds the ad
-- metrics, so a link names the client's ad ids directly and the evaluation reads their
-- daily metrics. Goodo OS cited performance evidence, asset mappings and service
-- suggestions; here a decision cites the client's ads and confirmed meeting recap items.
-- Goodo OS required a ClickUp task on the link; here the Content Pipeline task is optional
-- because the ClickUp sync does not run in staging. Any builder or employee stands in for
-- the per-engagement recommendation capabilities.
--
-- Staff read every table; clients read nothing. Writes go only through the checked
-- functions (SECURITY DEFINER, each refuses non-staff in its own body).
--
-- Not ported: service improvement suggestions as a source, deliverable asset identities,
-- command receipts. Tests: supabase/tests/recommendations_test.sql.

create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null,
  client_slug text not null,
  category text not null check (category in ('creative', 'service')),
  title text not null check (length(btrim(title)) between 1 and 200),
  proposal text not null check (length(btrim(proposal)) between 1 and 4000),
  state text not null default 'proposed' check (state in ('proposed', 'accepted', 'rejected', 'deferred')),
  version integer not null default 1 check (version >= 1),
  proposed_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recommendations_engagement_fkey foreign key (engagement_id, client_slug)
    references public.engagements(id, client_slug) on delete restrict
);
create index recommendations_engagement_idx on public.recommendations (engagement_id, created_at desc);

create table public.recommendation_decisions (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references public.recommendations(id) on delete restrict,
  recommendation_version integer not null check (recommendation_version > 1),
  decision text not null check (decision in ('accepted', 'rejected', 'deferred')),
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  hypothesis text check (hypothesis is null or length(btrim(hypothesis)) between 1 and 2000),
  final_action text check (final_action is null or length(btrim(final_action)) between 1 and 4000),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) <= 20),
  decided_by uuid not null,
  created_at timestamptz not null default now(),
  unique (recommendation_id, recommendation_version),
  check (decision <> 'accepted' or (hypothesis is not null and final_action is not null))
);

create table public.recommendation_execution_links (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references public.recommendations(id) on delete restrict,
  recommendation_version integer not null check (recommendation_version > 1),
  decision_id uuid not null references public.recommendation_decisions(id) on delete restrict,
  ad_ids text[] not null check (cardinality(ad_ids) between 1 and 20),
  pipeline_task_id uuid references public.pipeline_tasks(id) on delete restrict,
  accountable_owner_id uuid not null,
  review_window_start date not null,
  review_window_end date not null,
  linked_by uuid not null,
  created_at timestamptz not null default now(),
  unique (recommendation_id, recommendation_version),
  check (review_window_end >= review_window_start)
);

create table public.recommendation_outcomes (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references public.recommendations(id) on delete restrict,
  recommendation_version integer not null check (recommendation_version > 1),
  link_id uuid references public.recommendation_execution_links(id) on delete restrict,
  status text not null check (status in ('not_executed', 'insufficient', 'inconclusive', 'measured')),
  reason text not null check (reason in ('not_accepted', 'deferred', 'no_execution', 'review_window_open', 'not_launched',
                                         'insufficient_testing', 'stale_evidence', 'evidence_complete')),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  supersedes_outcome_id uuid references public.recommendation_outcomes(id) on delete restrict,
  evaluated_by uuid not null,
  evaluated_at timestamptz not null default now(),
  unique (recommendation_id, recommendation_version),
  check ((status = 'measured') = (reason = 'evidence_complete'))
);

create table public.recommendation_outcome_evidence (
  outcome_id uuid not null references public.recommendation_outcomes(id) on delete restrict,
  ad_id text not null,
  account_id text not null,
  impressions bigint not null check (impressions >= 0),
  spend numeric not null check (spend >= 0),
  clicks bigint not null check (clicks >= 0),
  purchases numeric not null check (purchases >= 0),
  purchase_value numeric not null check (purchase_value >= 0),
  metric_days integer not null check (metric_days >= 0),
  account_last_synced_at timestamptz,
  primary key (outcome_id, ad_id)
);

create table public.recommendation_learnings (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references public.recommendations(id) on delete restrict,
  recommendation_version integer not null check (recommendation_version > 1),
  outcome_id uuid not null references public.recommendation_outcomes(id) on delete restrict,
  conclusion text not null check (conclusion in ('supported', 'not_supported', 'inconclusive')),
  learning text not null check (length(btrim(learning)) between 1 and 2000),
  reviewed_by uuid not null,
  created_at timestamptz not null default now(),
  unique (recommendation_id, recommendation_version)
);

comment on table public.recommendations is 'Recommendations per engagement (port of Goodo OS recommendations). Staff only; the proposal never changes.';
comment on table public.recommendation_decisions is 'Accepted, rejected or deferred decisions with cited evidence. Staff only. Immutable.';
comment on table public.recommendation_execution_links is 'The ads and window that execute an accepted recommendation. Staff only. Immutable.';
comment on table public.recommendation_outcomes is 'Outcome evaluations computed from ad metrics; never a win. Staff only. Immutable.';
comment on table public.recommendation_outcome_evidence is 'The ad metrics each outcome evaluation read. Staff only. Immutable.';
comment on table public.recommendation_learnings is 'Staff conclusions after a measured outcome. Staff only. Immutable.';

-- The proposal columns never change; state and version move forward one step at a time.
create or replace function public.guard_recommendation_proposal()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception 'recommendation history is immutable' using errcode = '23514';
  end if;
  if new.id is distinct from old.id or new.engagement_id is distinct from old.engagement_id or new.client_slug is distinct from old.client_slug
     or new.category is distinct from old.category or new.title is distinct from old.title or new.proposal is distinct from old.proposal
     or new.proposed_by is distinct from old.proposed_by or new.created_at is distinct from old.created_at
     or new.version <> old.version + 1 then
    raise exception 'the recommendation proposal is immutable' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.prevent_recommendation_history_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'recommendation history is immutable' using errcode = '23514';
end;
$$;
revoke all on function public.guard_recommendation_proposal(), public.prevent_recommendation_history_rewrite() from public, anon;

create trigger recommendations_proposal_immutable before update or delete on public.recommendations
  for each row execute function public.guard_recommendation_proposal();
create trigger recommendation_decisions_immutable before update or delete on public.recommendation_decisions
  for each row execute function public.prevent_recommendation_history_rewrite();
create trigger recommendation_execution_links_immutable before update or delete on public.recommendation_execution_links
  for each row execute function public.prevent_recommendation_history_rewrite();
create trigger recommendation_outcomes_immutable before update or delete on public.recommendation_outcomes
  for each row execute function public.prevent_recommendation_history_rewrite();
create trigger recommendation_outcome_evidence_immutable before update or delete on public.recommendation_outcome_evidence
  for each row execute function public.prevent_recommendation_history_rewrite();
create trigger recommendation_learnings_immutable before update or delete on public.recommendation_learnings
  for each row execute function public.prevent_recommendation_history_rewrite();
create trigger recommendations_no_truncate before truncate on public.recommendations
  for each statement execute function public.prevent_recommendation_history_rewrite();
create trigger recommendation_decisions_no_truncate before truncate on public.recommendation_decisions
  for each statement execute function public.prevent_recommendation_history_rewrite();
create trigger recommendation_execution_links_no_truncate before truncate on public.recommendation_execution_links
  for each statement execute function public.prevent_recommendation_history_rewrite();
create trigger recommendation_outcomes_no_truncate before truncate on public.recommendation_outcomes
  for each statement execute function public.prevent_recommendation_history_rewrite();
create trigger recommendation_outcome_evidence_no_truncate before truncate on public.recommendation_outcome_evidence
  for each statement execute function public.prevent_recommendation_history_rewrite();
create trigger recommendation_learnings_no_truncate before truncate on public.recommendation_learnings
  for each statement execute function public.prevent_recommendation_history_rewrite();

-- ------------------------------------------------------------------ grants and row rules

alter table public.recommendations enable row level security;
alter table public.recommendation_decisions enable row level security;
alter table public.recommendation_execution_links enable row level security;
alter table public.recommendation_outcomes enable row level security;
alter table public.recommendation_outcome_evidence enable row level security;
alter table public.recommendation_learnings enable row level security;

revoke all on table public.recommendations, public.recommendation_decisions, public.recommendation_execution_links,
  public.recommendation_outcomes, public.recommendation_outcome_evidence, public.recommendation_learnings
  from public, anon, authenticated;
grant select on table public.recommendations, public.recommendation_decisions, public.recommendation_execution_links,
  public.recommendation_outcomes, public.recommendation_outcome_evidence, public.recommendation_learnings to authenticated;
grant all on table public.recommendations, public.recommendation_decisions, public.recommendation_execution_links,
  public.recommendation_outcomes, public.recommendation_outcome_evidence, public.recommendation_learnings to service_role;

create policy "Builder/employee can read recommendations" on public.recommendations
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read recommendation_decisions" on public.recommendation_decisions
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read recommendation_execution_links" on public.recommendation_execution_links
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read recommendation_outcomes" on public.recommendation_outcomes
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read recommendation_outcome_evidence" on public.recommendation_outcome_evidence
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read recommendation_learnings" on public.recommendation_learnings
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

-- ------------------------------------------------------------------ helpers (internal)

-- True when the ad belongs to an ad account linked to the client.
create or replace function public.ad_belongs_to_client(p_ad_id text, p_client_slug text)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (select 1 from public.creatives c join public.client_ad_accounts ca on ca.account_id = c.account_id
                  where c.ad_id = p_ad_id and ca.client_slug = p_client_slug);
$$;

-- Refuses a citation list that is malformed or names something outside the client.
-- Kinds: {"kind":"ad","id":<ad id>} for the client's ads, and
-- {"kind":"meeting_recap_item","id":<item uuid>} for a confirmed recap item of the client.
create or replace function public.check_recommendation_evidence(p_client_slug text, p_evidence jsonb)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v jsonb;
begin
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) > 20 then
    raise exception 'evidence is a list of up to 20 citations' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_evidence)) <> (select count(distinct x) from jsonb_array_elements(p_evidence) x) then
    raise exception 'a citation is listed twice' using errcode = '22023';
  end if;
  for v in select * from jsonb_array_elements(p_evidence) loop
    if jsonb_typeof(v) <> 'object' or (select count(*) from jsonb_object_keys(v)) <> 2 or not (v ? 'kind' and v ? 'id') then
      raise exception 'a citation has a kind and an id' using errcode = '22023';
    end if;
    if v ->> 'kind' = 'ad' then
      if not public.ad_belongs_to_client(v ->> 'id', p_client_slug) then
        raise exception 'a cited ad is not in this client''s ad accounts' using errcode = '22023';
      end if;
    elsif v ->> 'kind' = 'meeting_recap_item' then
      if (v ->> 'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or not exists (
           select 1 from public.meeting_recap_items i
             join public.meeting_recaps r on r.id = i.recap_id
             join public.meeting_recap_reviews rv on rv.item_id = i.id and rv.decision = 'confirmed'
            where i.id = (v ->> 'id')::uuid and r.client_slug = p_client_slug) then
        raise exception 'a cited recap item is not a confirmed item of this client' using errcode = '22023';
      end if;
    else
      raise exception 'a citation kind is ad or meeting_recap_item' using errcode = '22023';
    end if;
  end loop;
end;
$$;

-- The evaluation of one recommendation from the database alone:
-- {"status","reason","linkId","evidence":[...],"fingerprint"}.
create or replace function public.recommendation_evaluation(p_recommendation_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_rec public.recommendations;
  v_link public.recommendation_execution_links;
  v_status text;
  v_reason text;
  v_evidence jsonb := '[]'::jsonb;
  v_closed timestamptz;
  v_body jsonb;
begin
  select * into v_rec from public.recommendations where id = p_recommendation_id;
  if v_rec.id is null then
    raise exception 'recommendation not found' using errcode = 'P0002';
  end if;
  select * into v_link from public.recommendation_execution_links
   where recommendation_id = p_recommendation_id order by recommendation_version desc limit 1;
  if v_rec.state in ('proposed', 'rejected') then
    v_status := 'not_executed'; v_reason := 'not_accepted';
  elsif v_rec.state = 'deferred' then
    v_status := 'not_executed'; v_reason := 'deferred';
  elsif v_link.id is null then
    v_status := 'not_executed'; v_reason := 'no_execution';
  else
    v_closed := (v_link.review_window_end + 1)::timestamptz;
    select coalesce(jsonb_agg(jsonb_build_object(
             'adId', a.ad_id, 'accountId', a.account_id, 'impressions', a.impressions, 'spend', a.spend, 'clicks', a.clicks,
             'purchases', a.purchases, 'purchaseValue', a.purchase_value, 'metricDays', a.metric_days,
             'everReported', a.ever_reported, 'accountLastSyncedAt', a.last_synced_at) order by a.ad_id), '[]'::jsonb)
      into v_evidence
      from (
        select x.ad_id, c.account_id, acc.last_synced_at,
               coalesce(sum(m.impressions) filter (where m.date between v_link.review_window_start and v_link.review_window_end), 0)::bigint as impressions,
               coalesce(sum(m.spend) filter (where m.date between v_link.review_window_start and v_link.review_window_end), 0)::numeric as spend,
               coalesce(sum(m.clicks) filter (where m.date between v_link.review_window_start and v_link.review_window_end), 0)::bigint as clicks,
               coalesce(sum(m.purchases) filter (where m.date between v_link.review_window_start and v_link.review_window_end), 0)::numeric as purchases,
               coalesce(sum(m.purchase_value) filter (where m.date between v_link.review_window_start and v_link.review_window_end), 0)::numeric as purchase_value,
               count(m.date) filter (where m.date between v_link.review_window_start and v_link.review_window_end)::int as metric_days,
               count(m.date) > 0 as ever_reported
          from unnest(v_link.ad_ids) as x(ad_id)
          left join public.creatives c on c.ad_id = x.ad_id
          left join public.ad_accounts acc on acc.id = c.account_id
          left join public.creative_daily_metrics m on m.ad_id = x.ad_id
         group by x.ad_id, c.account_id, acc.last_synced_at
      ) a;
    if now() < v_closed then
      v_status := 'insufficient'; v_reason := 'review_window_open';
    elsif not exists (select 1 from jsonb_array_elements(v_evidence) e where (e ->> 'everReported')::boolean) then
      v_status := 'insufficient'; v_reason := 'not_launched';
    elsif exists (select 1 from jsonb_array_elements(v_evidence) e
                   where e ->> 'accountLastSyncedAt' is null or (e ->> 'accountLastSyncedAt')::timestamptz < v_closed) then
      v_status := 'inconclusive'; v_reason := 'stale_evidence';
    elsif exists (select 1 from jsonb_array_elements(v_evidence) e where (e ->> 'impressions')::bigint <= 0) then
      v_status := 'insufficient'; v_reason := 'insufficient_testing';
    else
      v_status := 'measured'; v_reason := 'evidence_complete';
    end if;
  end if;
  v_body := jsonb_build_object('status', v_status, 'reason', v_reason, 'linkId', v_link.id, 'evidence', v_evidence);
  return v_body || jsonb_build_object('fingerprint', encode(sha256(convert_to(v_body::text, 'UTF8')), 'hex'));
end;
$$;

revoke all on function public.ad_belongs_to_client(text, text), public.check_recommendation_evidence(text, jsonb),
  public.recommendation_evaluation(uuid) from public, anon, authenticated;
grant execute on function public.ad_belongs_to_client(text, text), public.check_recommendation_evidence(text, jsonb),
  public.recommendation_evaluation(uuid) to service_role;

-- ------------------------------------------------------------------ checked functions

-- Builder or employee: propose a recommendation for an open engagement.
create or replace function public.propose_recommendation(p_engagement_id uuid, p_category text, p_title text, p_proposal text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_engagement public.engagements;
  v_id uuid;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can propose a recommendation' using errcode = 'insufficient_privilege';
  end if;
  select * into v_engagement from public.engagements where id = p_engagement_id for share;
  if v_engagement.id is null then
    raise exception 'engagement not found' using errcode = 'P0002';
  end if;
  if v_engagement.status in ('closed', 'cancelled') then
    raise exception 'the engagement is closed' using errcode = '22023';
  end if;
  insert into public.recommendations (engagement_id, client_slug, category, title, proposal, proposed_by)
  values (p_engagement_id, v_engagement.client_slug, p_category, btrim(p_title), btrim(p_proposal), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Builder or employee: decide a proposed or deferred recommendation, citing evidence.
create or replace function public.decide_recommendation(
  p_recommendation_id uuid,
  p_expected_version integer,
  p_decision text,
  p_reason text,
  p_hypothesis text,
  p_final_action text,
  p_evidence jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_rec public.recommendations;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can decide a recommendation' using errcode = 'insufficient_privilege';
  end if;
  select * into v_rec from public.recommendations where id = p_recommendation_id for update;
  if v_rec.id is null then
    raise exception 'recommendation not found' using errcode = 'P0002';
  end if;
  if v_rec.version <> p_expected_version then
    raise exception 'the recommendation changed since it was shown' using errcode = '40001';
  end if;
  if v_rec.state not in ('proposed', 'deferred') then
    raise exception 'only a proposed or deferred recommendation is decided' using errcode = '22023';
  end if;
  if p_decision not in ('accepted', 'rejected', 'deferred') then
    raise exception 'accepted, rejected or deferred' using errcode = '22023';
  end if;
  if p_decision = 'accepted' and (nullif(btrim(p_hypothesis), '') is null or nullif(btrim(p_final_action), '') is null) then
    raise exception 'accepting needs a hypothesis and a final action' using errcode = '22023';
  end if;
  perform public.check_recommendation_evidence(v_rec.client_slug, p_evidence);
  update public.recommendations set state = p_decision, version = v_rec.version + 1 where id = p_recommendation_id;
  insert into public.recommendation_decisions (recommendation_id, recommendation_version, decision, reason, hypothesis, final_action, evidence, decided_by)
  values (p_recommendation_id, v_rec.version + 1, p_decision, btrim(p_reason), nullif(btrim(p_hypothesis), ''), nullif(btrim(p_final_action), ''),
          p_evidence, auth.uid());
  return v_rec.version + 1;
end;
$$;

-- Builder or employee: link the ads (and optionally the Content Pipeline task) that
-- execute an accepted recommendation, with the review window and accountable owner.
create or replace function public.link_recommendation_execution(
  p_recommendation_id uuid,
  p_expected_version integer,
  p_ad_ids text[],
  p_pipeline_task_id uuid,
  p_accountable_owner_id uuid,
  p_review_window_start date,
  p_review_window_end date
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_rec public.recommendations;
  v_decision uuid;
  v_ad text;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can link a recommendation' using errcode = 'insufficient_privilege';
  end if;
  select * into v_rec from public.recommendations where id = p_recommendation_id for update;
  if v_rec.id is null then
    raise exception 'recommendation not found' using errcode = 'P0002';
  end if;
  if v_rec.version <> p_expected_version then
    raise exception 'the recommendation changed since it was shown' using errcode = '40001';
  end if;
  if v_rec.state <> 'accepted' then
    raise exception 'only an accepted recommendation is linked' using errcode = '22023';
  end if;
  select id into v_decision from public.recommendation_decisions
   where recommendation_id = p_recommendation_id and decision = 'accepted' order by recommendation_version desc limit 1;
  if p_ad_ids is null or cardinality(p_ad_ids) not between 1 and 20 or cardinality(p_ad_ids) <> (select count(distinct x) from unnest(p_ad_ids) x) then
    raise exception 'link 1 to 20 different ads' using errcode = '22023';
  end if;
  foreach v_ad in array p_ad_ids loop
    if not public.ad_belongs_to_client(v_ad, v_rec.client_slug) then
      raise exception 'an ad is not in this client''s ad accounts' using errcode = '22023';
    end if;
  end loop;
  if p_pipeline_task_id is not null and not exists (select 1 from public.pipeline_tasks where id = p_pipeline_task_id and client_slug = v_rec.client_slug) then
    raise exception 'the Content Pipeline task is not this client''s' using errcode = '22023';
  end if;
  if not exists (select 1 from public.user_roles where user_id = p_accountable_owner_id and role in ('builder', 'employee')) then
    raise exception 'the accountable owner must be staff' using errcode = '22023';
  end if;
  if p_review_window_start is null or p_review_window_end is null or p_review_window_end < p_review_window_start then
    raise exception 'the review window ends on or after it starts' using errcode = '22023';
  end if;
  update public.recommendations set version = v_rec.version + 1 where id = p_recommendation_id;
  insert into public.recommendation_execution_links (recommendation_id, recommendation_version, decision_id, ad_ids, pipeline_task_id,
                                                     accountable_owner_id, review_window_start, review_window_end, linked_by)
  values (p_recommendation_id, v_rec.version + 1, v_decision, p_ad_ids, p_pipeline_task_id, p_accountable_owner_id,
          p_review_window_start, p_review_window_end, auth.uid());
  return v_rec.version + 1;
end;
$$;

-- Builder or employee: record an evaluation computed from the database.
create or replace function public.record_recommendation_outcome(p_recommendation_id uuid, p_expected_version integer)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_rec public.recommendations;
  v_eval jsonb;
  v_previous uuid;
  v_id uuid;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can evaluate a recommendation' using errcode = 'insufficient_privilege';
  end if;
  select * into v_rec from public.recommendations where id = p_recommendation_id for update;
  if v_rec.id is null then
    raise exception 'recommendation not found' using errcode = 'P0002';
  end if;
  if v_rec.version <> p_expected_version then
    raise exception 'the recommendation changed since it was shown' using errcode = '40001';
  end if;
  v_eval := public.recommendation_evaluation(p_recommendation_id);
  select id into v_previous from public.recommendation_outcomes
   where recommendation_id = p_recommendation_id order by recommendation_version desc limit 1;
  update public.recommendations set version = v_rec.version + 1 where id = p_recommendation_id;
  insert into public.recommendation_outcomes (recommendation_id, recommendation_version, link_id, status, reason, fingerprint,
                                              supersedes_outcome_id, evaluated_by)
  values (p_recommendation_id, v_rec.version + 1, nullif(v_eval ->> 'linkId', '')::uuid, v_eval ->> 'status', v_eval ->> 'reason',
          v_eval ->> 'fingerprint', v_previous, auth.uid())
  returning id into v_id;
  insert into public.recommendation_outcome_evidence (outcome_id, ad_id, account_id, impressions, spend, clicks, purchases, purchase_value,
                                                      metric_days, account_last_synced_at)
  select v_id, e ->> 'adId', coalesce(e ->> 'accountId', ''), (e ->> 'impressions')::bigint, (e ->> 'spend')::numeric, (e ->> 'clicks')::bigint,
         (e ->> 'purchases')::numeric, (e ->> 'purchaseValue')::numeric, (e ->> 'metricDays')::int, (e ->> 'accountLastSyncedAt')::timestamptz
    from jsonb_array_elements(v_eval -> 'evidence') e;
  return v_eval ->> 'status';
end;
$$;

-- Builder or employee: the conclusion and learning after a measured outcome whose
-- evidence is still current.
create or replace function public.review_recommendation_learning(
  p_recommendation_id uuid,
  p_expected_version integer,
  p_outcome_id uuid,
  p_conclusion text,
  p_learning text
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_rec public.recommendations;
  v_outcome public.recommendation_outcomes;
  v_eval jsonb;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can review a recommendation outcome' using errcode = 'insufficient_privilege';
  end if;
  select * into v_rec from public.recommendations where id = p_recommendation_id for update;
  if v_rec.id is null then
    raise exception 'recommendation not found' using errcode = 'P0002';
  end if;
  if v_rec.version <> p_expected_version then
    raise exception 'the recommendation changed since it was shown' using errcode = '40001';
  end if;
  select * into v_outcome from public.recommendation_outcomes
   where recommendation_id = p_recommendation_id order by recommendation_version desc limit 1;
  if v_outcome.id is distinct from p_outcome_id or v_outcome.status <> 'measured' then
    raise exception 'the outcome is not the latest measured one' using errcode = '40001';
  end if;
  v_eval := public.recommendation_evaluation(p_recommendation_id);
  if v_eval ->> 'status' <> 'measured' or v_eval ->> 'fingerprint' <> v_outcome.fingerprint then
    raise exception 'the evidence changed since the outcome was recorded; evaluate again' using errcode = '40001';
  end if;
  if p_conclusion not in ('supported', 'not_supported', 'inconclusive') then
    raise exception 'supported, not supported or inconclusive' using errcode = '22023';
  end if;
  update public.recommendations set version = v_rec.version + 1 where id = p_recommendation_id;
  insert into public.recommendation_learnings (recommendation_id, recommendation_version, outcome_id, conclusion, learning, reviewed_by)
  values (p_recommendation_id, v_rec.version + 1, p_outcome_id, p_conclusion, btrim(p_learning), auth.uid());
  return v_rec.version + 1;
end;
$$;

-- Builder or employee: the client's ads that a link or a citation can name (newest first).
create or replace function public.recommendation_ad_options(p_client_slug text)
returns table (ad_id text, ad_name text, account_id text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can list client ads' using errcode = 'insufficient_privilege';
  end if;
  return query
    select c.ad_id, c.ad_name, c.account_id
      from public.creatives c
      join public.client_ad_accounts ca on ca.account_id = c.account_id
     where ca.client_slug = p_client_slug
     order by c.created_at desc nulls last
     limit 200;
end;
$$;

revoke all on function public.propose_recommendation(uuid, text, text, text),
  public.decide_recommendation(uuid, integer, text, text, text, text, jsonb),
  public.link_recommendation_execution(uuid, integer, text[], uuid, uuid, date, date),
  public.record_recommendation_outcome(uuid, integer),
  public.review_recommendation_learning(uuid, integer, uuid, text, text),
  public.recommendation_ad_options(text)
  from public, anon;
grant execute on function public.propose_recommendation(uuid, text, text, text),
  public.decide_recommendation(uuid, integer, text, text, text, text, jsonb),
  public.link_recommendation_execution(uuid, integer, text[], uuid, uuid, date, date),
  public.record_recommendation_outcome(uuid, integer),
  public.review_recommendation_learning(uuid, integer, uuid, text, text),
  public.recommendation_ad_options(text)
  to authenticated, service_role;
