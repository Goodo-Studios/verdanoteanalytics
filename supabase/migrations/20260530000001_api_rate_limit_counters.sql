-- US-007: Durable, cross-instance API rate limiting.
-- Replaces the in-memory per-instance Map limiter in the api edge function
-- with a Postgres-backed counter so limits hold across cold starts and instances.

CREATE TABLE IF NOT EXISTS api_rate_limit_counters (
  key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, window_start)
);

-- Lets a periodic cleanup prune old windows cheaply.
CREATE INDEX IF NOT EXISTS idx_api_rate_limit_counters_window
  ON api_rate_limit_counters (window_start);

ALTER TABLE api_rate_limit_counters ENABLE ROW LEVEL SECURITY;
-- No policies: only the SECURITY DEFINER function and service_role touch this table.

-- Atomic check-and-increment for a fixed window. Returns TRUE if the request is
-- allowed (count after increment <= limit), FALSE if the window is exhausted.
-- Window is bucketed deterministically so concurrent callers share the same row.
CREATE OR REPLACE FUNCTION check_api_rate_limit(
  p_key_id UUID,
  p_limit INTEGER DEFAULT 100,
  p_window_seconds INTEGER DEFAULT 60
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

  INSERT INTO api_rate_limit_counters (key_id, window_start, request_count)
  VALUES (p_key_id, v_window_start, 1)
  ON CONFLICT (key_id, window_start)
  DO UPDATE SET request_count = api_rate_limit_counters.request_count + 1
  RETURNING request_count INTO v_count;

  RETURN v_count <= p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION check_api_rate_limit(UUID, INTEGER, INTEGER) TO service_role;
