-- =============================================================================
-- media_meta_cache — short-TTL cache for the drain's expensive per-invocation Meta
-- lookups (kills the recurring "#4 Application request limit reached" spiral)
-- =============================================================================
-- Idempotent + additive (CREATE TABLE / guarded policy IF NOT EXISTS). Manual
-- `supabase db push --linked`.
--
-- WHY: drain-media-queue self-chains a FRESH edge-function invocation per small
-- batch (BATCH_SIZE ads). Each invocation of drainOnce rebuilds two Meta-heavy
-- lookups from scratch:
--   • the assigned-Page token map (GET /me/accounts) — fetchPageTokenMap, and
--   • the per-account video-library map (paginates GET /{account}/advideos, up to
--     50 pages of 100) — fetchAccountVideoMap.
-- Draining a large backlog (thousands of pending ads) therefore rebuilds those maps
-- HUNDREDS of times — the dominant source of Meta app-level rate-limit (#4)
-- throttling that stalls the whole pipeline (and, for permission-heavy accounts, the
-- video-library map does not even help: page-owned video is not in the account
-- library, so the rebuild is pure wasted budget). This table lets the whole
-- self-chain reuse ONE build per key within a short TTL instead of rebuilding every
-- batch. TS accessors: supabase/functions/_shared/media-map-cache.ts.
--
-- CONTRACT (see media-map-cache.ts):
--   • cache_key  — 'pagetokenmap' (global) or 'videomap:{account_id}' (per account).
--   • payload    — a flat { string: string } map (video_id→source, or page_id→token),
--                  stored as jsonb.
--   • expires_at — hard TTL; a read past expiry is a MISS (the accessor rebuilds).
--   • The cache is a pure OPTIMIZATION: every accessor swallows errors and treats a
--     miss/absent-table as "no cache" → build fresh (identical to today's behavior).
--     Only a NON-EMPTY build is written, so a throttle-during-build (which yields an
--     empty map) is never cached as if it were the real, complete data.
--
-- SECURITY: the 'pagetokenmap' payload holds Facebook Page ACCESS TOKENS. RLS is
-- enabled with NO anon/authenticated policy, so ONLY the service role (which bypasses
-- RLS) can read/write this table — the exact trust boundary that already holds the
-- master system-user token in public.settings. Do not add a client-facing policy.
--
-- Numbering: 20260718000001 follows the latest applied migration
-- (…20260717000005_reenable_media_crons_guarded) so ordering is preserved
-- (migration-numbering-order policy). No edge function is added/removed, so
-- scripts/deploy-functions.sh and supabase/config.toml are intentionally untouched.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.media_meta_cache (
  cache_key   TEXT PRIMARY KEY,
  payload     JSONB NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.media_meta_cache IS
  'Short-TTL cache for drain-media-queue''s expensive per-invocation Meta lookups (assigned-Page token map ''pagetokenmap'', per-account video-library map ''videomap:{account_id}''). Lets a self-chaining drain reuse ONE build per key across the whole chain instead of rebuilding every batch — the fix for the #4 rate-limit spiral at backlog scale. Pure optimization: a miss/expiry rebuilds. Service-role only (RLS, no client policy) because ''pagetokenmap'' holds Page access tokens. Accessors: _shared/media-map-cache.ts.';
COMMENT ON COLUMN public.media_meta_cache.cache_key IS
  '''pagetokenmap'' (global assigned-Page → access-token map) or ''videomap:{account_id}'' (per-account video_id → CDN source map).';
COMMENT ON COLUMN public.media_meta_cache.payload IS
  'Flat { string: string } map stored as jsonb (page_id→token or video_id→source). Only a non-empty build is written (an empty build usually means a throttle, which must not be cached as real data).';
COMMENT ON COLUMN public.media_meta_cache.expires_at IS
  'Hard TTL. A read at/after this instant is a cache MISS and triggers a rebuild. Video-library maps use ~20m (CDN sources stay valid for hours); the page-token map uses ~30m (the assigned-Page set changes rarely).';

-- Service-role-only access: enable RLS and add NO anon/authenticated policy. The
-- service role bypasses RLS, so the drain (service role) can read/write while every
-- client role is denied — required because 'pagetokenmap' stores Page access tokens.
ALTER TABLE public.media_meta_cache ENABLE ROW LEVEL SECURITY;

-- Housekeeping index for an optional periodic prune of expired rows (the accessors
-- also overwrite in place on rebuild, so the table stays tiny regardless).
CREATE INDEX IF NOT EXISTS idx_media_meta_cache_expires_at
  ON public.media_meta_cache (expires_at);

-- =============================================================================
-- Verify:
--   \d public.media_meta_cache
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'media_meta_cache';  -- t
--   SELECT policyname FROM pg_policies WHERE tablename = 'media_meta_cache'; -- none
-- Invariant: only the service role can touch this table; a miss/expiry rebuilds, so
-- deleting all rows is always safe (the drain just repopulates on the next batch).
-- =============================================================================
