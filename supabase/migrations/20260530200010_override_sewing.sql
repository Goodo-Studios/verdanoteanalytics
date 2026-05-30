-- US-010: Sewing Parts Online (act_26608804) naming-convention override.
--
-- Sewing's named creatives use a stable underscore convention whose third token
-- (positional index 2) is a two-letter media-type code, e.g.
--   11.26_SEWINGPARTS_LV_BRAND_DICKSON-STORE_BFCM-SALE_BOB-MAGGIE-RETAIL-STORE-V2
--   8.1_SEWINGPARTS_SI_PLACEMENT-OPTIMIZED_PDP_KOOKABURRA_SALE_..._GET-OFFER
-- token[0] is a publish date (e.g. "11.26", "5.8.26"), token[1] is the constant
-- account marker "SEWINGPARTS", and token[2] is the ad_type code. The code's
-- second letter denotes the media type: "V" = video, "I" = image. This override
-- declares a single ad_type segment at position 2 and supplies the ad_type
-- vocabulary that canonicalizes the account-local codes:
--   LV / MV / SV  -> Video   (long / motion / short video; the GIF creatives
--                              observed in the data also carry SV and are
--                              animated, so Video is the correct bucket)
--   SI            -> Image    (static image)
--   CA            -> Carousel
-- The global Static/Photo -> Image canonicalization is preserved in the Image
-- aliases. The remaining tokens (placement, page-type, product, theme, hook,
-- call-to-action) are not positionally stable across the 7- and 12/13-token
-- variants and are intentionally left unmapped; the single parser is
-- positional-only and unmatched tokens surface as harmless null tags.
--
-- Scope of the gain: this is a genuine COVERAGE LIFT, not merely a tag_source
-- quality upgrade. Of the account's 365 ad_names, 224 previously-untagged rows
-- carry a recognizable position-2 ad_type code and were freshly resolved to
-- parsed (untagged -> parsed), and the 116 pre-existing heuristic 'inferred'
-- rows all carry the same position-2 code and were upgraded inferred -> parsed
-- (derived from the authoritative convention rather than inference). Coverage
-- rose from 31.78% (116/365, all inferred) to 93.15% (340/365, all parsed).
-- The 25 rows that remain untagged carry no mappable position-2 code (24 are
-- date-or-numeric/free-text names with no media-type token at position 2, and
-- one carries a "PARTNERSHIP" token at position 2 that is not an ad_type); they
-- correctly remain untagged. Net effect: +224 newly-tagged rows, full
-- inferred -> parsed promotion of the existing 116, and zero
-- inferred -> untagged demotions (the US-001 no-demote guard reported
-- protected=0 because every inferred row resolved to a real tag).
--
-- unique_code remains the first separator-split token (position 0) per the
-- parser contract; it is the creatives join key and is unaffected by this
-- ad_type segment. (Position 0 here is the publish-date token; that is the
-- account's existing join-key behaviour and is not changed by this override.)
--
-- Idempotent: re-running is a no-op. The convention row is guarded by an
-- existence check (the partial unique index on account_id cannot be targeted by
-- ON CONFLICT), and segments/vocab use ON CONFLICT against their real UNIQUE
-- constraints.
--
-- Applied to production via service-role PostgREST during US-010 (the analytics
-- project has no local DB password / `supabase db push` path); this file is the
-- committed repo artifact of that production change. The guarded backfill-retag
-- function (US-001 no-demote guard) was already live in production at apply
-- time, having been deployed during US-008.

DO $$
DECLARE
  cid uuid;
BEGIN
  SELECT id INTO cid
    FROM public.naming_conventions
    WHERE account_id = 'act_26608804';

  IF cid IS NULL THEN
    INSERT INTO public.naming_conventions (account_id, separator)
      VALUES ('act_26608804', '_')
      RETURNING id INTO cid;
  ELSE
    UPDATE public.naming_conventions SET separator = '_' WHERE id = cid;
  END IF;

  INSERT INTO public.naming_convention_segments (convention_id, position, dimension, required)
  VALUES
    (cid, 2, 'ad_type', false)
  ON CONFLICT (convention_id, position)
    DO UPDATE SET dimension = EXCLUDED.dimension, required = EXCLUDED.required;

  INSERT INTO public.naming_convention_vocab (convention_id, dimension, canonical, aliases)
  VALUES
    (cid, 'ad_type', 'Video',    ARRAY['video', 'VID', 'LV', 'MV', 'SV']),
    (cid, 'ad_type', 'Image',    ARRAY['image', 'IMG', 'Static', 'Photo', 'SI']),
    (cid, 'ad_type', 'Carousel', ARRAY['carousel', 'CA'])
  ON CONFLICT (convention_id, dimension, canonical)
    DO UPDATE SET aliases = EXCLUDED.aliases;
END $$;
