-- =============================================================================
-- Creative Intelligence (WS1 / US-002) — analyze-creative queue mechanics
-- =============================================================================
-- Placeholder prefix. The orchestrator renumbers + runs `supabase db push`
-- manually (see MIGRATIONS.md). Idempotent + additive only. Depends on
-- 20260714000032 (analysis_status vocabulary widened to include 'analyzing'/'done'
-- and the creatives(account_id, analysis_status) drain index).
--
-- The analysis "queue" is creatives.analysis_status itself (no separate queue
-- table): 'pending' rows are claimed in spend-first batches with FOR UPDATE SKIP
-- LOCKED so concurrent self-chained invocations never double-process an ad. A
-- per-account spend ledger enforces the $10 budget cap across the whole
-- self-chaining run.
-- =============================================================================

-- ─── 1. Per-account spend ledger (budget cap) ───────────────────────────────
create table if not exists public.creative_analysis_spend (
  account_id text primary key references public.ad_accounts(id) on delete cascade,
  spent_usd  numeric not null default 0,
  cap_usd    numeric not null default 10,   -- US-000 decision: $10/account cap
  updated_at timestamptz not null default now()
);

comment on table public.creative_analysis_spend is
  'Running LLM spend per account for the analyze-creative pipeline. cap_usd enforced by the drain (US-002); default $10 (US-000).';

alter table public.creative_analysis_spend enable row level security;
-- Internal/service-role only — no public policies (service role bypasses RLS).

-- Atomically add spend and return the new running total. Called once per creative
-- from analyze-creative using the real OpenRouter token usage.
create or replace function public.add_creative_analysis_spend(
  p_account_id text,
  p_usd        numeric
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
begin
  insert into public.creative_analysis_spend (account_id, spent_usd, updated_at)
  values (p_account_id, greatest(p_usd, 0), now())
  on conflict (account_id) do update
    set spent_usd  = public.creative_analysis_spend.spent_usd + greatest(excluded.spent_usd, 0),
        updated_at = now()
  returning spent_usd into v_total;
  return v_total;
end;
$$;

-- ─── 2. Spend-first batch claim (atomic, SKIP LOCKED) ───────────────────────
-- Marks up to p_limit 'pending' creatives for one account as 'analyzing' and
-- returns them. Highest-spend first so the most important creatives analyze
-- before the budget cap is reached (mirrors the winners-decided-by-spend policy).
create or replace function public.claim_creatives_for_analysis(
  p_account_id text,
  p_limit      int default 25
) returns setof public.creatives
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.creatives c
     set analysis_status = 'analyzing',
         updated_at      = now()
   where c.ad_id in (
     select c2.ad_id
       from public.creatives c2
      where c2.account_id = p_account_id
        and c2.analysis_status = 'pending'
      order by coalesce(c2.spend, 0) desc, c2.created_at desc
      limit greatest(p_limit, 1)
      for update skip locked
   )
  returning c.*;
end;
$$;

-- ─── 3. pg_cron scheduling (GATED — enable at wider rollout, US-012) ─────────
-- The self-chaining drain (analyze-creative re-invokes itself while 'pending'
-- rows remain and the cap is not hit) means no cron is required to fully drain
-- an account once poked. For the builder-account-first rollout we invoke the
-- function manually with { account_id: '<builder>' } and let it self-chain.
--
-- When rollout widens, enable a periodic poke to catch newly-synced creatives.
-- Left commented so v1 cannot trigger mass cross-account spend before validation:
--
-- select cron.schedule(
--   'analyze-creative-builder-hourly',
--   '17 * * * *',
--   $CRON$
--   select net.http_post(
--     url     := current_setting('app.settings.functions_url') || '/analyze-creative',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key'),
--       'Content-Type', 'application/json'),
--     body    := jsonb_build_object('account_id', '<BUILDER_ACCOUNT_ID>')
--   );
--   $CRON$
-- );
