-- US-004: Goodo (act_782159176742035) naming-convention override.
--
-- Goodo ad names follow the positional pattern {brand}_{ad_type}_{concept}_{date},
-- so the ad_type token lives at positional index 1. The global default
-- convention also maps ad_type to position 1, but Goodo had no vocabulary
-- entry covering its tokens, so the entire account (5 creatives) sat at
-- tag_source = 'untagged' (0% coverage). This override re-declares the
-- ad_type segment at position 1 and supplies the ad_type vocabulary, mirroring
-- the global canonicalization (Static/Photo -> Image) so the single parser
-- canonicalizes Goodo identically to every other account.
--
-- unique_code remains the first separator-split token (position 0) per the
-- parser contract; it is the creatives join key and is unaffected.
--
-- Idempotent: re-running is a no-op. The convention row is guarded by an
-- existence check (the partial unique index on account_id cannot be targeted by
-- ON CONFLICT), and segments/vocab use ON CONFLICT against their real UNIQUE
-- constraints.
--
-- Applied to production via service-role PostgREST during US-004 (the analytics
-- project has no local DB password / `supabase db push` path); this file is the
-- committed repo artifact of that production change.

DO $$
DECLARE
  cid uuid;
BEGIN
  SELECT id INTO cid
    FROM public.naming_conventions
    WHERE account_id = 'act_782159176742035';

  IF cid IS NULL THEN
    INSERT INTO public.naming_conventions (account_id, separator)
      VALUES ('act_782159176742035', '_')
      RETURNING id INTO cid;
  ELSE
    UPDATE public.naming_conventions SET separator = '_' WHERE id = cid;
  END IF;

  INSERT INTO public.naming_convention_segments (convention_id, position, dimension, required)
  VALUES
    (cid, 0, 'unique_code', true),
    (cid, 1, 'ad_type',     false)
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
