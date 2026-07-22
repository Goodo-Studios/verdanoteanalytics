-- =============================================================================
-- Apify Creative Capture (US-001) — durable bookkeeping, spend ledger, provenance
-- =============================================================================
-- ONE additive + idempotent migration. Manual `supabase db push --linked`
-- (CI does NOT run migrations — see MIGRATIONS.md). Re-running is a safe no-op
-- that cleanly registers the ledger row (per
-- verdanote-supabase-ledger-drift-reconcile-with-db-push).
--
-- Numbering: 20260722000004 follows the remote + local ledger frontier
-- (…20260722000003_media_coverage_video_intent) so ordering is preserved.
--
-- This story is SCHEMA-ONLY. It gives the Apify per-ad capture pipeline durable
-- state on the (large, hot) creatives / media_assets tables plus a per-day spend
-- ledger, so subsequent stories (US-001B ad_archive_id resolver, US-002 capture
-- drain) have somewhere to record attempts, provenance, and spend.
--
-- ── Hot-table safety ─────────────────────────────────────────────────────────
-- creatives and media_assets are large hot tables. Every column added here is
-- either nullable or carries a CONSTANT default ('meta_api', 0), so on
-- Postgres 11+ each ADD COLUMN is a metadata-only change — NO full table rewrite.
-- Indexes are partial + created guarded. No existing RLS is touched.
-- =============================================================================

-- ─── 1. creatives: Apify capture bookkeeping ─────────────────────────────────
-- Tracks the lifecycle of an Apify per-ad capture attempt against a creative.
ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS apify_capture_status  text;          -- null|pending|captured|failed|skipped
ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS apify_attempts        int not null default 0;
ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS apify_last_attempt_at timestamptz;

-- Named CHECK for the status vocabulary (NULL = never considered for capture).
-- Added guarded so a partial re-apply is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'creatives_apify_capture_status_check'
      AND conrelid = 'public.creatives'::regclass
  ) THEN
    ALTER TABLE public.creatives
      ADD CONSTRAINT creatives_apify_capture_status_check
      CHECK (apify_capture_status IN ('pending', 'captured', 'failed', 'skipped'));
  END IF;
END $$;

COMMENT ON COLUMN public.creatives.apify_capture_status IS
  'US-001: lifecycle of the Apify per-ad capture attempt for this creative. NULL = never queued; ''pending'' = queued/in-flight; ''captured'' = assets fetched via Apify; ''failed'' = attempt errored; ''skipped'' = deliberately not captured. Domain enforced by creatives_apify_capture_status_check.';
COMMENT ON COLUMN public.creatives.apify_attempts IS
  'US-001: count of Apify capture attempts made for this creative (for retry/backoff caps in the US-002 drain). Constant default 0 = metadata-only add.';
COMMENT ON COLUMN public.creatives.apify_last_attempt_at IS
  'US-001: timestamp of the most recent Apify capture attempt (drives stale-reclaim / backoff in US-002).';

-- ─── 2. creatives: Ad Library archive identifier (per-ad capture key) ─────────
-- Apify per-ad capture is keyed on the Meta Ad Library ad_archive_id. It is not
-- present on most creatives yet, so US-001B resolves it; US-002 then captures.
ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS ad_archive_id             text;         -- Meta Ad Library id
ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS ad_archive_id_resolved_at timestamptz;
ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS ad_archive_id_status      text;         -- null|resolved|unresolvable

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'creatives_ad_archive_id_status_check'
      AND conrelid = 'public.creatives'::regclass
  ) THEN
    ALTER TABLE public.creatives
      ADD CONSTRAINT creatives_ad_archive_id_status_check
      CHECK (ad_archive_id_status IN ('resolved', 'unresolvable'));
  END IF;
END $$;

COMMENT ON COLUMN public.creatives.ad_archive_id IS
  'US-001: Meta Ad Library archive id for this creative. Required by Apify per-ad capture (US-002); populated by the US-001B resolver. NULL until resolved.';
COMMENT ON COLUMN public.creatives.ad_archive_id_resolved_at IS
  'US-001: timestamp the ad_archive_id resolution last ran for this creative.';
COMMENT ON COLUMN public.creatives.ad_archive_id_status IS
  'US-001: resolution state of ad_archive_id. NULL = not yet attempted (US-001B resolver queue); ''resolved'' = ad_archive_id populated + ready for capture (US-002 capture queue); ''unresolvable'' = terminal, no archive id findable (never re-queued). Domain enforced by creatives_ad_archive_id_status_check.';

-- Partial index serving BOTH downstream queues off ONE index. We index the
-- status column but exclude the terminal ''unresolvable'' rows (dead weight that
-- neither queue ever scans):
--   • US-001B resolver queue filters `ad_archive_id_status IS NULL`  (needs resolving)
--   • US-002  capture  queue filters `ad_archive_id_status = 'resolved'` (ready to capture)
-- Both predicates are covered by this index; ''unresolvable'' stays out of it so
-- the index stays small on this large hot table.
CREATE INDEX IF NOT EXISTS idx_creatives_ad_archive_id_status
  ON public.creatives (ad_archive_id_status)
  WHERE ad_archive_id_status IS DISTINCT FROM 'unresolvable';

-- ─── 3. media_assets: capture provenance ─────────────────────────────────────
-- Which pipeline fetched a given asset. Constant default keeps this metadata-only
-- on the hot media_assets table; all existing rows read as 'meta_api'.
ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS capture_source text not null default 'meta_api';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'media_assets_capture_source_check'
      AND conrelid = 'public.media_assets'::regclass
  ) THEN
    ALTER TABLE public.media_assets
      ADD CONSTRAINT media_assets_capture_source_check
      CHECK (capture_source IN ('meta_api', 'apify'));
  END IF;
END $$;

COMMENT ON COLUMN public.media_assets.capture_source IS
  'US-001: pipeline that fetched this asset. ''meta_api'' (default; the existing Meta Graph sync) or ''apify'' (US-002 per-ad Apify capture). Domain enforced by media_assets_capture_source_check.';

-- ─── 4. apify_spend: per-day spend ledger ────────────────────────────────────
-- Mirrors public.creative_analysis_spend (per-account LLM ledger): one row per
-- key, spent_usd running total, cap_usd budget cap, RLS on with NO public
-- policies (service role bypasses RLS). Here the key is the DAY (per-day Apify
-- budget) and cap_usd is NULLABLE: NULL means UNCAPPED (owner decision
-- 2026-07-21), distinct from creative_analysis_spend where the cap defaults to 10.
create table if not exists public.apify_spend (
  day        date primary key,
  spent_usd  numeric not null default 0,
  cap_usd    numeric,                     -- NULL = UNCAPPED (owner decision 2026-07-21)
  updated_at timestamptz not null default now()
);

comment on table public.apify_spend is
  'US-001: running Apify capture spend per day. One row per calendar day; cap_usd is the per-day budget cap and is NULLABLE — NULL means UNCAPPED (owner decision 2026-07-21). Mirrors creative_analysis_spend''s style/RLS posture (service-role only).';

alter table public.apify_spend enable row level security;
-- Internal/service-role only — no public policies (service role bypasses RLS),
-- exactly as creative_analysis_spend.

-- Atomically add spend for a day and return the new running total. Mirrors
-- public.add_creative_analysis_spend. Idempotent to (re)create via OR REPLACE.
create or replace function public.add_apify_spend(
  p_day date,
  p_usd numeric
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
begin
  insert into public.apify_spend (day, spent_usd, updated_at)
  values (p_day, greatest(p_usd, 0), now())
  on conflict (day) do update
    set spent_usd  = public.apify_spend.spent_usd + greatest(excluded.spent_usd, 0),
        updated_at = now()
  returning spent_usd into v_total;
  return v_total;
end;
$$;

comment on function public.add_apify_spend(date, numeric) is
  'US-001: atomically add Apify capture spend for a given day and return the new running total. Mirrors add_creative_analysis_spend.';
