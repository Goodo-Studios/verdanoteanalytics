-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create a wrapper function that calls the refresh-thumbnails edge function
CREATE OR REPLACE FUNCTION public.trigger_media_refresh()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  supabase_url text;
  service_role_key text;
BEGIN
  -- Read from app.settings (set in Supabase dashboard under project settings)
  supabase_url := current_setting('app.supabase_url', true);
  service_role_key := current_setting('app.service_role_key', true);

  IF supabase_url IS NULL OR service_role_key IS NULL THEN
    RAISE WARNING 'trigger_media_refresh: app.supabase_url or app.service_role_key not set — skipping';
    RETURN;
  END IF;

  -- Skip if a refresh is already running (concurrency guard)
  IF EXISTS (
    SELECT 1 FROM public.media_refresh_logs
    WHERE status = 'running'
    LIMIT 1
  ) THEN
    RAISE NOTICE 'trigger_media_refresh: refresh already running — skipping';
    RETURN;
  END IF;

  -- Fire the edge function (non-blocking)
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/refresh-thumbnails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key
    ),
    body := '{}'::jsonb
  );

  RAISE NOTICE 'trigger_media_refresh: refresh-thumbnails invoked at %', now();
END;
$$;

-- Schedule to run every hour at :00
SELECT cron.schedule(
  'hourly-media-refresh',
  '0 * * * *',
  'SELECT public.trigger_media_refresh()'
);
