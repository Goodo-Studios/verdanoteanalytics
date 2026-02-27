CREATE TABLE IF NOT EXISTS public.split_tests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id text NOT NULL REFERENCES public.ad_accounts(id),
  name text NOT NULL,
  hypothesis text,
  variable_tested text,
  status text DEFAULT 'running',
  winner_ad_id text,
  start_date date,
  end_date date,
  minimum_spend numeric DEFAULT 500,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.split_tests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Builder/employee can manage split_tests"
  ON public.split_tests
  FOR ALL
  USING (
    has_role(auth.uid(), 'builder'::app_role)
    OR has_role(auth.uid(), 'employee'::app_role)
  );

CREATE POLICY "Client can view linked split_tests"
  ON public.split_tests
  FOR SELECT
  USING (
    has_role(auth.uid(), 'client'::app_role)
    AND account_id IN (SELECT get_user_account_ids(auth.uid()))
  );

CREATE TABLE IF NOT EXISTS public.split_test_variants (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  test_id uuid REFERENCES public.split_tests(id) ON DELETE CASCADE NOT NULL,
  ad_id text NOT NULL,
  label text NOT NULL
);

ALTER TABLE public.split_test_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Builder/employee can manage split_test_variants"
  ON public.split_test_variants
  FOR ALL
  USING (
    has_role(auth.uid(), 'builder'::app_role)
    OR has_role(auth.uid(), 'employee'::app_role)
  );

CREATE POLICY "Client can view linked split_test_variants"
  ON public.split_test_variants
  FOR SELECT
  USING (
    has_role(auth.uid(), 'client'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.split_tests st
      WHERE st.id = test_id
      AND st.account_id IN (SELECT get_user_account_ids(auth.uid()))
    )
  );