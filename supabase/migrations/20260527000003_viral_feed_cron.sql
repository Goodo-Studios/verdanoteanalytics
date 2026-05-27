-- US-004: pg_cron schedule for the global viral feed.
--
-- Verdanote's viral_feed_items table is global (no workspace_id), so a single
-- weekly trigger fans out to vault-viral-cron, which then calls
-- vault-viral-refresh once per platform.
--
-- Prerequisites (run once in SQL editor before this migration if vault secret
-- is not already stored):
--   select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
--
-- Ported from Creative Vault migrations 023 + 024 (combined). Workspace-iteration
-- and workspace-aware RLS policies are NOT ported — the viral_feed_items table
-- has no workspace_id column in Verdanote.

-- ── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ── Unschedule any previous registrations (idempotent) ──────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid FROM cron.job
    WHERE jobname IN (
      'viral-feed-daily',
      'viral-feed-daily-cleanup',
      'viral-feed-weekly',
      'viral-feed-weekly-cleanup'
    )
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END;
$$;

-- ── Cleanup: Saturday 06:55 UTC, 5 min before the weekly refresh ────────────
-- Trending items (search_query = '') expire after 7 days.
-- Seeded search items (search_query != '') expire after 30 days so the
-- library stays populated between weekly runs.
SELECT cron.schedule(
  'viral-feed-weekly-cleanup',
  '55 6 * * 6',
  $$
    DELETE FROM viral_feed_items
    WHERE
      (search_query = ''  AND fetched_at < now() - interval '7 days')
      OR
      (search_query != '' AND fetched_at < now() - interval '30 days');
  $$
);

-- ── Weekly trending refresh — Sunday 07:00 UTC ──────────────────────────────
-- vault-viral-cron fans out to vault-viral-refresh once per platform.
-- Service role key is read from Supabase Vault at runtime — never hardcoded.
SELECT cron.schedule(
  'viral-feed-weekly',
  '0 7 * * 0',
  $$
    SELECT net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/vault-viral-cron',
      headers := json_build_object(
        'Authorization',
        'Bearer ' || (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'service_role_key'
          LIMIT 1
        ),
        'Content-Type', 'application/json'
      )::jsonb,
      body    := '{}'::jsonb
    )
  $$
);

-- ── Verify ──────────────────────────────────────────────────────────────────
-- After running this migration, confirm with:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'viral-feed%';
