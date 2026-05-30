
-- Frame retention curves: add play_curve JSONB + per-quartile retention columns to creatives
-- play_curve is the first JSONB metrics column on public.creatives (intentional).
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS play_curve jsonb DEFAULT NULL;
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS retention_p25 numeric DEFAULT NULL;
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS retention_p50 numeric DEFAULT NULL;
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS retention_p75 numeric DEFAULT NULL;
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS retention_p100 numeric DEFAULT NULL;
