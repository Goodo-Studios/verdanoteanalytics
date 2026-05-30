-- US-014: Earthing Harmony (act_896149194604773) naming-convention override.
--
-- Earthing Harmony's named creatives use a key:value underscore convention in
-- which every token is a labelled "key:value" pair rather than a bare positional
-- word, e.g.
--   id:2553113359-v4_medium:shortform_style:founder_angle:foot-ailments_...
--   id:2118840022_medium:static_style:high-production_angle:grounding_...
--   id:9931002201_medium:carousel_style:ugc_...
-- token[0] is the unique-identifier pair ("id:<digits>[-v<n>]") and token[1] is
-- always the media-type pair ("medium:<value>"). Across the account's 1,574
-- creatives the medium pair sits at positional index 1 in every named row that
-- carries one (1,069 rows), and the stored unique_code already equals the
-- "_"-split token[0] for the large majority of rows, so an override that keeps
-- the global "_" separator introduces no join-key change whatsoever.
--
-- The global default convention declares ad_type at position 1 but matches by
-- full-token vocabulary equality, and the account's position-1 token is the
-- literal string "medium:shortform" (etc.), not the bare word "Video". The
-- default vocabulary therefore never matched, and these creatives were tagged
-- only by the heuristic 'inferred' source or left untagged. This override keeps
-- ad_type at position 1 and supplies a vocabulary whose aliases are the entire
-- key:value strings, so the positional parser matches the full token:
--   medium:shortform / medium:midform / medium:longform -> Video
--   medium:static                                       -> Image
--   medium:carousel                                     -> Carousel
-- The account's "medium:expanded" value (87 rows) is intentionally left unmapped.
-- Its creatives are produced long-form/branded pieces whose media form does not
-- map cleanly onto the Video / Image / Carousel canonical vocabulary; mapping it
-- to any single canonical would be a guess, so under the project's
-- accuracy-over-completeness rule those rows are left to surface as untagged
-- rather than be assigned a speculative ad_type. All other key:value dimensions
-- (style, angle, and the rest) are not part of the ad_type sweep and remain
-- unmapped; the single parser is positional-only and unmatched tokens surface as
-- harmless null tags.
--
-- Scope of the gain: this is both a quality upgrade and a coverage lift. Before
-- the override the account reported 0 parsed / 391 inferred / 1,183 untagged
-- (0% authoritative parser coverage). After the production backfill the exact
-- count=exact tally reports 982 parsed / 0 inferred / 592 untagged, a coverage of
-- 62.39%. Every one of the 391 heuristic 'inferred' rows resolved to a real
-- media type under this convention and was promoted inferred -> parsed, and a
-- further ~591 previously-untagged rows gained a parsed ad_type. The 592 rows
-- that remain untagged legitimately carry no mappable media token at position 1:
-- 464 have no "medium:" pair at all (single-token id-only names and short
-- variants), 87 carry the intentionally-unmapped "medium:expanded" value, and the
-- remainder carry non-ad_type position-1 content. They correctly remain untagged
-- because the positional parser has nothing to match.
--
-- No-demote safety: the US-001 no-demote guard was live in production at apply
-- time. On re-running the backfill to completion the guard reported protected=0
-- with the residual untagged set scanning at 592 rows, all of whose current
-- tag_source is 'untagged' (no 'inferred' row survives in the untagged bucket).
-- Because the guard skips any retag that would resolve an 'inferred' or 'csv'
-- row down to untagged, the disappearance of the inferred bucket is entirely the
-- result of upgrades inferred -> parsed, never demotions inferred -> untagged.
--
-- unique_code remains the first separator-split token (position 0, the "id:..."
-- pair) per the parser contract; it is the creatives join key. The override
-- separator is "_", identical to the global default, so no row's unique_code
-- (already the "_"-split token[0]) changes as a result of this override.
--
-- Idempotent: re-running is a no-op. The convention row is guarded by an
-- existence check (the partial unique index on account_id cannot be targeted by
-- ON CONFLICT), and segments/vocab use ON CONFLICT against their real UNIQUE
-- constraints.
--
-- Applied to production via service-role PostgREST during US-014 (the analytics
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
    WHERE account_id = 'act_896149194604773';

  IF cid IS NULL THEN
    INSERT INTO public.naming_conventions (account_id, separator)
      VALUES ('act_896149194604773', '_')
      RETURNING id INTO cid;
  ELSE
    UPDATE public.naming_conventions SET separator = '_' WHERE id = cid;
  END IF;

  INSERT INTO public.naming_convention_segments (convention_id, position, dimension, required)
  VALUES
    (cid, 1, 'ad_type', false)
  ON CONFLICT (convention_id, position)
    DO UPDATE SET dimension = EXCLUDED.dimension, required = EXCLUDED.required;

  INSERT INTO public.naming_convention_vocab (convention_id, dimension, canonical, aliases)
  VALUES
    (cid, 'ad_type', 'Video',    ARRAY['medium:shortform', 'medium:midform', 'medium:longform']),
    (cid, 'ad_type', 'Image',    ARRAY['medium:static']),
    (cid, 'ad_type', 'Carousel', ARRAY['medium:carousel'])
  ON CONFLICT (convention_id, dimension, canonical)
    DO UPDATE SET aliases = EXCLUDED.aliases;
END $$;
