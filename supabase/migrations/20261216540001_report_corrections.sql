-- Backup of reports corrected in place (audit plan item 6.3).
--
-- Reports made before the report math fix (#314) showed wrong numbers. Matthew chose to correct
-- them in place (2026-11-16). Before a report is rebuilt, its whole original row is saved here,
-- with the new values and the reason, so any correction can be checked or undone.
--
-- Written only by the correction script with the service role. No access for signed-in users.

CREATE TABLE IF NOT EXISTS public.report_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL,
  original jsonb NOT NULL,
  corrected jsonb NOT NULL,
  reason text,
  corrected_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS report_corrections_report_id_idx ON public.report_corrections (report_id);

ALTER TABLE public.report_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_corrections FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.report_corrections TO service_role;

COMMENT ON TABLE public.report_corrections IS
  'Original rows of reports rebuilt in place by the audit 6.3 correction (report math fix #314). Service role only.';
