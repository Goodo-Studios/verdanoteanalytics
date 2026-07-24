-- =============================================================================
-- US-001: Creative matrix taxonomy — creative-lane / creative-type / body on
-- creatives, a global creative_type_menu (the five house lanes + their types),
-- per-account activation (account_creative_types), and a nullable Theme/Persona
-- reference from creatives → angle_clusters.
-- =============================================================================
-- ONE additive, idempotent FORWARD migration. Applied MANUALLY via
-- `supabase db push --linked` (CI does NOT run migrations — see MIGRATIONS.md);
-- this file ships schema only, no deploy. Safe to re-run on a clean DB or a prod
-- snapshot: every ADD COLUMN / CREATE TABLE / CREATE INDEX is IF NOT EXISTS,
-- every policy is DROP … IF EXISTS before CREATE, and the seed uses ON CONFLICT
-- DO NOTHING against a unique natural key. No DROP COLUMN, no rewrite of any
-- existing column — metadata-only adds (nullable, or boolean/int with a default).
--
-- Numbering: 20260724000001 follows the remote + local ledger frontier
-- (…20260723000005_creative_ai_tag_layer) so ordering is preserved. Does NOT
-- reuse or repair any prior number. All FK targets (public.ad_accounts,
-- public.angle_clusters, public.creatives) and the RLS helpers
-- (public.has_role, public.get_user_account_ids, public.app_role) already exist
-- by this point in migration history.
--
-- ── The matrix (PRD data model) ──────────────────────────────────────────────
-- Ads are placed on a Theme/Persona × creative-type board, with hook nested by
-- body. The dimensions this migration lands:
--   • creative_lane  — the house production lane ("Studio video", "Creator",
--                      "Static", "Motion", "Video edits").
--   • creative_type  — the specific type WITHIN a lane (from creative_type_menu,
--                      subset-activated per account via account_creative_types).
--   • body           — the "body" axis that hook nests under.
--   • angle_id       — nullable Theme/Persona reference. angle_clusters is REUSED
--                      as the account's combined Theme/Persona list (no separate
--                      persona table — owner decision, matches the PRD).
--
-- ── Naming convention (foundation-autotag parity) ───────────────────────────
-- Column NAMES are snake_case dimension keys, matching the creatives.tag_suggestions
-- key convention ({ "<dimension>": { value, confidence, signal } }, where the
-- existing dimensions are ad_type/person/style/product/hook/theme/angle). So the
-- deterministic auto-tag layer (supabase/functions/_shared/derive-creative-tags.ts)
-- can resolve "creative_lane"/"creative_type"/"body" the same way it resolves the
-- other six, with per-account overrides. Column VALUES are display-cased (e.g.
-- "Studio video"), matching how the existing tag columns store "Video"/"Static"
-- rather than lowercase enums — no CHECK constraint, so the value space stays
-- extensible per account (mirrors the plain-text style of industry/ad_format in
-- 20260723000004).
-- =============================================================================

-- ─── 1. creatives: matrix dimension columns + Theme/Persona reference ────────
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS creative_lane text;
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS creative_type text;
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS body          text;

-- Nullable Theme/Persona reference. angle_clusters is the combined Theme/Persona
-- list; ON DELETE SET NULL so removing a cluster orphans the tag rather than
-- deleting the creative.
ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS angle_id uuid REFERENCES public.angle_clusters(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.creatives.creative_lane IS
  'US-001 matrix: the house production lane this creative belongs to (one of '
  'creative_type_menu.lane: "Studio video" | "Creator" | "Static" | "Motion" | '
  '"Video edits"). Display-cased value; snake_case column name matches the '
  'tag_suggestions dimension-key convention so the auto-tag layer can resolve it.';
COMMENT ON COLUMN public.creatives.creative_type IS
  'US-001 matrix: the specific creative type WITHIN creative_lane (a '
  'creative_type_menu.type_name, subset-activated per account via '
  'account_creative_types). Display-cased free text; no CHECK so the per-account '
  'type space stays extensible.';
COMMENT ON COLUMN public.creatives.body IS
  'US-001 matrix: the "body" axis of the board that hook nests under. Matches the '
  'tag_suggestions "body" dimension-key convention.';
COMMENT ON COLUMN public.creatives.angle_id IS
  'US-001 matrix: nullable Theme/Persona reference into public.angle_clusters '
  '(reused as the account''s combined Theme/Persona list — no separate persona '
  'table). ON DELETE SET NULL.';

-- Match-cost indexes for the board filters (mirror idx_creatives_ad_type etc.).
CREATE INDEX IF NOT EXISTS idx_creatives_creative_lane ON public.creatives (creative_lane);
CREATE INDEX IF NOT EXISTS idx_creatives_creative_type ON public.creatives (creative_type);
CREATE INDEX IF NOT EXISTS idx_creatives_angle_id      ON public.creatives (angle_id);

-- ─── 2. creative_type_menu — GLOBAL reference of house lanes + their types ───
-- Not account-scoped: the canonical menu every account activates a subset of.
-- (lane, type_name) is the unique natural key that makes the seed idempotent.
CREATE TABLE IF NOT EXISTS public.creative_type_menu (
  id         uuid    NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lane       text    NOT NULL,
  type_name  text    NOT NULL,
  -- Display ordering within a lane (and lanes are ordered by their first entry).
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT creative_type_menu_lane_type_key UNIQUE (lane, type_name)
);

CREATE INDEX IF NOT EXISTS creative_type_menu_lane_idx
  ON public.creative_type_menu (lane);

COMMENT ON TABLE public.creative_type_menu IS
  'US-001: GLOBAL house menu of the five creative lanes and the types within each. '
  'Accounts activate a subset via account_creative_types. Extensible — add rows to '
  'grow the menu; the per-lane starter types below are seed defaults.';

-- ─── 3. account_creative_types — per-account activation of menu types ────────
-- Which subset of the global menu is live for a given account, plus per-account
-- ordering. (account_id, creative_type_id) unique so activation is idempotent.
CREATE TABLE IF NOT EXISTS public.account_creative_types (
  id               uuid    NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id       text    NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  creative_type_id uuid    NOT NULL REFERENCES public.creative_type_menu(id) ON DELETE CASCADE,
  active           boolean NOT NULL DEFAULT true,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_creative_types_account_type_key UNIQUE (account_id, creative_type_id)
);

CREATE INDEX IF NOT EXISTS account_creative_types_account_id_idx
  ON public.account_creative_types (account_id);

COMMENT ON TABLE public.account_creative_types IS
  'US-001: per-account activation of creative_type_menu entries. One row = one '
  'menu type turned on for one account (active flag + per-account sort_order).';

-- ─── 4. Seed the five house lanes + starter types ───────────────────────────
-- Starter types per lane, derived from the app tag vocab (src/lib/tagOptions.ts:
-- TYPE/PERSON/STYLE options) and common production categories. The menu is
-- EXTENSIBLE — these are sensible defaults, not a closed set. ON CONFLICT on the
-- (lane, type_name) natural key makes the seed a safe no-op on re-run.
INSERT INTO public.creative_type_menu (lane, type_name, sort_order) VALUES
  -- Studio video: professionally shot studio content.
  ('Studio video', 'Talking Head',        10),
  ('Studio video', 'Product Demo',         20),
  ('Studio video', 'Founder Story',        30),
  ('Studio video', 'B-Roll Montage',       40),
  -- Creator: creator / UGC-native content.
  ('Creator',      'UGC Testimonial',      10),
  ('Creator',      'Unboxing',             20),
  ('Creator',      'Get Ready With Me',    30),
  ('Creator',      'Day In The Life',      40),
  -- Static: still-image creative.
  ('Static',       'Product Shot',         10),
  ('Static',       'Lifestyle',            20),
  ('Static',       'Text Forward',         30),
  ('Static',       'Comparison Graphic',   40),
  ('Static',       'Testimonial Card',     50),
  -- Motion: motion graphics / animation.
  ('Motion',       'Animated Explainer',   10),
  ('Motion',       'Kinetic Typography',   20),
  ('Motion',       'Logo Animation',       30),
  ('Motion',       'Product 3D',           40),
  -- Video edits: edits / remixes of existing footage.
  ('Video edits',  'Supercut',             10),
  ('Video edits',  'Reaction Edit',        20),
  ('Video edits',  'Split Screen',         30),
  ('Video edits',  'Captioned Clip',       40)
ON CONFLICT ON CONSTRAINT creative_type_menu_lane_type_key DO NOTHING;

-- ─── 5. RLS ──────────────────────────────────────────────────────────────────
-- creative_type_menu (global reference): any authenticated user may READ it;
-- builder/employee MANAGE it. account_creative_types (account-scoped): mirrors
-- the angle_clusters / creatives pattern (20260530110000 / 20260518000001) —
-- builder/employee manage; client views rows for their linked accounts.
-- service_role bypasses RLS on both (write paths), consistent with the codebase.

ALTER TABLE public.creative_type_menu      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_creative_types  ENABLE ROW LEVEL SECURITY;

-- creative_type_menu ---------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can view creative_type_menu" ON public.creative_type_menu;
DROP POLICY IF EXISTS "Builder/employee can manage creative_type_menu" ON public.creative_type_menu;

CREATE POLICY "Authenticated can view creative_type_menu" ON public.creative_type_menu
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Builder/employee can manage creative_type_menu" ON public.creative_type_menu
  FOR ALL
  USING (
    public.has_role(auth.uid(), 'builder'::public.app_role)
    OR public.has_role(auth.uid(), 'employee'::public.app_role)
  );

-- account_creative_types -----------------------------------------------------
DROP POLICY IF EXISTS "Builder/employee can manage account_creative_types" ON public.account_creative_types;
DROP POLICY IF EXISTS "Client can view linked account_creative_types" ON public.account_creative_types;

CREATE POLICY "Builder/employee can manage account_creative_types" ON public.account_creative_types
  FOR ALL
  USING (
    public.has_role(auth.uid(), 'builder'::public.app_role)
    OR public.has_role(auth.uid(), 'employee'::public.app_role)
  );

CREATE POLICY "Client can view linked account_creative_types" ON public.account_creative_types
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'client'::public.app_role)
    AND account_id IN (SELECT public.get_user_account_ids(auth.uid()))
  );

-- ── Verify (run manually after push) ─────────────────────────────────────────
--   SELECT array_agg(column_name ORDER BY column_name)
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='creatives'
--      AND column_name IN ('creative_lane','creative_type','body','angle_id');
--   SELECT lane, count(*) FROM public.creative_type_menu GROUP BY lane ORDER BY lane;
--   SELECT to_regclass('public.account_creative_types');
