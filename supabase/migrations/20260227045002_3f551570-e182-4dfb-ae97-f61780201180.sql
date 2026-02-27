
-- Update trigger_media_refresh to use hardcoded values instead of app.settings
CREATE OR REPLACE FUNCTION public.trigger_media_refresh()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  supabase_url text := 'https://vjjlulifovsdjwphmdsh.supabase.co';
  anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqamx1bGlmb3ZzZGp3cGhtZHNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4NTk0NTksImV4cCI6MjA4NjQzNTQ1OX0.z-tGPzV6p0IT2JpbQmz0ScNKqwOXj8jmFNOPC0kClpc';
BEGIN
  -- Skip if a refresh is already running
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
      'Authorization', 'Bearer ' || anon_key
    ),
    body := '{}'::jsonb
  );

  RAISE NOTICE 'trigger_media_refresh: refresh-thumbnails invoked at %', now();
END;
$$;
