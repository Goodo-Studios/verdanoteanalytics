-- Landing Pages report (Creative Terminal — Phase 1, Feature 1), foundation F4.
-- Adds the ad's destination URL to creatives. This did NOT exist on creatives
-- before (landing_page_url lives on ad_library_saved_ads, a different table).
-- The value is sourced from Meta's object_story_spec (link_data.link, video CTA
-- link, template_data.link, asset_feed_spec, or first carousel child link) by the
-- backfill-destination-key function and, going forward, by the sync pipeline.
-- Additive, backwards-compatible, idempotent.

ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS landing_page_url TEXT;

COMMENT ON COLUMN public.creatives.landing_page_url IS
  'The ad''s click destination, sourced from Meta object_story_spec. Normalized into destination_key for the Landing Pages report.';
