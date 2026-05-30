-- US-007: BelliWelli (act_1555567991309641) naming-convention override.
--
-- BelliWelli's named creatives use a key-suffixed underscore convention whose
-- leading token is the ad_type, e.g.
--   Video_Hormone Health Babe - Partnership Ad_p-powder_s-HS_..._Sept
--   Static_<concept>_p-<product>_s-<surface>_per-<persona>_LP-<landing>_<month>
-- so the ad_type token lives at positional index 0. This override declares an
-- ad_type segment at position 0 and supplies the ad_type vocabulary, mirroring
-- the global Static/Photo -> Image canonicalization. The remaining key-prefixed
-- tokens (p-, s-, per-, LP-) are NOT positionally stable across names and are
-- intentionally left unmapped (they surface as harmless null tags); the single
-- parser is positional-only and does not support key-prefix extraction.
--
-- Scope of the gain: ~89% of this account's ad_names are raw Meta numeric ad IDs
-- (single token, no separator) and a further slice are free-text concept names;
-- neither has an ad_type token at position 0, so they correctly remain untagged.
-- Only the ~36 named rows carry a Video/Static leading token. Those 36 rows were
-- already inferred-tagged, so the measurable effect of this override is a
-- tag_source QUALITY upgrade (inferred -> parsed, i.e. derived from the
-- authoritative convention rather than heuristic inference) rather than a raw
-- coverage lift: coverage holds at ~5.9% by design. The no-demote guard kept
-- every previously-tagged row tagged (zero inferred -> untagged demotions).
--
-- unique_code remains the first separator-split token (position 0) per the
-- parser contract; declaring ad_type at the same position is intentional and
-- safe -- token[0] does double duty (unique_code is always token[0]; the pos-0
-- ad_type segment additionally matches token[0] against the ad_type vocab).
--
-- Idempotent: re-running is a no-op. The convention row is guarded by an
-- existence check (the partial unique index on account_id cannot be targeted by
-- ON CONFLICT), and segments/vocab use ON CONFLICT against their real UNIQUE
-- constraints.
--
-- Applied to production via service-role PostgREST during US-007 (the analytics
-- project has no local DB password / `supabase db push` path); this file is the
-- committed repo artifact of that production change.

DO $$
DECLARE
  cid uuid;
BEGIN
  SELECT id INTO cid
    FROM public.naming_conventions
    WHERE account_id = 'act_1555567991309641';

  IF cid IS NULL THEN
    INSERT INTO public.naming_conventions (account_id, separator)
      VALUES ('act_1555567991309641', '_')
      RETURNING id INTO cid;
  ELSE
    UPDATE public.naming_conventions SET separator = '_' WHERE id = cid;
  END IF;

  INSERT INTO public.naming_convention_segments (convention_id, position, dimension, required)
  VALUES
    (cid, 0, 'ad_type', false)
  ON CONFLICT (convention_id, position)
    DO UPDATE SET dimension = EXCLUDED.dimension, required = EXCLUDED.required;

  INSERT INTO public.naming_convention_vocab (convention_id, dimension, canonical, aliases)
  VALUES
    (cid, 'ad_type', 'Video',    ARRAY['video', 'VID']),
    (cid, 'ad_type', 'Image',    ARRAY['image', 'IMG', 'Static', 'Photo']),
    (cid, 'ad_type', 'Carousel', ARRAY['carousel'])
  ON CONFLICT (convention_id, dimension, canonical)
    DO UPDATE SET aliases = EXCLUDED.aliases;
END $$;
