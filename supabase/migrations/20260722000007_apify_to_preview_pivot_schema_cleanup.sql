-- =============================================================================
-- Apify → Preview pivot: schema cleanup + vault-parity + cron rewiring
-- =============================================================================
-- ONE additive/idempotent FORWARD migration. Manual `supabase db push --linked`
-- (CI does NOT run migrations — see MIGRATIONS.md). Every statement is guarded
-- (IF EXISTS / IF NOT EXISTS / DO blocks) so a re-apply is a safe no-op.
--
-- Numbering: 20260722000007 follows the remote + local ledger frontier
-- (…20260722000006_apify_capture_drain, confirmed via `supabase migration list
-- --linked`) so ordering is preserved.
--
-- ── The pivot ────────────────────────────────────────────────────────────────
-- The paid Apify per-ad actor is replaced by a FREE preview-extraction capture
-- mechanism. This migration RETIRES the Apify / Ad-Library-id scaffolding added
-- in 20260722000004..0006 and adds full Creative-Vault analysis parity columns.
-- Capture is now free, so the per-day spend ledger is dropped.
--
-- ── Data safety ──────────────────────────────────────────────────────────────
-- Every capture/archive column added in 20260722000004 is UNUSED (nothing has
-- been captured yet — all values NULL/default/0), so the renames and drops here
-- move ZERO data. media_assets.capture_source is all 'meta_api' (no 'apify' rows,
-- verified with one combined read pre-apply), so the CHECK swap validates cleanly.
--
-- ── Downstream note (SQL-only migration; edge fns owned by parallel lanes) ─────
-- The renamed/dropped columns and the dropped apify_spend table are still
-- referenced by live edge fns being rewritten in parallel (apify-capture,
-- apify-capture-drain, drain-media-queue, system-health-check). Those redeploys
-- are OUT OF SCOPE here and tracked in the handoff.
-- =============================================================================

-- ─── 0. Drop dependent indexes FIRST ─────────────────────────────────────────
-- Both indexes reference columns this migration renames/drops. Dropping them up
-- front lets the column DROP/RENAME proceed without CASCADE. Re-created (as the
-- capture queue) after the rename below.
DROP INDEX IF EXISTS public.idx_creatives_apify_capture_queue;   -- referenced apify_capture_status + ad_archive_id_status
DROP INDEX IF EXISTS public.idx_creatives_ad_archive_id_status;  -- referenced ad_archive_id_status (retired resolver queue)

-- ─── 1. Rename capture-bookkeeping columns on creatives (apify_* → capture_*) ─
-- Data-preserving renames (all values NULL/default/0 today). Guarded so a
-- re-apply — where the new name already exists — is a no-op.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='creatives' AND column_name='apify_capture_status')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='creatives' AND column_name='capture_status') THEN
    ALTER TABLE public.creatives RENAME COLUMN apify_capture_status TO capture_status;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='creatives' AND column_name='apify_attempts')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='creatives' AND column_name='capture_attempts') THEN
    ALTER TABLE public.creatives RENAME COLUMN apify_attempts TO capture_attempts;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='creatives' AND column_name='apify_last_attempt_at')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='creatives' AND column_name='capture_last_attempt_at') THEN
    ALTER TABLE public.creatives RENAME COLUMN apify_last_attempt_at TO capture_last_attempt_at;
  END IF;
END $$;

-- Rename the status CHECK constraint to track the new column name. The Postgres
-- column rename above already rewrote the constraint's expression to reference
-- capture_status; here we only fix the constraint NAME. Domain unchanged
-- (null | pending | captured | failed | skipped; NULL = never queued).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname='creatives_apify_capture_status_check' AND conrelid='public.creatives'::regclass)
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname='creatives_capture_status_check' AND conrelid='public.creatives'::regclass) THEN
    ALTER TABLE public.creatives RENAME CONSTRAINT creatives_apify_capture_status_check TO creatives_capture_status_check;
  END IF;
END $$;

COMMENT ON COLUMN public.creatives.capture_status IS
  'Preview pivot (was apify_capture_status): lifecycle of the free preview-extraction capture for this creative. NULL = never queued; ''pending'' = queued/in-flight; ''captured'' = assets fetched via preview; ''failed'' = attempt errored; ''skipped'' = deliberately not captured. Domain enforced by creatives_capture_status_check.';
COMMENT ON COLUMN public.creatives.capture_attempts IS
  'Preview pivot (was apify_attempts): count of preview-capture attempts made for this creative (retry/backoff caps in the preview-capture-drain).';
COMMENT ON COLUMN public.creatives.capture_last_attempt_at IS
  'Preview pivot (was apify_last_attempt_at): timestamp of the most recent preview-capture attempt (drives stale-reclaim / backoff in the preview-capture-drain).';

-- ─── 2. Drop the retired Ad-Library archive-id scaffolding from creatives ─────
-- Preview capture does NOT gate on a Meta Ad Library ad_archive_id, so the
-- resolver columns + their CHECK are dead scaffolding. Unused (all NULL) → safe.
ALTER TABLE public.creatives DROP CONSTRAINT IF EXISTS creatives_ad_archive_id_status_check;
ALTER TABLE public.creatives DROP COLUMN IF EXISTS ad_archive_id;
ALTER TABLE public.creatives DROP COLUMN IF EXISTS ad_archive_id_resolved_at;
ALTER TABLE public.creatives DROP COLUMN IF EXISTS ad_archive_id_status;

-- ─── 3. Re-create the capture-queue index on the renamed column ───────────────
-- Replaces idx_creatives_apify_capture_queue (dropped in section 0, which was
-- predicated on the now-dropped ad_archive_id_status). Preview capture no longer
-- gates on resolution, so the queue is simply capture_status='pending', newest
-- first. Tiny partial index on this large hot table (empty today).
CREATE INDEX IF NOT EXISTS idx_creatives_capture_queue
  ON public.creatives (created_time DESC)
  WHERE capture_status = 'pending';

COMMENT ON INDEX public.idx_creatives_capture_queue IS
  'Preview pivot (replaces idx_creatives_apify_capture_queue): partial index serving the preview-capture-drain queue (capture_status=''pending''), ordered created_time DESC so the drain reads the newest uncaptured creatives off the index.';

-- ─── 4. media_assets.capture_source CHECK: 'apify' → 'preview' ────────────────
-- Provenance value for the new pipeline is 'preview' instead of 'apify'. Default
-- stays 'meta_api'. No rows use 'apify' (verified pre-apply), so re-validating the
-- swapped CHECK is clean. Idempotent: only rewrites the constraint when its
-- current definition still allows 'apify' (so a re-apply does NOT rescan).
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conname='media_assets_capture_source_check' AND conrelid='public.media_assets'::regclass;
  IF v_def IS NULL THEN
    ALTER TABLE public.media_assets
      ADD CONSTRAINT media_assets_capture_source_check CHECK (capture_source IN ('meta_api','preview'));
  ELSIF v_def LIKE '%apify%' THEN
    ALTER TABLE public.media_assets DROP CONSTRAINT media_assets_capture_source_check;
    ALTER TABLE public.media_assets
      ADD CONSTRAINT media_assets_capture_source_check CHECK (capture_source IN ('meta_api','preview'));
  END IF;
  -- else: already the swapped definition → no-op (no rescan).
END $$;

COMMENT ON COLUMN public.media_assets.capture_source IS
  'Preview pivot: pipeline that fetched this asset. ''meta_api'' (default; existing Meta Graph sync) or ''preview'' (free preview-extraction capture). Domain enforced by media_assets_capture_source_check.';

-- ─── 5. Drop the Apify spend ledger (capture is free — no budget ledger) ──────
-- Function first (references the table by name), then the table.
DROP FUNCTION IF EXISTS public.add_apify_spend(date, numeric);
DROP TABLE IF EXISTS public.apify_spend;

-- ─── 6. Vault-parity analysis columns on creatives ───────────────────────────
-- analyze-creative writes framework output to creatives but currently FLATTENS it
-- into strings (ai_hook_analysis / ai_cta_notes) and DROPS the vault's structured
-- fields (framework_json, fill_in_blank_script, and the discrete hook/cta fields).
-- Add the full Creative-Vault framework contract (matching inspiration_frameworks'
-- field names + types) so account-side analysis reaches vault parity and a
-- Save-to-Vault copy is lossless. All nullable → metadata-only adds (no rewrite).
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS copywriting_framework text;
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS hook_type             text;
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS hook_verbal           text;
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS hook_text             text;
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS hook_formula          text;
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS value_structure       text;
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS cta_type              text;
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS cta_formula           text;
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS fill_in_blank_script  text;
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS framework_json        jsonb;

COMMENT ON COLUMN public.creatives.copywriting_framework IS
  'Vault parity (inspiration_frameworks.copywriting_framework): named copywriting framework (12-enum + Other) extracted by analyze-creative. Was dropped in the flattened write.';
COMMENT ON COLUMN public.creatives.hook_type IS
  'Vault parity (inspiration_frameworks.hook_type): bold_claim | pattern_interrupt | honest_admission | question | other. Previously only join-encoded into ai_hook_analysis.';
COMMENT ON COLUMN public.creatives.hook_verbal IS
  'Vault parity (inspiration_frameworks.hook_verbal): spoken hook verbatim from the script (null for image ads). Previously only join-encoded into ai_hook_analysis.';
COMMENT ON COLUMN public.creatives.hook_text IS
  'Vault parity (inspiration_frameworks.hook_text): on-screen text-overlay hook read from the thumbnail (null if none). Previously only join-encoded into ai_hook_analysis.';
COMMENT ON COLUMN public.creatives.hook_formula IS
  'Vault parity (inspiration_frameworks.hook_formula): fill-in-blank hook template ([CLAIM] [TOPIC] [TIMEFRAME] [RESULT]). Previously only join-encoded into ai_hook_analysis.';
COMMENT ON COLUMN public.creatives.value_structure IS
  'Vault parity (inspiration_frameworks.value_structure): one-sentence value structure (list / story / before-after / …). Previously only surfaced as a tag_suggestion.';
COMMENT ON COLUMN public.creatives.cta_type IS
  'Vault parity (inspiration_frameworks.cta_type): comment | follow | visit | dm | save | shop | other. Previously only join-encoded into ai_cta_notes.';
COMMENT ON COLUMN public.creatives.cta_formula IS
  'Vault parity (inspiration_frameworks.cta_formula): fill-in-blank CTA template ([KEYWORD] [PLATFORM] [RESOURCE] [ACTION]). Previously only join-encoded into ai_cta_notes.';
COMMENT ON COLUMN public.creatives.fill_in_blank_script IS
  'Vault parity (inspiration_frameworks.fill_in_blank_script): full script as a reusable fill-in-blank template. Was dropped entirely on the account side.';
COMMENT ON COLUMN public.creatives.framework_json IS
  'Vault parity (inspiration_frameworks.framework_json): raw parsed framework JSON object from analyze-creative. Was dropped entirely on the account side; kept here so nothing is lost.';

-- ─── 7. Cron rewiring: retire the Apify crons, schedule the preview drain ─────
-- Registration lives in THIS migration (cron-evaporation lesson). Unschedule the
-- two retired Apify crons by name (idempotent), then schedule the free
-- preview-capture-drain every 10 min using the EXACT vault-secret idiom the other
-- drain crons use (net.http_post + service_role_key from vault.decrypted_secrets).
-- The preview-capture-drain edge fn is deployed by a parallel lane; until it
-- lands the poke may 404 — acceptable, it self-heals on the next tick.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Unschedule the retired resolver cron (from 20260722000005; already paused in
-- 20260722000006 — re-unscheduling by name is a safe no-op).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'resolve-ad-archive-ids-30min'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;

-- Unschedule the retired Apify capture-drain cron (from 20260722000006).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'apify-capture-drain-10min'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;

-- Schedule the new preview-capture-drain (unschedule-by-name first → idempotent).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'preview-capture-drain-10min'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;

SELECT cron.schedule(
  'preview-capture-drain-10min',
  '*/10 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/preview-capture-drain',
      headers := json_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        'Content-Type', 'application/json'
      )::jsonb,
      body    := '{}'::jsonb
    )
  $$
);

-- ── Verify (run manually after push — ONE combined query) ─────────────────────
--   SELECT
--     (SELECT array_agg(column_name ORDER BY column_name) FROM information_schema.columns
--        WHERE table_schema='public' AND table_name='creatives'
--          AND column_name IN ('capture_status','capture_attempts','capture_last_attempt_at',
--                              'ad_archive_id','ad_archive_id_status','ad_archive_id_resolved_at',
--                              'framework_json','fill_in_blank_script','hook_verbal','hook_text',
--                              'hook_formula','cta_formula','value_structure','copywriting_framework',
--                              'hook_type','cta_type')) AS creatives_cols,
--     (SELECT to_regclass('public.apify_spend')) AS apify_spend,
--     (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='media_assets_capture_source_check') AS capture_source_check,
--     (SELECT array_agg(jobname ORDER BY jobname) FROM cron.job
--        WHERE jobname IN ('preview-capture-drain-10min','apify-capture-drain-10min','resolve-ad-archive-ids-30min')) AS crons;
