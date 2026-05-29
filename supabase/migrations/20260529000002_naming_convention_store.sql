-- US-001: Server-side canonical naming convention + controlled vocabulary store
--
-- PURPOSE
-- Single server-side source of truth for the ad-naming convention and its
-- controlled vocabulary. Replaces four divergent definitions that previously
-- lived across the edge allow-list, two inline regex taggers, the frontend
-- `inferTags`, and a localStorage-only token template
-- (src/components/settings/NamingConventionSection.tsx).
--
-- The US-002 parser consumes the resolved convention (via public.get_convention)
-- to do positional-flexible parsing of `unique_code`-prefixed ad names into the
-- six tag dimensions used by name_mappings: ad_type, person, style, product,
-- hook, theme.
--
-- GLOBAL-vs-OVERRIDE REPRESENTATION (decided explicitly):
--   A single `naming_conventions` table with a NULLABLE `account_id`.
--   * account_id IS NULL  => the GLOBAL default convention (exactly one row).
--   * account_id = '<id>'  => a per-account OVERRIDE (at most one per account).
--   Resolution (public.get_convention) returns the override row if one exists for
--   the account, otherwise the global default row. Partial unique indexes enforce
--   "at most one global" and "at most one per account".
--
-- IDEMPOTENT: tables use IF NOT EXISTS; policies use DROP POLICY IF EXISTS before
-- CREATE POLICY. Seed uses ON CONFLICT DO NOTHING keyed on natural keys.

-- ============================================================
-- naming_conventions — the convention header (separator + scope)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.naming_conventions (
  id          UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  -- NULL = global default convention; non-NULL = per-account override.
  account_id  TEXT REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  separator   TEXT NOT NULL DEFAULT '_',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one global default row (account_id IS NULL).
CREATE UNIQUE INDEX IF NOT EXISTS naming_conventions_global_uniq
  ON public.naming_conventions ((account_id IS NULL))
  WHERE account_id IS NULL;

-- At most one override row per account.
CREATE UNIQUE INDEX IF NOT EXISTS naming_conventions_account_uniq
  ON public.naming_conventions (account_id)
  WHERE account_id IS NOT NULL;

-- ============================================================
-- naming_convention_segments — ordered segments of the convention
-- position 0 is conventionally `unique_code`; positions 1..N map to tag dims.
-- `required` lets the US-002 parser be positional-flexible / degrade gracefully.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.naming_convention_segments (
  id            UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  convention_id UUID NOT NULL REFERENCES public.naming_conventions(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  -- one of: unique_code, ad_type, person, style, product, hook, theme
  dimension     TEXT NOT NULL,
  required      BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (convention_id, position),
  CONSTRAINT naming_convention_segments_dimension_chk
    CHECK (dimension IN ('unique_code','ad_type','person','style','product','hook','theme'))
);

-- ============================================================
-- naming_convention_vocab — controlled vocabulary per dimension.
-- canonical value + aliases array (e.g. canonical 'UGCNative' aliases {'UGC'}).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.naming_convention_vocab (
  id            UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  convention_id UUID NOT NULL REFERENCES public.naming_conventions(id) ON DELETE CASCADE,
  -- one of the six tag dimensions (no unique_code: it is a free-form key, not vocab)
  dimension     TEXT NOT NULL,
  canonical     TEXT NOT NULL,
  aliases       TEXT[] NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (convention_id, dimension, canonical),
  CONSTRAINT naming_convention_vocab_dimension_chk
    CHECK (dimension IN ('ad_type','person','style','product','hook','theme'))
);

CREATE INDEX IF NOT EXISTS naming_convention_vocab_lookup_idx
  ON public.naming_convention_vocab (convention_id, dimension);

-- ============================================================
-- updated_at triggers (reuse existing public.update_updated_at_column())
-- ============================================================

DROP TRIGGER IF EXISTS update_naming_conventions_updated_at ON public.naming_conventions;
CREATE TRIGGER update_naming_conventions_updated_at
  BEFORE UPDATE ON public.naming_conventions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_naming_convention_segments_updated_at ON public.naming_convention_segments;
CREATE TRIGGER update_naming_convention_segments_updated_at
  BEFORE UPDATE ON public.naming_convention_segments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_naming_convention_vocab_updated_at ON public.naming_convention_vocab;
CREATE TRIGGER update_naming_convention_vocab_updated_at
  BEFORE UPDATE ON public.naming_convention_vocab
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- RLS — matches the established RBAC pattern from
-- 20260518000001_fix_core_table_rls.sql (NOT the outdated allow-all in the PRD).
-- Builder/employee can manage; client can view. Clients may read the GLOBAL
-- default (account_id IS NULL) plus any per-account override for their accounts.
-- Segments and vocab inherit scope through their parent convention_id.
-- ============================================================

ALTER TABLE public.naming_conventions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.naming_convention_segments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.naming_convention_vocab     ENABLE ROW LEVEL SECURITY;

-- naming_conventions ---------------------------------------------------------
DROP POLICY IF EXISTS "Builder/employee can manage naming_conventions" ON public.naming_conventions;
DROP POLICY IF EXISTS "Client can view naming_conventions" ON public.naming_conventions;

CREATE POLICY "Builder/employee can manage naming_conventions" ON public.naming_conventions
  FOR ALL
  USING (
    public.has_role(auth.uid(), 'builder'::public.app_role)
    OR public.has_role(auth.uid(), 'employee'::public.app_role)
  );

CREATE POLICY "Client can view naming_conventions" ON public.naming_conventions
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'client'::public.app_role)
    AND (
      account_id IS NULL
      OR account_id IN (SELECT public.get_user_account_ids(auth.uid()))
    )
  );

-- naming_convention_segments -------------------------------------------------
DROP POLICY IF EXISTS "Builder/employee can manage naming_convention_segments" ON public.naming_convention_segments;
DROP POLICY IF EXISTS "Client can view naming_convention_segments" ON public.naming_convention_segments;

CREATE POLICY "Builder/employee can manage naming_convention_segments" ON public.naming_convention_segments
  FOR ALL
  USING (
    public.has_role(auth.uid(), 'builder'::public.app_role)
    OR public.has_role(auth.uid(), 'employee'::public.app_role)
  );

CREATE POLICY "Client can view naming_convention_segments" ON public.naming_convention_segments
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'client'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.naming_conventions c
      WHERE c.id = naming_convention_segments.convention_id
        AND (
          c.account_id IS NULL
          OR c.account_id IN (SELECT public.get_user_account_ids(auth.uid()))
        )
    )
  );

-- naming_convention_vocab ----------------------------------------------------
DROP POLICY IF EXISTS "Builder/employee can manage naming_convention_vocab" ON public.naming_convention_vocab;
DROP POLICY IF EXISTS "Client can view naming_convention_vocab" ON public.naming_convention_vocab;

CREATE POLICY "Builder/employee can manage naming_convention_vocab" ON public.naming_convention_vocab
  FOR ALL
  USING (
    public.has_role(auth.uid(), 'builder'::public.app_role)
    OR public.has_role(auth.uid(), 'employee'::public.app_role)
  );

CREATE POLICY "Client can view naming_convention_vocab" ON public.naming_convention_vocab
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'client'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.naming_conventions c
      WHERE c.id = naming_convention_vocab.convention_id
        AND (
          c.account_id IS NULL
          OR c.account_id IN (SELECT public.get_user_account_ids(auth.uid()))
        )
    )
  );

-- ============================================================
-- public.get_convention(p_account_id) — RESOLVER
-- Returns the per-account override convention if one exists for p_account_id,
-- otherwise the global default (account_id IS NULL), as a single JSON object:
--   {
--     "id": "<uuid>",
--     "account_id": null | "<id>",
--     "scope": "override" | "global",
--     "separator": "_",
--     "segments": [ { "position": 0, "dimension": "unique_code", "required": true }, ... ],
--     "vocab":    [ { "dimension": "style", "canonical": "UGCNative", "aliases": ["UGC"] }, ... ]
--   }
-- Returns NULL if no convention is configured at all.
--
-- SECURITY DEFINER + SET search_path = public so the US-002 parser / edge
-- functions (service_role) and authenticated callers get a stable resolution
-- regardless of RLS. STABLE: no writes, deterministic within a statement.
-- ============================================================

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
BEGIN
  -- Prefer a per-account override; fall back to the global default.
  IF p_account_id IS NOT NULL THEN
    SELECT * INTO v_convention
    FROM public.naming_conventions
    WHERE account_id = p_account_id
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
                   'required',  s.required
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

-- ============================================================
-- SEED — global default convention (account_id NULL)
-- Convention: {unique_code}_{type}_{person}_{style}_{product}_{hook}_{theme}
-- Permissive: only unique_code is required so the parser degrades gracefully
-- on variable segment counts.
-- ============================================================

-- Insert the global convention row (idempotent: at most one global row enforced
-- by the partial unique index; ON CONFLICT on that index is awkward, so guard
-- with NOT EXISTS).
INSERT INTO public.naming_conventions (account_id, separator)
SELECT NULL, '_'
WHERE NOT EXISTS (
  SELECT 1 FROM public.naming_conventions WHERE account_id IS NULL
);

-- Segments for the global convention.
INSERT INTO public.naming_convention_segments (convention_id, position, dimension, required)
SELECT c.id, seg.position, seg.dimension, seg.required
FROM public.naming_conventions c
CROSS JOIN (VALUES
  (0, 'unique_code', true),
  (1, 'ad_type',     false),
  (2, 'person',      false),
  (3, 'style',       false),
  (4, 'product',     false),
  (5, 'hook',        false),
  (6, 'theme',       false)
) AS seg(position, dimension, required)
WHERE c.account_id IS NULL
ON CONFLICT (convention_id, position) DO NOTHING;

-- Controlled vocabulary for the global convention.
-- The critical bug fix: style alias 'UGC' -> canonical 'UGCNative'.
INSERT INTO public.naming_convention_vocab (convention_id, dimension, canonical, aliases)
SELECT c.id, voc.dimension, voc.canonical, voc.aliases
FROM public.naming_conventions c
CROSS JOIN (VALUES
  -- ad_type
  ('ad_type', 'Video',        ARRAY['video','VID']::text[]),
  ('ad_type', 'Image',        ARRAY['image','IMG','Static','Photo']::text[]),
  ('ad_type', 'Carousel',     ARRAY['carousel']::text[]),
  -- style (the known misclassification: UGC must canonicalize to UGCNative)
  ('style',   'UGCNative',    ARRAY['UGC','ugc','UGCnative','UGC-Native']::text[]),
  ('style',   'Testimonial',  ARRAY['testimonial']::text[]),
  ('style',   'Founder',      ARRAY['founder']::text[]),
  ('style',   'Animation',    ARRAY['animation','Animated','Motion']::text[]),
  -- hook
  ('hook',    'Problem',      ARRAY['problem']::text[]),
  ('hook',    'Callout',      ARRAY['callout']::text[]),
  ('hook',    'Question',     ARRAY['question']::text[]),
  ('hook',    'Discount',     ARRAY['discount','Sale','Offer']::text[]),
  -- theme
  ('theme',   'Lifestyle',    ARRAY['lifestyle']::text[]),
  ('theme',   'Benefit',      ARRAY['benefit','Benefits']::text[]),
  ('theme',   'SocialProof',  ARRAY['socialproof','Social-Proof','Proof']::text[])
) AS voc(dimension, canonical, aliases)
WHERE c.account_id IS NULL
ON CONFLICT (convention_id, dimension, canonical) DO NOTHING;
