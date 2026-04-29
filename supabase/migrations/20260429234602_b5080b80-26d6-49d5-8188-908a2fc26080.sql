ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS created_time timestamp with time zone;
CREATE INDEX IF NOT EXISTS idx_creatives_created_time ON public.creatives (created_time DESC);