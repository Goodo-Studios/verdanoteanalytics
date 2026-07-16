-- US-004 (meta-media-completeness): Carousel frame capture — capture EVERY frame,
-- not just the first, and hold the coverage metric honest about it.
--
-- Foundation: today a carousel ad's coverage keys only off its single
-- thumbnail_url / full_res_url, so a 5-card carousel with only card #1 cached reads
-- as "covered". This migration introduces the ordered per-frame ledger the sync
-- will populate (one row per captured frame), records the EXPECTED frame count on
-- the creative, and tightens the media_coverage view so an ad missing any expected
-- frame is NOT frames_ok.
--
-- ── Two additive pieces ───────────────────────────────────────────────────────
--   1. public.creative_frames — junction/child table: one row per captured frame of
--      an ad, ordered by frame_index, each referencing the shared media_assets
--      content-hash row (US-009). This is the "captured frames" side.
--   2. public.creatives.expected_frame_count — the EXPECTED number of frames for the
--      ad (how many cards/frames Meta reports). This is the "expected" side. The
--      creatives table has no pre-existing structural carousel indicator (ad_type is
--      a human/CSV tag, ad_format is not stored on creatives), so the sync declares
--      the expected count here. frames_ok compares captured COUNT vs this expected.
--
-- ── frames_ok contract (mirrors _shared/media-discovery.ts) ───────────────────
--   frames_ok = TRUE  when the ad declares no multi-frame expectation
--                     (expected_frame_count IS NULL OR <= 1) — a single-image /
--                     single-video ad is trivially frame-complete (NO REGRESSION:
--                     every ad synced before US-004 has expected_frame_count NULL and
--                     stays frames_ok = TRUE, so covered is unchanged for them).
--   frames_ok = TRUE  when the ad expects N (>1) frames AND at least N creative_frames
--                     rows are captured for it.
--   frames_ok = FALSE when the ad expects N (>1) frames but fewer than N are captured
--                     (a carousel missing any frame) → failure_reason 'frames_incomplete'.
--   covered   = image_ok AND video_ok AND frames_ok (unchanged shape).
--
-- Additive + idempotent + backwards-compatible: CREATE TABLE / ADD COLUMN IF NOT
-- EXISTS, guarded constraints/policies, CREATE OR REPLACE VIEW. The media_coverage
-- view's column list is UNCHANGED, so the dependent get_media_coverage RPC does not
-- need recreating. Re-running `supabase db push` is a safe no-op that reconciles the
-- ledger cleanly (per verdanote-supabase-ledger-drift-reconcile-with-db-push).
--
-- No edge function is added/removed, so scripts/deploy-functions.sh and
-- supabase/config.toml are intentionally untouched (per
-- verdanote-supabase-add-function policy).
--
-- Numbering: 20260714000027 follows the latest applied migration
-- (…000026_media_coverage_video_reasons) so ordering is preserved
-- (migration-numbering-order policy).

-- ── 1. creative_frames junction/child table ──────────────────────────────────
-- One row per captured frame of an ad. ad_id TEXT matches creatives.ad_id
-- (TEXT PRIMARY KEY); ON DELETE CASCADE so a creative's frames are cleaned up with
-- it. asset_id → media_assets(id) (UUID) is the shared per-account content-hash row
-- (US-009); ON DELETE SET NULL so GC'ing an asset never loses the frame ordering.
-- frame_index is 0-based to match scrape-ad/index.ts, which stores frames at an
-- incrementing `position` starting at 0 (and its 'carousel_frame' media type). The
-- ordered (ad_id, frame_index) is UNIQUE so a re-sync upserts a frame in place
-- rather than duplicating it — COUNT(*) then equals the number of distinct captured
-- frames, which is what frames_ok compares against.
CREATE TABLE IF NOT EXISTS public.creative_frames (
  id           UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ad_id        TEXT NOT NULL REFERENCES public.creatives(ad_id) ON DELETE CASCADE,
  frame_index  INTEGER NOT NULL,                    -- 0-based ordered position (matches scrape-ad `position`)
  media_type   TEXT NOT NULL DEFAULT 'image'        -- per-frame kind; mirrors scrape-ad media types
                 CHECK (media_type IN ('image', 'video', 'carousel_frame', 'video_thumbnail')),
  asset_id     UUID REFERENCES public.media_assets(id) ON DELETE SET NULL,  -- shared content-hash asset (US-009)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Ordered-frame identity: one row per (ad, frame position). A re-sync upserts in
  -- place, so COUNT(*) per ad_id is the count of DISTINCT captured frames.
  CONSTRAINT creative_frames_ad_frame_unique UNIQUE (ad_id, frame_index),
  -- 0-based ordering guard.
  CONSTRAINT creative_frames_frame_index_nonneg CHECK (frame_index >= 0)
);

COMMENT ON TABLE public.creative_frames IS
  'US-004 (meta-media-completeness): ordered per-frame capture ledger. One row per captured frame of an ad (ad_id → creatives.ad_id), ordered by 0-based frame_index (matches scrape-ad ''position''), each referencing the shared per-account content-hash asset in media_assets (US-009). COUNT(*) per ad_id = distinct captured frames, compared against creatives.expected_frame_count by the media_coverage view''s frames_ok.';
COMMENT ON COLUMN public.creative_frames.frame_index IS
  'US-004: 0-based ordered position of this frame within the ad, matching scrape-ad/index.ts which stores frames at an incrementing `position` from 0. UNIQUE with ad_id so a re-sync upserts a frame in place.';
COMMENT ON COLUMN public.creative_frames.media_type IS
  'US-004: kind of this frame, mirroring the scrape-ad media types (''image'' | ''video'' | ''carousel_frame'' | ''video_thumbnail''). Defaults ''image''. Carousel cards are typically ''carousel_frame''.';
COMMENT ON COLUMN public.creative_frames.asset_id IS
  'US-004: FK to the shared per-account content-hash asset in public.media_assets (US-009). ON DELETE SET NULL so GC''ing an asset preserves the frame''s ordering slot.';

-- Lookup index on ad_id (the frames_ok COUNT(*) join key and the natural fetch key
-- for rendering all frames of an ad in order).
CREATE INDEX IF NOT EXISTS idx_creative_frames_ad
  ON public.creative_frames (ad_id);
CREATE INDEX IF NOT EXISTS idx_creative_frames_asset
  ON public.creative_frames (asset_id);

-- updated_at trigger, mirroring every other table in this schema.
DROP TRIGGER IF EXISTS update_creative_frames_updated_at ON public.creative_frames;
CREATE TRIGGER update_creative_frames_updated_at
  BEFORE UPDATE ON public.creative_frames
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── RLS ────────────────────────────────────────────────────────────────────────
-- Mirrors the media_assets policy set (US-009): the service-role edge functions
-- (sync / scrape) that write frames bypass RLS entirely; builders/employees manage,
-- and clients may only read frames for ads whose account they are linked to. The
-- account linkage is resolved through the parent creatives row (creative_frames has
-- no account_id of its own — it inherits the ad's account, keeping tenant isolation
-- single-sourced on creatives.account_id).
ALTER TABLE public.creative_frames ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Builder/employee can manage creative_frames" ON public.creative_frames;
CREATE POLICY "Builder/employee can manage creative_frames"
  ON public.creative_frames FOR ALL
  USING (has_role(auth.uid(), 'builder'::app_role) OR has_role(auth.uid(), 'employee'::app_role));

DROP POLICY IF EXISTS "Client can view linked creative_frames" ON public.creative_frames;
CREATE POLICY "Client can view linked creative_frames"
  ON public.creative_frames FOR SELECT
  USING (
    has_role(auth.uid(), 'client'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.creatives c
      WHERE c.ad_id = creative_frames.ad_id
        AND c.account_id IN (SELECT get_user_account_ids(auth.uid()))
    )
  );

-- ── 2. creatives.expected_frame_count ─────────────────────────────────────────
-- The EXPECTED number of frames for this ad, declared by the sync (how many
-- cards/frames Meta reports for the creative). NULL = no multi-frame expectation
-- recorded yet (every pre-US-004 row, and every single-asset ad) → frames_ok stays
-- TRUE. A single-image/single-video ad the sync sees as 1 frame may be written as 1
-- (also frames_ok-trivial). >1 declares a carousel/multi-frame ad whose captured
-- creative_frames COUNT must reach it to be frames_ok.
ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS expected_frame_count INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'creatives_expected_frame_count_nonneg'
      AND conrelid = 'public.creatives'::regclass
  ) THEN
    ALTER TABLE public.creatives
      ADD CONSTRAINT creatives_expected_frame_count_nonneg
      CHECK (expected_frame_count IS NULL OR expected_frame_count >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.creatives.expected_frame_count IS
  'US-004 (meta-media-completeness): expected number of frames for this ad, declared by the sync (Meta''s reported carousel-card / frame count). NULL or <=1 = no multi-frame expectation (single-asset ad; also every pre-US-004 row) → frames_ok trivially TRUE (no regression). >1 = a carousel/multi-frame ad whose captured public.creative_frames COUNT must reach this value to be frames_ok.';

-- ── 3. Tighten media_coverage.frames_ok ───────────────────────────────────────
-- Replace the placeholder TRUE frames_ok with the real "every expected frame present"
-- check. The frames CTE LEFT JOINs the captured-frame COUNT per ad and compares it
-- against creatives.expected_frame_count. Everything else in the view is UNCHANGED
-- from US-003 (…000026), so the column list is identical and get_media_coverage does
-- not need recreating. The frames subquery is written to degrade gracefully if
-- creative_frames is somehow absent (to_regclass NULL → treat captured = 0, which is
-- still frames_ok = TRUE for any ad with expected_frame_count NULL/<=1, i.e. all
-- pre-US-004 rows) — but under normal apply order the table exists here.
CREATE OR REPLACE VIEW public.media_coverage AS
WITH eligible AS (
  SELECT
    c.ad_id,
    c.account_id,
    c.ad_name,
    c.ad_status,
    c.impressions,
    c.thumbnail_url,
    c.full_res_url,
    c.video_url,
    c.expected_frame_count
  FROM public.creatives c
  WHERE COALESCE(UPPER(c.ad_status), 'UNKNOWN') <> 'ARCHIVED'
    AND COALESCE(c.impressions, 0) > 0
),
classified AS (
  SELECT
    e.*,
    (
      e.full_res_url IS NOT NULL
      AND e.full_res_url <> 'no-thumbnail'
    ) AS image_ok,
    (
      e.video_url IS NOT NULL
    ) AS is_video_ad,
    -- video_ok: non-video ad (trivially ok) OR a cached, playable video. UNCHANGED
    -- from US-001/US-003: the cached signal is a Supabase Storage public URL; every
    -- no-video* sentinel is a plain string that fails the storage-url LIKE.
    (
      e.video_url IS NULL
      OR e.video_url LIKE '%/storage/v1/object/public/%'
    ) AS video_ok
  FROM eligible e
),
frame_counts AS (
  -- Captured frame count per ad. LEFT JOIN below so ads with no captured frames get 0.
  SELECT cf.ad_id, COUNT(*)::int AS captured_frames
  FROM public.creative_frames cf
  GROUP BY cf.ad_id
),
frames AS (
  -- US-004: frames_ok = the ad declares no multi-frame expectation
  -- (expected_frame_count IS NULL or <= 1 → single-asset, trivially frame-complete;
  -- NO REGRESSION for pre-US-004 rows), OR it expects N (>1) frames and at least N
  -- were captured. A carousel expecting N (>1) with fewer captured is NOT frames_ok.
  SELECT
    cl.*,
    COALESCE(fc.captured_frames, 0) AS captured_frames,
    (
      cl.expected_frame_count IS NULL
      OR cl.expected_frame_count <= 1
      OR COALESCE(fc.captured_frames, 0) >= cl.expected_frame_count
    ) AS frames_ok
  FROM classified cl
  LEFT JOIN frame_counts fc ON fc.ad_id = cl.ad_id
)
SELECT
  f.ad_id,
  f.account_id,
  f.ad_name,
  f.ad_status,
  f.impressions,
  f.image_ok,
  f.video_ok,
  f.frames_ok,
  f.is_video_ad,
  (f.image_ok AND f.video_ok AND f.frames_ok) AS covered,
  CASE
    WHEN (f.image_ok AND f.video_ok AND f.frames_ok) THEN NULL
    WHEN NOT f.image_ok
      AND (f.full_res_url IS NULL OR f.full_res_url = 'no-thumbnail')
      AND f.thumbnail_url IS NOT NULL
      AND f.thumbnail_url <> 'no-thumbnail'
      THEN 'image_low_res'
    WHEN NOT f.image_ok AND f.thumbnail_url = 'no-thumbnail' THEN 'image_missing'
    WHEN NOT f.image_ok THEN 'image_missing'
    -- US-003: distinct honest video-failure reasons (terminal sentinels first).
    WHEN NOT f.video_ok AND f.video_url = 'no-video-permission' THEN 'video_permission'
    WHEN NOT f.video_ok AND f.video_url = 'no-video-deleted' THEN 'video_deleted'
    WHEN NOT f.video_ok AND f.video_url = 'no-video' THEN 'video_unresolved'
    WHEN NOT f.video_ok THEN 'video_uncached'   -- live CDN url, never cached
    -- US-004: a carousel/multi-frame ad missing at least one expected frame.
    WHEN NOT f.frames_ok THEN 'frames_incomplete'
    ELSE 'unknown'
  END AS failure_reason
FROM frames f;

COMMENT ON VIEW public.media_coverage IS
  'US-001/US-003/US-004 (meta-media-completeness): per-creative media coverage over the ELIGIBLE universe (non-archived, impressions>0). image_ok = a cached full-res image; video_ok = non-video ad OR a cached playable storage video (every no-video* sentinel is NOT video_ok); frames_ok = the ad declares no multi-frame expectation (creatives.expected_frame_count NULL/<=1 → trivially TRUE, no regression) OR it expects N>1 frames and at least N public.creative_frames rows are captured (a carousel missing any frame is NOT frames_ok → failure_reason ''frames_incomplete''). covered = image_ok AND video_ok AND frames_ok. covered + not-covered = eligible, always.';

-- ── Verify ──────────────────────────────────────────────────────────────────
-- After running this migration, confirm with:
--   \d public.creative_frames                       -- table + constraints present
--   SELECT policyname FROM pg_policies WHERE tablename = 'creative_frames';
--   -- carousels currently missing frames (the US-004 backend backfill target):
--   SELECT mc.ad_id, mc.frames_ok, c.expected_frame_count,
--          (SELECT count(*) FROM public.creative_frames cf WHERE cf.ad_id = mc.ad_id) AS captured
--     FROM public.media_coverage mc
--     JOIN public.creatives c ON c.ad_id = mc.ad_id
--     WHERE NOT mc.frames_ok;
--   SELECT frames_ok, count(*) FROM public.media_coverage GROUP BY frames_ok;
--   SELECT * FROM public.get_media_coverage(NULL);  -- aggregate + per-account
-- Invariant: an ad with expected_frame_count NULL or <=1 is ALWAYS frames_ok
-- (no regression); a carousel with expected_frame_count N>1 is frames_ok iff it has
-- >= N captured creative_frames rows.
