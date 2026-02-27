CREATE TABLE IF NOT EXISTS public.whitelisting_deals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id text NOT NULL REFERENCES public.ad_accounts(id),
  creator_id uuid REFERENCES public.creators(id) ON DELETE SET NULL,
  creator_name text NOT NULL,
  platform text DEFAULT 'meta',
  status text DEFAULT 'active',
  access_granted_at date,
  access_expires_at date,
  notes text,
  spend_to_date numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.whitelisting_deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Builder/employee can manage whitelisting_deals"
  ON public.whitelisting_deals
  FOR ALL
  USING (
    has_role(auth.uid(), 'builder'::app_role)
    OR has_role(auth.uid(), 'employee'::app_role)
  );

CREATE POLICY "Client can view linked whitelisting_deals"
  ON public.whitelisting_deals
  FOR SELECT
  USING (
    has_role(auth.uid(), 'client'::app_role)
    AND account_id IN (SELECT get_user_account_ids(auth.uid()))
  );