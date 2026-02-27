
CREATE TABLE IF NOT EXISTS public.brief_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id text,
  name text NOT NULL,
  format text,
  sections jsonb DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.briefs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id text NOT NULL,
  template_id uuid REFERENCES public.brief_templates(id),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  assignee_name text,
  due_date date,
  reference_ad_ids text[] DEFAULT '{}',
  content jsonb DEFAULT '{}'::jsonb,
  share_token text UNIQUE DEFAULT gen_random_uuid()::text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.brief_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Builder/employee can manage brief_templates"
  ON public.brief_templates FOR ALL
  USING (has_role(auth.uid(), 'builder') OR has_role(auth.uid(), 'employee'));

CREATE POLICY "Builder/employee can manage briefs"
  ON public.briefs FOR ALL
  USING (has_role(auth.uid(), 'builder') OR has_role(auth.uid(), 'employee'));

CREATE POLICY "Public can view shared briefs by token"
  ON public.briefs FOR SELECT
  USING (share_token IS NOT NULL);
