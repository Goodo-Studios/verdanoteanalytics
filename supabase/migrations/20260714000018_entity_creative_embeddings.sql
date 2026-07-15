-- =============================================================================
-- Entity Report (Feature 2) — v1 TEXT clustering
-- Migration 1/2: creative_embeddings table + additive cluster columns on creatives
-- =============================================================================
-- Placeholder prefix. The orchestrator renumbers + runs `supabase db push`
-- manually (see MIGRATIONS.md). Idempotent + additive only.
--
-- Mirrors the vault item_embeddings design (512-dim text-embedding-3-small,
-- HNSW cosine) but scoped to Meta creatives.  Embeddings are produced by the
-- `creative-embed` edge fn (which reuses the vault-embed OpenRouter path) from a
-- per-creative text feature = ai_visual_notes + parsed tags.
-- =============================================================================

create extension if not exists vector;

-- ─── creative_embeddings — one 512-dim text vector per creative ──────────────
create table if not exists public.creative_embeddings (
  ad_id        text primary key references public.creatives(ad_id) on delete cascade,
  account_id   text not null references public.ad_accounts(id) on delete cascade,
  embedding    vector(512),
  -- The exact text blob that was embedded, kept for debuggability / re-embed
  -- decisions (feature drift → re-embed).  Not indexed.
  source_text  text,
  model        text not null default 'openai/text-embedding-3-small',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists creative_embeddings_account_idx
  on public.creative_embeddings(account_id);

create index if not exists creative_embeddings_hnsw_idx
  on public.creative_embeddings
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

alter table public.creative_embeddings enable row level security;

-- RLS: read gated by the same builder/employee/client-account model the rest of
-- the schema uses.  has_role() + get_user_account_ids() already exist (see
-- 20260212040604 / creative_daily_metrics policies).  Writes are service-role
-- only (the creative-embed edge fn holds the service-role key), so no
-- INSERT/UPDATE policy for authenticated — service role bypasses RLS.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'creative_embeddings'
      and policyname = 'Builder/employee manage creative_embeddings'
  ) then
    create policy "Builder/employee manage creative_embeddings"
      on public.creative_embeddings for all
      using (has_role(auth.uid(), 'builder'::app_role)
             or has_role(auth.uid(), 'employee'::app_role));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'creative_embeddings'
      and policyname = 'Client view linked creative_embeddings'
  ) then
    create policy "Client view linked creative_embeddings"
      on public.creative_embeddings for select
      using (has_role(auth.uid(), 'client'::app_role)
             and account_id in (select get_user_account_ids(auth.uid())));
  end if;
end $$;
