-- US-009: The 'ai' auto-tag layer + a review flag.
--
-- Two additive, idempotent changes so the deterministic AI-derived tag layer
-- (supabase/functions/_shared/derive-creative-tags.ts, resolved BELOW 'parsed'
-- by resolve-tags.ts) can be persisted:
--
--   1. tag_source CHECK — add 'ai' to the allowed provenance values. The prior
--      constraint (20260310014350) allowed parsed/csv_match/csv/manual/inferred/
--      untagged; 'ai' now joins them. Legacy values stay permitted so historical
--      rows are untouched.
--
--   2. needs_tag_review boolean — the least-invasive FUZZY-FLAG mechanism (owner
--      decision). tag_source is a single column and can only report the highest
--      contributing layer, so it cannot mark "this AI-derived value is low
--      confidence" when a higher layer also contributed. This boolean does: it is
--      set true when an auto-applied AI tag was fuzzy/judgment-call (today: a
--      theme derived from value_structure). Tags are ALWAYS auto-applied — the
--      flag only lets the owner filter to rows worth a look. Review NEVER blocks.
--      Default false so every existing row is unaffected. A partial index keeps
--      the "show me what to review" filter cheap.
--
-- IDEMPOTENT: DROP CONSTRAINT IF EXISTS + ADD; ADD COLUMN IF NOT EXISTS;
-- CREATE INDEX IF NOT EXISTS. Safe to re-run.

ALTER TABLE public.creatives DROP CONSTRAINT IF EXISTS creatives_tag_source_check;

ALTER TABLE public.creatives
  ADD CONSTRAINT creatives_tag_source_check
  CHECK (tag_source IN ('parsed', 'csv_match', 'csv', 'manual', 'inferred', 'ai', 'untagged'));

ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS needs_tag_review boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.creatives.needs_tag_review IS
  'US-009: true when an auto-applied AI-derived tag (tag_source path) was '
  'fuzzy/low-confidence and is worth a human glance. Non-blocking review filter; '
  'set by the derive-creative-tags layer via resolve-tags.needs_review.';

-- Cheap "rows to review" filter: only the flagged rows are indexed.
CREATE INDEX IF NOT EXISTS creatives_needs_tag_review_idx
  ON public.creatives (needs_tag_review)
  WHERE needs_tag_review = true;
