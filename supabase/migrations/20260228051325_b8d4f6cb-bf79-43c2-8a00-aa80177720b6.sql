
CREATE TABLE IF NOT EXISTS public.report_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default boolean DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Builder can manage report_templates" ON public.report_templates
  FOR ALL USING (has_role(auth.uid(), 'builder'::app_role));

CREATE POLICY "Employee can view report_templates" ON public.report_templates
  FOR SELECT USING (has_role(auth.uid(), 'employee'::app_role));
