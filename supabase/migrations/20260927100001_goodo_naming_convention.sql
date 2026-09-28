-- Goodo ad naming convention becomes the Verdanote convention (2026-09-27).
--
-- Ad names from the Goodo generator have 7 "_" segments:
--   0 unique_code | 1 ad_type | 2 person | 3 style ("Creative Type") | 4 product | 5 hook | 6 theme
-- product, hook and theme are FREE TEXT: any non-empty token is accepted (a
-- token that matches vocab still maps to the vocab canonical). The edge-function
-- parser (_shared/parse-ad-name.ts) reads the new segment flag `free_text`.
--
-- What this migration does (all idempotent; nothing in creatives is deleted and
-- no tag column is rewritten — changes apply to future parses only):
--   1. naming_convention_segments.free_text boolean NOT NULL DEFAULT false.
--   2. get_convention() emits free_text per segment. Body is otherwise the
--      20260529000002 definition verbatim (same caller-scoping gate, grants).
--   3. GLOBAL convention: segments 0..6 in contract order; 4/5/6 free_text.
--   4. GLOBAL vocab: ad_type canonical 'Image' is replaced by 'Static' (Image,
--      Photo, IMG are aliases), 'GIF' added; person vocab added; style
--      StudioClean/TextForward/Lifestyle added; UGCNative aliases widened.
--      Legacy style/hook/theme entries are kept. Stored display forms are
--      produced by _shared/ad-name-display.ts (UGCNative -> "UGC Native",
--      NoTalent -> "No Talent", ...), so canonicals stay CamelCase tokens.
--   5. Goodo override (act_782159176742035) is REMOVED so Goodo resolves to the
--      global convention, which now is the Goodo convention. The override only
--      declared segments 0/1 + an 'Image' ad_type vocab; get_convention returns
--      override OR global (never merged), so keeping it would hide segments 2..6
--      from Goodo, and keeping a copy would drift from global. Deleting it only
--      removes those three config tables' rows (ON DELETE CASCADE from
--      naming_conventions to its segments/vocab); no creatives data is touched.
--      Other account overrides (bartesian, belliwelli, galileo, sewing,
--      naturaldog, earthing) are left alone.
--   6. creatives.parsed_ad_name text NULL: the ad name the current tags were
--      last auto-parsed from. Sync re-parses a 'parsed'/'untagged' creative when
--      ad_name <> parsed_ad_name (rename detection; NULL = never parsed = new ad).
--      Existing 'parsed'/'untagged' rows are baselined to their current ad_name
--      so this release does NOT re-tag existing ads (no catch-up/backfill);
--      only ads created or renamed after it are auto-parsed.

-- 1. free_text flag --------------------------------------------------------
ALTER TABLE public.naming_convention_segments
  ADD COLUMN IF NOT EXISTS free_text BOOLEAN NOT NULL DEFAULT false;

-- 2. resolver emits free_text ----------------------------------------------
CREATE OR REPLACE FUNCTION public.get_convention(p_account_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_convention public.naming_conventions%ROWTYPE;
  v_result     jsonb;
  v_account_id text := NULLIF(p_account_id, '');
BEGIN
  -- CALLER-SCOPING GATE (must run BEFORE any override is resolved/returned).
  -- This function is SECURITY DEFINER and GRANTed to `authenticated`, so it
  -- bypasses the table RLS that scopes per-account override SELECTs. Without
  -- this gate, any logged-in client could pass another account's id and read
  -- that account's override convention (cross-account IDOR). service_role
  -- (the US-002 ingest/parser path) must still resolve ANY account, so it is
  -- intentionally exempt. For everyone else, an account_id the caller is not a
  -- member of is downgraded to NULL so resolution falls back to the GLOBAL
  -- default convention rather than leaking another account's config.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF v_account_id IS NOT NULL
       AND v_account_id NOT IN (SELECT public.get_user_account_ids(auth.uid())) THEN
      v_account_id := NULL;
    END IF;
  END IF;

  -- Prefer a per-account override; fall back to the global default.
  IF v_account_id IS NOT NULL THEN
    SELECT * INTO v_convention
    FROM public.naming_conventions
    WHERE account_id = v_account_id
    LIMIT 1;
  END IF;

  IF v_convention.id IS NULL THEN
    SELECT * INTO v_convention
    FROM public.naming_conventions
    WHERE account_id IS NULL
    LIMIT 1;
  END IF;

  IF v_convention.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'id',         v_convention.id,
    'account_id', v_convention.account_id,
    'scope',      CASE WHEN v_convention.account_id IS NULL THEN 'global' ELSE 'override' END,
    'separator',  v_convention.separator,
    'segments',   COALESCE(
      (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'position',  s.position,
                   'dimension', s.dimension,
                   'required',  s.required,
                   'free_text', s.free_text
                 ) ORDER BY s.position
               )
        FROM public.naming_convention_segments s
        WHERE s.convention_id = v_convention.id
      ),
      '[]'::jsonb
    ),
    'vocab',      COALESCE(
      (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'dimension', v.dimension,
                   'canonical', v.canonical,
                   'aliases',   to_jsonb(v.aliases)
                 ) ORDER BY v.dimension, v.canonical
               )
        FROM public.naming_convention_vocab v
        WHERE v.convention_id = v_convention.id
      ),
      '[]'::jsonb
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_convention(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_convention(text) TO service_role;

-- 3 + 4. GLOBAL convention segments + vocab --------------------------------
DO $$
DECLARE
  gid uuid;
BEGIN
  SELECT id INTO gid FROM public.naming_conventions WHERE account_id IS NULL LIMIT 1;
  IF gid IS NULL THEN
    INSERT INTO public.naming_conventions (account_id, separator)
      VALUES (NULL, '_')
      RETURNING id INTO gid;
  END IF;

  INSERT INTO public.naming_convention_segments (convention_id, position, dimension, required, free_text)
  VALUES
    (gid, 0, 'unique_code', true,  false),
    (gid, 1, 'ad_type',     false, false),
    (gid, 2, 'person',      false, false),
    (gid, 3, 'style',       false, false),
    (gid, 4, 'product',     false, true),
    (gid, 5, 'hook',        false, true),
    (gid, 6, 'theme',       false, true)
  ON CONFLICT (convention_id, position)
    DO UPDATE SET dimension = EXCLUDED.dimension,
                  required  = EXCLUDED.required,
                  free_text = EXCLUDED.free_text;

  -- 'Static' replaces 'Image' as the ad_type canonical. The old row listed
  -- 'Static' as an alias of 'Image'; both rows cannot coexist without an
  -- ambiguous alias, so the 'Image' config row goes (Image stays an alias).
  DELETE FROM public.naming_convention_vocab
    WHERE convention_id = gid AND dimension = 'ad_type' AND canonical = 'Image';

  INSERT INTO public.naming_convention_vocab (convention_id, dimension, canonical, aliases)
  VALUES
    -- ad_type
    (gid, 'ad_type', 'Video',       ARRAY['video','VID']),
    (gid, 'ad_type', 'Static',      ARRAY['static','Image','image','IMG','Photo','photo']),
    (gid, 'ad_type', 'GIF',         ARRAY['gif','Gif']),
    (gid, 'ad_type', 'Carousel',    ARRAY['carousel']),
    -- person
    (gid, 'person',  'Creator',     ARRAY['creator']),
    (gid, 'person',  'Customer',    ARRAY['customer']),
    (gid, 'person',  'Founder',     ARRAY['founder']),
    (gid, 'person',  'Actor',       ARRAY['actor']),
    (gid, 'person',  'NoTalent',    ARRAY['No Talent','No-Talent','notalent']),
    -- style ("Creative Type")
    (gid, 'style',   'UGCNative',   ARRAY['UGC','ugc','UGCnative','UGC-Native','UGC Native']),
    (gid, 'style',   'StudioClean', ARRAY['Studio','studio','Studio Clean','Studio-Clean']),
    (gid, 'style',   'TextForward', ARRAY['Text Forward','Text-Forward']),
    (gid, 'style',   'Lifestyle',   ARRAY['lifestyle'])
  ON CONFLICT (convention_id, dimension, canonical)
    DO UPDATE SET aliases = EXCLUDED.aliases;
  -- Legacy global entries (style Testimonial/Founder/Animation, hook
  -- Problem/Callout/Question/Discount, theme Lifestyle/Benefit/SocialProof) are
  -- intentionally left in place.
END $$;

-- 5. Goodo resolves to the global convention -------------------------------
DELETE FROM public.naming_conventions WHERE account_id = 'act_782159176742035';

-- 6. rename detection --------------------------------------------------------
ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS parsed_ad_name TEXT;

COMMENT ON COLUMN public.creatives.parsed_ad_name IS
  'Ad name the current tags were last auto-parsed from. Sync re-parses tag_source parsed/untagged rows when ad_name differs. NULL = never parsed.';

-- Baseline existing rows once so this release does not re-tag them. Only rows
-- still NULL are touched, so a re-run never moves an existing baseline.
-- This bookkeeping write changes neither updated_at-relevant data nor
-- tag_source, so the two row triggers are suspended for it:
--   update_creatives_updated_at          — would bump every updated_at
--   trg_refresh_account_creative_counts  — recounts the account per row, which
--                                          made an 18k-row baseline exceed the
--                                          statement timeout; counts are
--                                          unchanged by this write.
-- Only triggers that are currently enabled are suspended and re-enabled.
DO $$
DECLARE
  t text;
  suspended text[] := ARRAY[]::text[];
BEGIN
  SET LOCAL statement_timeout = '10min';

  FOREACH t IN ARRAY ARRAY['update_creatives_updated_at', 'trg_refresh_account_creative_counts'] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.creatives'::regclass
        AND tgname = t
        AND NOT tgisinternal
        AND tgenabled <> 'D'
    ) THEN
      EXECUTE format('ALTER TABLE public.creatives DISABLE TRIGGER %I', t);
      suspended := suspended || t;
    END IF;
  END LOOP;

  UPDATE public.creatives
     SET parsed_ad_name = ad_name
   WHERE parsed_ad_name IS NULL
     AND tag_source IN ('parsed', 'untagged');

  FOREACH t IN ARRAY suspended LOOP
    EXECUTE format('ALTER TABLE public.creatives ENABLE TRIGGER %I', t);
  END LOOP;
END $$;
