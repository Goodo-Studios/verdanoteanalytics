
-- Create coda_tasks table to mirror rows from Coda briefs table
CREATE TABLE IF NOT EXISTS public.coda_tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  coda_row_id text UNIQUE,
  account_id text,
  account_name text,
  task_name text,
  brief text,
  creative_id text,
  creative_name text,
  ad_type text,
  roas text,
  spend text,
  status text DEFAULT 'pending',
  created_by uuid,
  coda_created_at timestamp with time zone,
  synced_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- RLS
ALTER TABLE public.coda_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Builder/employee can manage coda_tasks"
  ON public.coda_tasks FOR ALL
  USING (has_role(auth.uid(), 'builder'::app_role) OR has_role(auth.uid(), 'employee'::app_role));

CREATE POLICY "Client can view linked coda_tasks"
  ON public.coda_tasks FOR SELECT
  USING (has_role(auth.uid(), 'client'::app_role) AND account_id IN (SELECT get_user_account_ids(auth.uid())));
