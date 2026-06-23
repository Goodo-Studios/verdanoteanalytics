-- Allow sync_type = 'scheduled' on sync_logs.
--
-- ROOT CAUSE (2026-06-23): the `scheduled-sync` cron inserts sync_logs rows with
-- sync_type = 'scheduled' (see scheduled-sync/index.ts -> POST /sync body), but the
-- sync_logs_sync_type_check constraint only permitted
-- ('initial','manual','bulk','daily'). Every automated sync therefore failed its
-- INSERT with a 23514 check-constraint violation. The /sync handler swallows the
-- insert error (`if (logError) continue;`) and, when no row is created, returns
-- HTTP 200 `{"message":"All requested accounts already syncing"}`. scheduled-sync
-- reads that 200 as success and advances next_sync_at to the next cadence slot —
-- so accounts looked "scheduled" while last_synced_at silently froze.
--
-- Net effect: scheduled syncing had been dead since 2026-06-09 (the last bulk
-- manual sync). Only hand-clicked syncs (sync_type='manual') ever wrote data,
-- because 'manual' passes the constraint.
--
-- Fix: widen the allowed set to include 'scheduled'. Additive and backward
-- compatible — no existing rows change.
ALTER TABLE public.sync_logs
  DROP CONSTRAINT IF EXISTS sync_logs_sync_type_check;

ALTER TABLE public.sync_logs
  ADD CONSTRAINT sync_logs_sync_type_check
  CHECK (sync_type = ANY (ARRAY['initial','manual','bulk','daily','scheduled']));

-- Verify:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conname = 'sync_logs_sync_type_check';
