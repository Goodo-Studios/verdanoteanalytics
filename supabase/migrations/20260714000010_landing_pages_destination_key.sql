-- Landing Pages report (Creative Terminal — Phase 1, Feature 1), foundation F4.
-- Adds a canonical destination key to creatives so ads pointing at the same page
-- via different UTM / tracking links consolidate into one destination in the
-- Landing Pages report. Purely additive, backwards-compatible, and idempotent.
--
-- Numbered 20260714000010 to land after the migrations already applied to prod
-- today (…000001–…000009) and avoid the version-number collision that would
-- otherwise make db push silently skip this file
-- (per verdanote-db-push-matches-by-version-number-collision-skips).
--
-- destination_key is computed by supabase/functions/_shared/normalize-destination.ts
-- (utm_* and click-id params stripped, host lowercased, fragment + trailing slash
-- removed). It is populated by a backfill (builder account first) and, going
-- forward, by the sync pipeline when landing_page_url is written. NULL means the
-- creative has no usable destination and is excluded from the report.

ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS destination_key TEXT;

-- Report reads roll daily metrics up to (account_id, destination_key), so index that grain.
CREATE INDEX IF NOT EXISTS idx_creatives_account_destination
  ON public.creatives(account_id, destination_key);

COMMENT ON COLUMN public.creatives.destination_key IS
  'Canonical landing-page destination (UTM/tracking params stripped) for the Landing Pages report. NULL = no usable destination. Computed by _shared/normalize-destination.ts.';
