
-- Create annotations storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('annotations', 'annotations', true)
ON CONFLICT (id) DO NOTHING;

-- Create annotations metadata table
CREATE TABLE IF NOT EXISTS public.annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id text NOT NULL,
  account_id text NOT NULL,
  image_path text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  note text
);

ALTER TABLE public.annotations ENABLE ROW LEVEL SECURITY;

-- Builder/employee can manage annotations
CREATE POLICY "Builder/employee can manage annotations"
ON public.annotations FOR ALL
TO authenticated
USING (
  has_role(auth.uid(), 'builder'::app_role) OR has_role(auth.uid(), 'employee'::app_role)
);

-- Client can view linked annotations
CREATE POLICY "Client can view linked annotations"
ON public.annotations FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'client'::app_role) AND account_id IN (SELECT get_user_account_ids(auth.uid()))
);

-- Storage RLS: authenticated users can upload to annotations bucket
CREATE POLICY "Auth users can upload annotations"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'annotations');

CREATE POLICY "Anyone can view annotations"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'annotations');

CREATE POLICY "Auth users can delete own annotations"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'annotations');
