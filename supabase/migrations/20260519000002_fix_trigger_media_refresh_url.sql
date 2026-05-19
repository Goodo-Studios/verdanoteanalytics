-- Fix trigger_media_refresh: replace old hardcoded Supabase project URL
-- (vjjlulifovsdjwphmdsh) with the current project (gwyxaqoaldnaavkjqquv).
--
-- The anon key is read from public.settings at runtime (key = 'supabase_anon_key').
-- If that row is absent the function falls back to the new project URL but with an
-- empty key — the edge function call will fail with 401 rather than routing to the
-- wrong project.  Run the following once to seed the key:
--   INSERT INTO public.settings (key, value)
--   VALUES ('supabase_anon_key', '<new-project-anon-key>')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
CREATE OR REPLACE FUNCTION public.trigger_media_refresh()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  supabase_url text;
  anon_key     text;
BEGIN
  -- Read connection details from settings table so this survives future migrations.
  SELECT value INTO supabase_url FROM public.settings WHERE key = 'supabase_url';
  SELECT value INTO anon_key     FROM public.settings WHERE key = 'supabase_anon_key';

  -- Fall back to current project URL if not yet seeded in settings.
  IF supabase_url IS NULL OR supabase_url = '' THEN
    supabase_url := 'https://gwyxaqoaldnaavkjqquv.supabase.co';
  END IF;

  -- Fire the edge function (non-blocking).
  -- The edge function handles:
  --   1. Picking the most-stale account (single-account rotation)
  --   2. Skipping if that specific account is already refreshing
  --   3. Skipping if all accounts are within the cooldown window
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/refresh-thumbnails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(anon_key, '')
    ),
    body := '{}'::jsonb
  );

  RAISE NOTICE 'trigger_media_refresh: refresh-thumbnails rotation invoked at %', now();
END;
$$;
