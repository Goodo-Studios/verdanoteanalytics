ALTER TABLE public.coda_tasks 
  ADD COLUMN IF NOT EXISTS stage text DEFAULT 'Planning',
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS content_type text,
  ADD COLUMN IF NOT EXISTS coda_url text;