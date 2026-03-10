-- Fix tag_source CHECK constraint to include 'inferred' and 'csv' values.
ALTER TABLE public.creatives DROP CONSTRAINT IF EXISTS creatives_tag_source_check;

ALTER TABLE public.creatives
  ADD CONSTRAINT creatives_tag_source_check
  CHECK (tag_source IN ('parsed', 'csv_match', 'csv', 'manual', 'inferred', 'untagged'));