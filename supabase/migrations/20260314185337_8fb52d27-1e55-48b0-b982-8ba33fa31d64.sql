CREATE TABLE public.health_checks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  checked_at timestamp with time zone NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pass',
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_ms integer DEFAULT 0
);

ALTER TABLE public.health_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Builder can manage health_checks"
  ON public.health_checks FOR ALL
  USING (has_role(auth.uid(), 'builder'::app_role));

CREATE POLICY "Employee can view health_checks"
  ON public.health_checks FOR SELECT
  USING (has_role(auth.uid(), 'employee'::app_role));