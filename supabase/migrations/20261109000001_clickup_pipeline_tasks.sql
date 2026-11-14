-- Client Content Pipeline, fed by ClickUp.
--
-- Coda was retired on 2026-10-09 and ClickUp is the task system. The client-facing
-- /pipeline board read from coda_tasks, which nothing refreshes any more. These two
-- tables replace it:
--
--   pipeline_tasks          one row per asset task that belongs on the board. Holds
--                           only client-safe fields. The raw ClickUp status,
--                           assignees, hours, QA results, briefs and asset links are
--                           never stored here. Written by the sync-clickup-tasks
--                           edge function (service role).
--   clickup_client_folders  staff-set override: which Verdanote account a ClickUp
--                           client folder belongs to, for folders whose name does
--                           not match an account name. Staff only.
--
-- coda_tasks is left in place and untouched. It is dropped in a later cleanup once
-- this board is live.

CREATE TABLE IF NOT EXISTS public.pipeline_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clickup_task_id text NOT NULL UNIQUE,
  account_id text NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  task_name text,
  stage text NOT NULL,
  due_date date,
  content_type text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipeline_tasks_account_id_idx ON public.pipeline_tasks (account_id);
CREATE INDEX IF NOT EXISTS pipeline_tasks_synced_at_idx ON public.pipeline_tasks (synced_at);

ALTER TABLE public.pipeline_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Builder/employee can manage pipeline_tasks"
  ON public.pipeline_tasks FOR ALL
  USING (has_role(auth.uid(), 'builder'::app_role) OR has_role(auth.uid(), 'employee'::app_role))
  WITH CHECK (has_role(auth.uid(), 'builder'::app_role) OR has_role(auth.uid(), 'employee'::app_role));

-- A client reads the board for accounts linked to them, and nothing else.
CREATE POLICY "Client can view linked pipeline_tasks"
  ON public.pipeline_tasks FOR SELECT
  USING (has_role(auth.uid(), 'client'::app_role) AND account_id IN (SELECT get_user_account_ids(auth.uid())));

CREATE TABLE IF NOT EXISTS public.clickup_client_folders (
  folder_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  folder_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.clickup_client_folders ENABLE ROW LEVEL SECURITY;

-- Staff only. No client policy: a client has no reason to read the folder mapping.
CREATE POLICY "Builder/employee can manage clickup_client_folders"
  ON public.clickup_client_folders FOR ALL
  USING (has_role(auth.uid(), 'builder'::app_role) OR has_role(auth.uid(), 'employee'::app_role))
  WITH CHECK (has_role(auth.uid(), 'builder'::app_role) OR has_role(auth.uid(), 'employee'::app_role));
