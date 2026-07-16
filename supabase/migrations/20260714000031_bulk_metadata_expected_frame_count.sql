-- US-004 follow-up (meta-media-completeness): thread expected_frame_count through the
-- tagged-ad metadata path so tagged carousels / dynamic-creative ads are held to the
-- SAME frames_ok completeness bar as untagged ones.
--
-- Background: the sync's Phase-1 upsertAds() writes new/untagged ads via a direct
-- `creatives` UPSERT that already sets expected_frame_count. Manual/csv-tagged ads,
-- however, are updated METADATA-ONLY (their tags must be preserved) and therefore route
-- through bulk_update_creative_metadata(payload) instead of the upsert. That RPC did NOT
-- touch expected_frame_count, so a tagged carousel captured + rendered its frames but its
-- expected count stayed NULL — making media_coverage.frames_ok trivially TRUE and leaving
-- completeness UNENFORCED for exactly the ads a human has curated. This adds the one
-- column to the RPC's UPDATE so both write paths declare the expectation identically.
--
-- ── Never-guess / no-regression contract (mirrors migration 20260714000027) ──────────
--   * COALESCE((item->>'expected_frame_count')::integer, expected_frame_count) — the value
--     is applied ONLY when the sync includes it in the payload item. The sync includes it
--     ONLY when Meta reports a genuine multi-frame count (>1); a single-asset ad omits the
--     key, so COALESCE keeps the existing value and NEVER overwrites it with NULL. This is
--     byte-for-byte the same "only set when reliable, never clear to null" rule the direct
--     upsert path uses (conditional spread of expected_frame_count).
--   * A single-asset ad therefore keeps expected_frame_count NULL → frames_ok stays
--     trivially TRUE (no regression). Only a >1 count can flip an ad to frames_ok = FALSE,
--     and only when its captured creative_frames COUNT is short — never a false positive.
--
-- Additive + idempotent: CREATE OR REPLACE FUNCTION with the identical signature
-- (payload jsonb) → RETURNS integer, so no dependent object needs recreating and
-- re-running `supabase db push` is a safe no-op. No edge function is added/removed, so
-- scripts/deploy-functions.sh and supabase/config.toml are intentionally untouched.
--
-- Numbering: 20260714000031 follows the latest applied migration on this workstream
-- (…000030_media_coverage_oversized_reason) so ordering is preserved
-- (migration-numbering-order policy).

CREATE OR REPLACE FUNCTION public.bulk_update_creative_metadata(payload jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  updated_count integer := 0;
  item jsonb;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(payload)
  LOOP
    UPDATE public.creatives SET
      ad_name = COALESCE(item->>'ad_name', ad_name),
      ad_status = COALESCE(item->>'ad_status', ad_status),
      campaign_name = item->>'campaign_name',
      adset_name = item->>'adset_name',
      ad_post_url = COALESCE(item->>'ad_post_url', ad_post_url),
      created_time = COALESCE((item->>'created_time')::timestamptz, created_time),
      -- US-004 follow-up: set the expected frame count only when the payload carries it
      -- (the sync includes it only for a genuine >1 multi-frame ad). COALESCE preserves
      -- the existing value when the key is absent/null so a single-asset re-sync never
      -- clears a prior carousel's expectation — matching the direct-upsert write path.
      expected_frame_count = COALESCE((item->>'expected_frame_count')::integer, expected_frame_count)
    WHERE ad_id = item->>'ad_id';

    IF FOUND THEN updated_count := updated_count + 1; END IF;
  END LOOP;

  RETURN updated_count;
END;
$function$;

-- ── Verify after push ─────────────────────────────────────────────────────────────────
-- A tagged carousel gets its expectation set, a single-asset payload does not clobber it:
--   SELECT public.bulk_update_creative_metadata(
--     '[{"ad_id":"<tagged_carousel_ad_id>","expected_frame_count":5}]'::jsonb);
--   SELECT ad_id, expected_frame_count FROM public.creatives WHERE ad_id = '<tagged_carousel_ad_id>';
--   -- expected_frame_count = 5
--   SELECT public.bulk_update_creative_metadata(
--     '[{"ad_id":"<tagged_carousel_ad_id>","ad_name":"renamed"}]'::jsonb);  -- no frame key
--   SELECT expected_frame_count FROM public.creatives WHERE ad_id = '<tagged_carousel_ad_id>';
--   -- still 5 (COALESCE preserved it — never cleared to NULL)
