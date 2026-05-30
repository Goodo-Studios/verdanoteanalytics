-- US-003: Bartesian (act_2351303561861342) naming-convention override.
--
-- Bartesian ad names follow the positional pattern {market}_{theme}_{ad_type},
-- so the ad_type token lives at positional index 2. The global default
-- convention maps ad_type to position 1, so Bartesian ads never matched the
-- controlled vocabulary and the entire account (1,393 creatives) sat at
-- tag_source = 'untagged' (0% coverage). This override re-points ad_type to
-- position 2 and supplies the ad_type vocabulary, mirroring the global
-- canonicalization (Static/Photo -> Image) so the single parser canonicalizes
-- Bartesian identically to every other account.
--
-- unique_code remains the first separator-split token (position 0) per the
-- parser contract; it is the creatives join key and is unaffected.
--
-- Idempotent: re-running is a no-op. The convention row is guarded by an
-- existence check (the partial unique index on account_id cannot be targeted by
-- ON CONFLICT), and segments/vocab use ON CONFLICT against their real UNIQUE
-- constraints.
--
-- Applied to production via service-role PostgREST during US-003 (the analytics
-- project has no local DB password / `supabase db push` path); this file is the
-- committed repo artifact of that production change.

DO $$
DECLARE
  cid uuid;
BEGIN
  SELECT id INTO cid
    FROM public.naming_conventions
    WHERE account_id = 'act_2351303561861342';

  IF cid IS NULL THEN
    INSERT INTO public.naming_conventions (account_id, separator)
      VALUES ('act_2351303561861342', '_')
      RETURNING id INTO cid;
  ELSE
    UPDATE public.naming_conventions SET separator = '_' WHERE id = cid;
  END IF;

  INSERT INTO public.naming_convention_segments (convention_id, position, dimension, required)
  VALUES
    (cid, 0, 'unique_code', true),
    (cid, 2, 'ad_type',     false)
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
