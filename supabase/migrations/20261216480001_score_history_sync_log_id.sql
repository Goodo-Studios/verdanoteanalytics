-- Audit 8.4 part 2: sync Phase 5 score snapshots, once per sync run.
--
-- Phase 5 inserted one score_history row per active creative with a plain insert, so when the
-- phase ran again for the same sync (a takeover or a continuation) it wrote a second full set.
-- Each row now records the sync run that wrote it, and (ad_id, sync_log_id) is unique, so the
-- sync's upsert skips a repeat. Existing rows keep sync_log_id null; nulls are distinct, so
-- they never conflict.

ALTER TABLE public.score_history
  ADD COLUMN IF NOT EXISTS sync_log_id bigint;

CREATE UNIQUE INDEX IF NOT EXISTS score_history_ad_sync_log_key
  ON public.score_history (ad_id, sync_log_id);
