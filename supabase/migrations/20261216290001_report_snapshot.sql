-- Report snapshot (audit plan item 6.2).
--
-- Each generated report saves its own top creatives, tag mix and chart series, so exporting an
-- old report shows what it showed when it was made instead of today's numbers. Written by the
-- reports and scheduled-reports edge functions (_shared/report-snapshot.ts). NULL for reports
-- made before this change; the report page then uses the saved top performers and labels the
-- tag mix as not saved. Additive and nullable, so it is safe to apply ahead of the functions.

ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS snapshot jsonb;

COMMENT ON COLUMN public.reports.snapshot IS
  'Frozen top creatives, tag mix and chart series saved at generation time (audit 6.2). NULL for older reports.';
