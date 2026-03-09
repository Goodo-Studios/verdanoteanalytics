-- Fix the stuck sync #518 that's been "running" for 36+ hours
UPDATE sync_logs 
SET status = 'failed', 
    api_errors = '[{"timestamp":"2026-03-09T16:57:00Z","message":"Sync timed out — manually cleaned up after 36h stuck"}]'
WHERE id = 518 AND status = 'running';

-- Promote the oldest queued sync to running
UPDATE sync_logs 
SET status = 'running', 
    sync_state = jsonb_build_object('last_activity', now()::text)
WHERE id = (
  SELECT id FROM sync_logs WHERE status = 'queued' ORDER BY started_at ASC LIMIT 1
);