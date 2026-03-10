-- Fix tag_source CHECK constraint to include 'inferred' and 'csv' values.
--
-- Background (2026-03-09 sync audit):
--   The sync function Phase 5 sets tag_source = 'inferred' for auto-tagged creatives.
--   The sync function queries .in("tag_source", ["manual", "csv"]) to preserve tagged ads.
--   Neither 'inferred' nor 'csv' exist in the original constraint, causing:
--     - Phase 5 auto-tag UPDATEs to silently fail (caught by non-fatal try/catch)
--     - The 'csv' filter in Phase 1 and Phase 3 to return empty results (not a crash,
--       but means all CSV-tagged ads get treated as untagged during those queries)
--
-- Updated allowed values: parsed, csv_match, csv, manual, inferred, untagged

ALTER TABLE public.creatives DROP CONSTRAINT IF EXISTS creatives_tag_source_check;

ALTER TABLE public.creatives
  ADD CONSTRAINT creatives_tag_source_check
  CHECK (tag_source IN ('parsed', 'csv_match', 'csv', 'manual', 'inferred', 'untagged'));
