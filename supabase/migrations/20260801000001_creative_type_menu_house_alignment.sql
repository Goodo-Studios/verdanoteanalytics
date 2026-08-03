-- =============================================================================
-- Creative-type menu: align the GLOBAL house menu with the Goodo house menu of
-- record, and soft-archive the US-001 starter defaults it supersedes.
-- =============================================================================
-- ONE additive, idempotent FORWARD migration. Applied MANUALLY via
-- `supabase db push --linked` (CI does NOT run migrations); this file ships
-- schema + reference data only, no deploy. Safe to re-run: the ADD COLUMN is
-- IF NOT EXISTS, the seed is ON CONFLICT DO NOTHING against the (lane,
-- type_name) natural key, the archive UPDATE is idempotent, and the function is
-- CREATE OR REPLACE.
--
-- Numbering: 20260801000001 follows the ledger frontier
-- (...20260724000004_creative_matrix_cell_rpc). Does NOT reuse or repair any
-- prior number.
--
-- -- Why ----------------------------------------------------------------------
-- US-001 seeded creative_type_menu with 21 placeholder starter types (its own
-- comment calls them "seed defaults"). Meanwhile the creative-strategy SOPs
-- carry the actual Goodo house menu -- 90 types across the same five lanes --
-- and it is canonical per the company policy
-- `goodo-studios-creative-type-taxonomy-five-lane-house-menu`.
--
-- The two lists shared their five lane names and almost nothing else: of the 21
-- starters, ZERO matched a house type exactly ("Animated Explainer" vs the house
-- "Animated explainer" differs only by case, and these columns are display-cased
-- free text, so they are distinct rows under the unique key). A strategist
-- briefing from the SOPs could not tag their creative type here, because the
-- name they were told to use verbatim was not in the menu.
--
-- Source of truth for the 90 rows below:
--   repos/private/knowledge-goodo-studios/processes/creative-strategy/
--     creative-type-menu.md    (lanes A-D: Studio video, Creator, Static, Motion)
--     iterations-playbook.md   (lane E: Video edits -- the 42 canonical levers)
-- They were extracted from those files programmatically rather than retyped, so
-- the menu and the docs cannot drift on a typo. Re-extract from the same two
-- files when the house menu changes.
--
-- -- Blast radius: none for live boards ---------------------------------------
-- Boards render only ACTIVATED types (account_creative_types.active = true, via
-- buildCreativeTypeGroups). Adding global rows activates nothing. No account's
-- board changes until someone activates a new type. No creatives rows are
-- touched, so any creative already tagged with a starter type keeps its value.
-- =============================================================================

-- --- 1. creative_type_menu: soft-archive column ------------------------------
-- Mirrors the angle_clusters.archived_at precedent from US-002: archive is a
-- soft toggle, never a hard delete, so existing creatives.creative_type values
-- and any activation rows keep resolving.
ALTER TABLE public.creative_type_menu ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN public.creative_type_menu.archived_at IS
  'Soft-archive timestamp for a house-menu type. NULL = live and offerable; NOT '
  'NULL = retired from the picker. Never hard-delete a menu row -- '
  'creatives.creative_type stores the display-cased name and '
  'account_creative_types references the id, so both would dangle. Archived rows '
  'stay visible to an account that has already activated them (see '
  'rpc_account_taxonomy below).';

-- --- 2. Seed the Goodo house menu (90 types across the five lanes) -----------
-- sort_order is the position within the lane, in the order the SOP lists them.
INSERT INTO public.creative_type_menu (lane, type_name, sort_order) VALUES
  ('Studio video', 'Produced testimonial', 10),
  ('Studio video', 'Produced founder', 20),
  ('Studio video', 'People reaction', 30),
  ('Studio video', 'Lifestyle narrative', 40),
  ('Studio video', 'Mechanism explainer', 50),
  ('Studio video', 'Scripted video', 60),
  ('Creator', '"I wasn''t gonna post this"', 10),
  ('Creator', 'Authentic testimonial / review', 20),
  ('Creator', 'Day-in-the-life', 30),
  ('Creator', 'GRWM (get ready with me)', 40),
  ('Creator', 'Unboxing / first impressions', 50),
  ('Creator', 'Problem → solution story', 60),
  ('Creator', '"Things I wish I knew"', 70),
  ('Creator', 'Street interview / vox pop', 80),
  ('Creator', 'Greenscreen react', 90),
  ('Creator', 'Duet / stitch react', 100),
  ('Creator', 'POV skit', 110),
  ('Creator', 'Scripted skit / comedy', 120),
  ('Creator', 'Trend-jack', 130),
  ('Creator', 'Tutorial / how-to', 140),
  ('Creator', 'Routine (AM/PM/gym/kitchen)', 150),
  ('Creator', 'Haul', 160),
  ('Creator', '"Get the receipts" proof reveal', 170),
  ('Creator', 'Text-to-camera storytime', 180),
  ('Creator', 'Voiceover over b-roll', 190),
  ('Creator', 'ASMR (creator, handheld)', 200),
  ('Creator', 'Listicle ("3 reasons")', 210),
  ('Creator', '"I tried X vs Y"', 220),
  ('Creator', 'Reply-to-comment', 230),
  ('Creator', 'Testimonial compilation', 240),
  ('Creator', 'Founder-as-creator', 250),
  ('Creator', 'Expert creator', 260),
  ('Creator', 'Skeptic-converted', 270),
  ('Creator', '"What''s in my bag / restock"', 280),
  ('Creator', 'Personal before/after', 290),
  ('Creator', 'Get-ready-with-me commute / errands', 300),
  ('Creator', 'Rant / hot take', 310),
  ('Creator', '"Stop doing X" / warning', 320),
  ('Static', 'Standard headline', 10),
  ('Static', 'Testimonial', 20),
  ('Static', 'Statistic', 30),
  ('Static', 'Before and after', 40),
  ('Static', 'Us vs. Them', 50),
  ('Static', 'UGC screenshot', 60),
  ('Static', 'Offer / promo', 70),
  ('Motion', 'AI ad', 10),
  ('Motion', 'Motion of static ad', 20),
  ('Motion', 'Animated explainer', 30),
  ('Video edits', 'Hook headline swap', 10),
  ('Video edits', 'Hook visual swap', 20),
  ('Video edits', 'Comment-bubble hook', 30),
  ('Video edits', 'Hook stacking', 40),
  ('Video edits', 'Curiosity-gap open', 50),
  ('Video edits', 'Pattern-interrupt open', 60),
  ('Video edits', 'Problem-agitation front-load', 70),
  ('Video edits', 'Creator reshoot (same script)', 80),
  ('Video edits', 'Same creator, new script', 90),
  ('Video edits', 'Demographic swap', 100),
  ('Video edits', 'AI avatar / AI voice swap', 110),
  ('Video edits', 'Greenscreen react', 120),
  ('Video edits', 'Duet / stitch react', 130),
  ('Video edits', 'Video → static', 140),
  ('Video edits', 'Video → carousel', 150),
  ('Video edits', 'Video → GIF / motion', 160),
  ('Video edits', 'Static → video', 170),
  ('Video edits', 'Static → carousel', 180),
  ('Video edits', 'Static → motion', 190),
  ('Video edits', 'Low → high production', 200),
  ('Video edits', 'Aspect-ratio reformat', 210),
  ('Video edits', 'Length trim', 220),
  ('Video edits', 'Split-screen', 230),
  ('Video edits', 'B-roll refresh', 240),
  ('Video edits', 'Caption / subtitle style swap', 250),
  ('Video edits', 'Music / SFX swap', 260),
  ('Video edits', 'Trend conversion', 270),
  ('Video edits', 'VO mashup', 280),
  ('Video edits', 'Multi-ad mashup / supercut', 290),
  ('Video edits', 'Stack winning ads', 300),
  ('Video edits', 'New angle', 310),
  ('Video edits', 'Add social proof', 320),
  ('Video edits', 'Awareness-stage shift', 330),
  ('Video edits', 'CTA variation', 340),
  ('Video edits', 'Offer swap', 350),
  ('Video edits', 'Urgency / scarcity add', 360),
  ('Video edits', 'Localization', 370),
  ('Video edits', 'Headline style swap', 380),
  ('Video edits', 'Supporting copy swap', 390),
  ('Video edits', 'Layout restructure', 400),
  ('Video edits', 'Visual change', 410),
  ('Video edits', 'Font / size adjustments', 420)
ON CONFLICT (lane, type_name) DO NOTHING;

-- --- 3. Soft-archive the 21 US-001 starter defaults --------------------------
-- Every one is superseded by a house type. Listed explicitly (not "everything
-- not in the house menu") so this migration can never archive a type someone
-- adds later by hand.
UPDATE public.creative_type_menu ctm
   SET archived_at = COALESCE(ctm.archived_at, now())
  FROM (VALUES
  ('Studio video', 'Talking Head'),
  ('Studio video', 'Product Demo'),
  ('Studio video', 'Founder Story'),
  ('Studio video', 'B-Roll Montage'),
  ('Creator', 'UGC Testimonial'),
  ('Creator', 'Unboxing'),
  ('Creator', 'Get Ready With Me'),
  ('Creator', 'Day In The Life'),
  ('Static', 'Product Shot'),
  ('Static', 'Lifestyle'),
  ('Static', 'Text Forward'),
  ('Static', 'Comparison Graphic'),
  ('Static', 'Testimonial Card'),
  ('Motion', 'Animated Explainer'),
  ('Motion', 'Kinetic Typography'),
  ('Motion', 'Logo Animation'),
  ('Motion', 'Product 3D'),
  ('Video edits', 'Supercut'),
  ('Video edits', 'Reaction Edit'),
  ('Video edits', 'Split Screen'),
  ('Video edits', 'Captioned Clip')
  ) AS legacy(lane, type_name)
 WHERE ctm.lane = legacy.lane
   AND ctm.type_name = legacy.type_name;

-- --- 4. rpc_account_taxonomy: hide archived types the account never activated -
-- Identical to the US-002 definition except for the creative_types WHERE clause.
-- The predicate is deliberately permissive: an archived type STILL appears when
-- this account has an activation row for it, so a board that already uses a
-- starter type does not lose its row the moment this migration lands. Only
-- archived-and-never-activated types drop out of the picker.
CREATE OR REPLACE FUNCTION public.rpc_account_taxonomy(p_account_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'account_id', p_account_id,
    -- Theme/Persona list (angle_clusters). Live rows first, then by score, newest.
    'themes', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',          ac.id,
          'label',       ac.label,
          'theme',       ac.theme,
          'summary',     ac.summary,
          'origin',      ac.source,
          'test_status', ac.test_status,
          'archived',    (ac.archived_at IS NOT NULL),
          'archived_at', ac.archived_at,
          'score',       ac.score,
          'created_at',  ac.created_at
        )
        ORDER BY (ac.archived_at IS NOT NULL) ASC,
                 ac.score DESC NULLS LAST,
                 ac.created_at DESC
      )
      FROM public.angle_clusters ac
      WHERE ac.account_id = p_account_id
    ), '[]'::jsonb),
    -- Creative-type activation: the GLOBAL house menu LEFT JOINed with this
    -- account's activation rows. Every menu type appears; active reflects the
    -- account row (false when never activated). Ordered by lane then menu order.
    'creative_types', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'creative_type_id',   ctm.id,
          'lane',               ctm.lane,
          'type_name',          ctm.type_name,
          'menu_sort_order',    ctm.sort_order,
          'active',             COALESCE(act.active, false),
          'activation_id',      act.id,
          'account_sort_order', act.sort_order
        )
        ORDER BY ctm.lane ASC, ctm.sort_order ASC, ctm.type_name ASC
      )
      FROM public.creative_type_menu ctm
      LEFT JOIN public.account_creative_types act
        ON act.creative_type_id = ctm.id
       AND act.account_id = p_account_id
      WHERE ctm.archived_at IS NULL
         OR act.id IS NOT NULL
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;


REVOKE ALL     ON FUNCTION public.rpc_account_taxonomy(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_account_taxonomy(text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.rpc_account_taxonomy(text) TO   service_role;

COMMENT ON FUNCTION public.rpc_account_taxonomy(text) IS
  'Single read path for an account''s governed taxonomy -- Theme/Persona list '
  '(angle_clusters) + creative-type activation (creative_type_menu joined with '
  'account_creative_types). Archived menu types are omitted unless this account '
  'has already activated them. SECURITY DEFINER, trusts p_account_id, '
  'service_role only.';
