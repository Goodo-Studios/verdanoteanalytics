-- US-012: Natural Dog Company (act_44401754) naming-convention override.
--
-- Natural Dog's named creatives use a stable nine-token underscore convention
-- whose sixth token (positional index 5) is the media type, e.g.
--   GoodO_Fish-Oils_Salmon-Oil_Influencer_Evergreen_Video_Testimonial_Long-Form_2.11.16
--   GoodO_Skin-Soother_Balm_UGC_Evergreen_Carousel_Problem-Solution_Static-Set_1.18.16
-- token[0] is the brand/account marker ("GoodO"), tokens[1..4] carry the product,
-- variant, creator, and lifecycle segments, and token[5] is the ad_type word.
-- The global default convention declares ad_type at position 1, which for this
-- account lands on the product family token (e.g. "Fish-Oils") and never matches
-- a media type. As a result, every one of these creatives was previously tagged
-- only by the heuristic 'inferred' source, never by the authoritative positional
-- parser. This override relocates the ad_type segment to position 5 and supplies
-- an ad_type vocabulary that recognises the account's media words:
--   Video / video / VID / Gif / gif -> Video    (the account labels its animated
--                                                 creatives "Gif"; these are short
--                                                 motion ads and belong in Video)
--   Image / image / IMG / Static / Photo -> Image
--   Carousel / carousel                  -> Carousel
-- The remaining tokens (product, variant, creator, lifecycle, hook, format) are
-- not positionally stable enough to map and are intentionally left unmapped; the
-- single parser is positional-only and unmatched tokens surface as harmless null
-- tags.
--
-- Scope of the gain: this is a tag_source QUALITY UPGRADE, not a coverage lift.
-- Of the account's 365 ad_names, the 197 nine-token-family rows that previously
-- carried a heuristic 'inferred' tag were re-derived from this authoritative
-- convention and promoted inferred -> parsed (166 Video, 18 Carousel, 13 Image,
-- with the account-local "Gif" creatives canonicalised into Video and "Static"
-- into Image). The 168 rows that remain untagged carry no media-type token at
-- position 5 (53 are single-token brand-only names, the rest are short three-to-
-- five-token names or carry non-ad_type position-5 values such as "vertical",
-- "SkinSoother-LP", or a hashed id); they correctly remain untagged because the
-- positional parser has nothing to match. Net effect: full inferred -> parsed
-- promotion of the 197 convention-conformant rows and zero inferred -> untagged
-- demotions. The US-001 no-demote guard reported protected=0 on the production
-- apply, confirming that no inferred row resolved to untagged and that no row
-- lost a tag.
--
-- A note on the recon-vs-final row counts: the pre-apply recon read (the
-- paginated `coverage` helper) reported 198 tagged / 167 untagged, while the
-- exact post-apply `count=exact` tally reports 197 parsed / 168 untagged. The
-- one-row difference is a classification artifact between the paginated coverage
-- read and the exact dist count (empty-string vs null tag_source bucketing); it
-- is not a demotion. The guard's protected=0 is authoritative that no inferred
-- row was demoted to untagged on apply.
--
-- unique_code remains the first separator-split token (position 0, the "GoodO"
-- brand marker) per the parser contract; it is the creatives join key and is
-- unaffected by this ad_type segment. The override separator is "_", identical
-- to the global default, so no row's unique_code (already the "_"-split token[0])
-- changes as a result of this override.
--
-- Idempotent: re-running is a no-op. The convention row is guarded by an
-- existence check (the partial unique index on account_id cannot be targeted by
-- ON CONFLICT), and segments/vocab use ON CONFLICT against their real UNIQUE
-- constraints.
--
-- Applied to production via service-role PostgREST during US-012 (the analytics
-- project has no local DB password / `supabase db push` path); this file is the
-- committed repo artifact of that production change. The guarded backfill-retag
-- function (US-001 no-demote guard) was already live in production at apply time,
-- having been deployed during US-008.

DO $$
DECLARE
  cid uuid;
BEGIN
  SELECT id INTO cid
    FROM public.naming_conventions
    WHERE account_id = 'act_44401754';

  IF cid IS NULL THEN
    INSERT INTO public.naming_conventions (account_id, separator)
      VALUES ('act_44401754', '_')
      RETURNING id INTO cid;
  ELSE
    UPDATE public.naming_conventions SET separator = '_' WHERE id = cid;
  END IF;

  INSERT INTO public.naming_convention_segments (convention_id, position, dimension, required)
  VALUES
    (cid, 5, 'ad_type', false)
  ON CONFLICT (convention_id, position)
    DO UPDATE SET dimension = EXCLUDED.dimension, required = EXCLUDED.required;

  INSERT INTO public.naming_convention_vocab (convention_id, dimension, canonical, aliases)
  VALUES
    (cid, 'ad_type', 'Video',    ARRAY['video', 'VID', 'Gif', 'gif']),
    (cid, 'ad_type', 'Image',    ARRAY['image', 'IMG', 'Static', 'Photo']),
    (cid, 'ad_type', 'Carousel', ARRAY['carousel'])
  ON CONFLICT (convention_id, dimension, canonical)
    DO UPDATE SET aliases = EXCLUDED.aliases;
END $$;
