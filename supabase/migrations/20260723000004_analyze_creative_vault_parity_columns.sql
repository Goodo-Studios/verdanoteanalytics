-- =============================================================================
-- analyze-creative ⇄ Creative-Vault parity: promote metadata + add hook_visual +
-- hook-favoriting columns to creatives
-- =============================================================================
-- ONE additive/idempotent FORWARD migration. Manual `supabase db push --linked`
-- (CI does NOT run migrations — see MIGRATIONS.md). Every ADD COLUMN is guarded
-- with IF NOT EXISTS so a re-apply is a safe no-op. All columns are nullable (or
-- boolean DEFAULT false), so these are metadata-only adds — no table rewrite, no
-- lock beyond the brief catalog update.
--
-- Numbering: 20260723000004 follows the remote + local ledger frontier
-- (…20260723000003_analyze_creative_durable_self_chain, confirmed via
-- `supabase migration list --linked`) so ordering is preserved. Does NOT reuse
-- 20260723000002/000003.
--
-- ── Why ────────────────────────────────────────────────────────────────────────
-- The live Creative Vault (inspiration_items / inspiration_frameworks) surfaces a
-- RICH analysis: target_audience, industry, ad_format, brand_name as first-class
-- columns, a hook_visual column, and per-item hook-favoriting (star a hook). The
-- account-side analyzer (analyze-creative → creatives) produced a flatter subset:
--   • target_audience — the analyzer's BRAND_METADATA_PROMPT EMITS it but
--     analyze-creative DISCARDED it (no column). Add + persist.
--   • industry / ad_format / brand_name — only stashed inside creatives.tag_suggestions
--     jsonb. PROMOTE to first-class columns (analyze-creative keeps writing
--     tag_suggestions too, for back-compat with the review-gated auto-tag layer).
--   • hook_visual — the Vault has this column (currently NULL in live data, renders
--     as "—"); creatives had NO column. Add it (nullable; render-parity even when empty).
--   • hook_verbal_saved / hook_text_saved / hook_visual_saved — the Vault lets a user
--     star a hook into the Hook Library. Add the booleans (default false) so the
--     analytics modal can reach UI parity later.
--
-- creatives.style / creatives.person (the auto-tag dimensions) already exist (base
-- schema 20260212023127) — this migration does NOT touch them. analyze-creative now
-- EXTRACTS style + person in the prompt and surfaces them via framework_json +
-- tag_suggestions; the tag-column write stays with the review-gated auto-tag layer
-- (the tag_source CHECK has no 'ai' value, so a direct AI write would violate it).
-- =============================================================================

-- ─── Promote Vault metadata to first-class creatives columns ─────────────────
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS target_audience text;
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS industry        text;
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS ad_format       text;
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS brand_name      text;

-- ─── Visual hook (Vault parity: inspiration_frameworks.hook_visual) ──────────
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS hook_visual     text;

-- ─── Hook favoriting (Vault parity: inspiration_items.hook_*_saved) ──────────
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS hook_verbal_saved boolean NOT NULL DEFAULT false;
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS hook_text_saved   boolean NOT NULL DEFAULT false;
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS hook_visual_saved boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.creatives.target_audience IS
  'Vault parity (inspiration_items.target_audience): one-sentence audience description from analyze-creative. Was emitted by the prompt but previously DISCARDED (no column).';
COMMENT ON COLUMN public.creatives.industry IS
  'Vault parity (inspiration_items.industry): industry/vertical from analyze-creative. Promoted from creatives.tag_suggestions->theme; still written to tag_suggestions too.';
COMMENT ON COLUMN public.creatives.ad_format IS
  'Vault parity (inspiration_items.ad_format): creative format from analyze-creative. Promoted from creatives.tag_suggestions->ad_type/style; still written to tag_suggestions too.';
COMMENT ON COLUMN public.creatives.brand_name IS
  'Vault parity (inspiration_items.brand_name): brand/product from analyze-creative. Promoted from creatives.tag_suggestions->product; still written to tag_suggestions too.';
COMMENT ON COLUMN public.creatives.hook_visual IS
  'Vault parity (inspiration_frameworks.hook_visual): the opening visual/action that stops the scroll in the first 0–3s, distinct from on-screen text (hook_text) and spoken words (hook_verbal). Nullable — often null, mirrors the Vault where it renders "—".';
COMMENT ON COLUMN public.creatives.hook_verbal_saved IS
  'Vault parity (inspiration_items.hook_verbal_saved): user starred the verbal hook into the Hook Library. Default false.';
COMMENT ON COLUMN public.creatives.hook_text_saved IS
  'Vault parity (inspiration_items.hook_text_saved): user starred the on-screen-text hook into the Hook Library. Default false.';
COMMENT ON COLUMN public.creatives.hook_visual_saved IS
  'Vault parity (inspiration_items.hook_visual_saved): user starred the visual hook into the Hook Library. Default false.';

-- ── Verify (run manually after push — ONE combined query) ─────────────────────
--   SELECT array_agg(column_name ORDER BY column_name)
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='creatives'
--      AND column_name IN ('target_audience','industry','ad_format','brand_name',
--                          'hook_visual','hook_verbal_saved','hook_text_saved',
--                          'hook_visual_saved','style','person');
