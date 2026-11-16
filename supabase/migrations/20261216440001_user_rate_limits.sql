-- Audit 8.7: per-user rate limits for paid browser-called functions.
--
-- scrape-ad, vault-save, vault-frame-analyze and ai-chat call paid services (Apify, OpenRouter)
-- for any signed-in user with no per-user limit. check_api_rate_limit is keyed to api_keys, so it
-- cannot cover them. This adds a fixed-window counter per user and per bucket (function name).
-- Only the service role calls it, from _shared/user-rate-limit.ts.

CREATE TABLE IF NOT EXISTS public.user_rate_limit_counters (
  user_id UUID NOT NULL,
  bucket TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, bucket, window_start)
);

-- Lets a periodic cleanup prune old windows cheaply.
CREATE INDEX IF NOT EXISTS idx_user_rate_limit_counters_window
  ON public.user_rate_limit_counters (window_start);

ALTER TABLE public.user_rate_limit_counters ENABLE ROW LEVEL SECURITY;
-- No policies: only the SECURITY DEFINER function and service_role touch this table.
REVOKE ALL ON public.user_rate_limit_counters FROM PUBLIC, anon, authenticated;

-- Atomic check-and-increment for a fixed window. TRUE when this call is allowed (count after
-- the increment is at most the limit), FALSE when the window is used up.
CREATE OR REPLACE FUNCTION public.check_user_rate_limit(
  p_user_id UUID,
  p_bucket TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count INTEGER;
BEGIN
  v_window_start := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.user_rate_limit_counters (user_id, bucket, window_start, request_count)
  VALUES (p_user_id, p_bucket, v_window_start, 1)
  ON CONFLICT (user_id, bucket, window_start)
  DO UPDATE SET request_count = public.user_rate_limit_counters.request_count + 1
  RETURNING request_count INTO v_count;

  -- Old windows for this user and bucket are no longer read; drop them as we go.
  DELETE FROM public.user_rate_limit_counters
  WHERE user_id = p_user_id AND bucket = p_bucket AND window_start < v_window_start;

  RETURN v_count <= p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.check_user_rate_limit(UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_user_rate_limit(UUID, TEXT, INTEGER, INTEGER) TO service_role;
