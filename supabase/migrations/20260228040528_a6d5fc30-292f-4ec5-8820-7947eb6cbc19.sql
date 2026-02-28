
-- Creative comments table
CREATE TABLE IF NOT EXISTS public.creative_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id text NOT NULL,
  account_id text NOT NULL,
  user_id uuid NOT NULL,
  parent_id uuid REFERENCES public.creative_comments(id) ON DELETE CASCADE,
  body text NOT NULL,
  mentions text[] DEFAULT '{}',
  reactions jsonb DEFAULT '{}',
  is_resolved boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.creative_comments ENABLE ROW LEVEL SECURITY;

-- Builder/employee can manage comments
CREATE POLICY "Builder/employee can manage comments"
ON public.creative_comments FOR ALL
TO authenticated
USING (
  has_role(auth.uid(), 'builder'::app_role) OR has_role(auth.uid(), 'employee'::app_role)
);

-- Client can view comments on linked accounts
CREATE POLICY "Client can view comments"
ON public.creative_comments FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'client'::app_role) AND account_id IN (SELECT get_user_account_ids(auth.uid()))
);

-- Client can insert comments on linked accounts
CREATE POLICY "Client can insert comments"
ON public.creative_comments FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'client'::app_role) AND account_id IN (SELECT get_user_account_ids(auth.uid())) AND user_id = auth.uid()
);

-- Enable realtime for comments
ALTER PUBLICATION supabase_realtime ADD TABLE public.creative_comments;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_creative_comments_ad_id ON public.creative_comments(ad_id);
CREATE INDEX IF NOT EXISTS idx_creative_comments_parent_id ON public.creative_comments(parent_id);
