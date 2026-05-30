-- US-008: Galileo (act_138695479815833) naming-convention override.
--
-- Galileo's named creatives use a hyphen ("-") separator, but the hyphen is
-- overloaded: it appears both as the structural field delimiter AND inside
-- free-text concept tokens, so the positional layout is not globally stable.
-- An audit of all 352 ad_names found only 33 rows carrying any recognizable
-- ad_type token, split across positional index 1 (12 rows) and index 2 (21
-- rows). This override declares a single ad_type segment at position 2 -- the
-- position that captures the larger, more consistent cluster -- and supplies
-- the ad_type vocabulary, mirroring the global Static/Photo -> Image
-- canonicalization. The pos-1 ad_type tokens are intentionally left uncaptured:
-- the single parser is positional-only and honors the first declared segment
-- per position, and declaring a second ad_type segment at position 1 would not
-- help (first-position-wins means only one ad_type dimension resolves per row),
-- while the pos-1 cluster overlaps free-text concept tokens and would raise
-- false-positive risk. UGC is added as a Galileo-local ad_type canonical
-- because this account labels user-generated formats explicitly.
--
-- Scope of the gain: this is a tag_source QUALITY upgrade, not a raw coverage
-- lift. Of the 56 rows that were already tagged (all via heuristic 'inferred'),
-- 21 carry a position-2 ad_type token and were upgraded inferred -> parsed
-- (derived from the authoritative convention rather than inference). The other
-- 35 inferred rows do not carry a position-2 ad_type token; under the override
-- their fresh resolution yields no tags, so the deployed no-demote guard
-- (US-001) SKIPPED them -- they retain their existing inferred tags and were
-- counted as protected no-ops (protected=35). The 296 genuinely untagged rows
-- (dash-delimited free-text or numeric names with no ad_type token at position
-- 2) correctly remain untagged. Net effect: coverage holds at ~15.91% by
-- design (56/352), with zero inferred -> untagged demotions.
--
-- IMPORTANT DEPLOY NOTE: the US-008 dry-run initially reported still_untagged=331
-- with no protected counter, which revealed that the production backfill-retag
-- function was still the pre-guard version (the no-demote guard from US-001 had
-- been committed to the branch but never deployed). The guarded function was
-- deployed to production (project ref gwyxaqoaldnaavkjqquv) before this backfill
-- ran; the re-run dry-run then correctly reported protected=35 and
-- still_untagged=296, confirming the guard was live prior to any write.
--
-- unique_code remains the first separator-split token per the parser contract;
-- it is the creatives join key and is unaffected by this ad_type segment.
--
-- Idempotent: re-running is a no-op. The convention row is guarded by an
-- existence check (the partial unique index on account_id cannot be targeted by
-- ON CONFLICT), and segments/vocab use ON CONFLICT against their real UNIQUE
-- constraints.
--
-- Applied to production via service-role PostgREST during US-008 (the analytics
-- project has no local DB password / `supabase db push` path); this file is the
-- committed repo artifact of that production change.

DO $$
DECLARE
  cid uuid;
BEGIN
  SELECT id INTO cid
    FROM public.naming_conventions
    WHERE account_id = 'act_138695479815833';

  IF cid IS NULL THEN
    INSERT INTO public.naming_conventions (account_id, separator)
      VALUES ('act_138695479815833', '-')
      RETURNING id INTO cid;
  ELSE
    UPDATE public.naming_conventions SET separator = '-' WHERE id = cid;
  END IF;

  INSERT INTO public.naming_convention_segments (convention_id, position, dimension, required)
  VALUES
    (cid, 2, 'ad_type', false)
  ON CONFLICT (convention_id, position)
    DO UPDATE SET dimension = EXCLUDED.dimension, required = EXCLUDED.required;

  INSERT INTO public.naming_convention_vocab (convention_id, dimension, canonical, aliases)
  VALUES
    (cid, 'ad_type', 'Video',    ARRAY['video', 'VID']),
    (cid, 'ad_type', 'Image',    ARRAY['image', 'IMG', 'Static', 'Photo']),
    (cid, 'ad_type', 'Carousel', ARRAY['carousel']),
    (cid, 'ad_type', 'UGC',      ARRAY['ugc'])
  ON CONFLICT (convention_id, dimension, canonical)
    DO UPDATE SET aliases = EXCLUDED.aliases;
END $$;
