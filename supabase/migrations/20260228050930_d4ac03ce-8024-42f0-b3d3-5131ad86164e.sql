
ALTER TABLE public.account_context
ADD COLUMN IF NOT EXISTS transition_log jsonb NOT NULL DEFAULT '[]'::jsonb;
