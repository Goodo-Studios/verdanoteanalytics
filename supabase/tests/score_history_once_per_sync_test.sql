-- pgTAP regression test for audit item 8.4 part 2 (Phase 5 writes safe to run twice).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Sync Phase 5 inserts one score_history row per active creative. When the phase runs again
-- for the same sync (a takeover after a stalled heartbeat, or a continuation that re-enters
-- Phase 5), the plain insert wrote a second full set of snapshots. Each row now carries the
-- sync run's id, and (ad_id, sync_log_id) is unique, so the repeat write is skipped.

BEGIN;
SELECT plan(4);

SELECT has_column('public', 'score_history', 'sync_log_id', 'score_history records which sync run wrote it');

SELECT col_type_is('public', 'score_history', 'sync_log_id', 'bigint', 'sync_log_id matches sync_logs.id (bigint)');

-- The same sync run writing the same creative twice keeps one row.
INSERT INTO public.score_history (ad_id, account_id, score, sync_log_id)
VALUES ('pgtap_ad_1', 'pgtap_acct', 50, 9001)
ON CONFLICT (ad_id, sync_log_id) DO NOTHING;
INSERT INTO public.score_history (ad_id, account_id, score, sync_log_id)
VALUES ('pgtap_ad_1', 'pgtap_acct', 50, 9001)
ON CONFLICT (ad_id, sync_log_id) DO NOTHING;

-- A later sync run still records its own snapshot, and older rows without a run id stay valid.
INSERT INTO public.score_history (ad_id, account_id, score, sync_log_id)
VALUES ('pgtap_ad_1', 'pgtap_acct', 55, 9002)
ON CONFLICT (ad_id, sync_log_id) DO NOTHING;
INSERT INTO public.score_history (ad_id, account_id, score) VALUES ('pgtap_ad_1', 'pgtap_acct', 40);
INSERT INTO public.score_history (ad_id, account_id, score) VALUES ('pgtap_ad_1', 'pgtap_acct', 41);

SELECT is(
  (SELECT count(*)::int FROM public.score_history WHERE ad_id = 'pgtap_ad_1' AND sync_log_id = 9001),
  1,
  'a repeated write from the same sync run is skipped'
);

SELECT is(
  (SELECT count(*)::int FROM public.score_history WHERE ad_id = 'pgtap_ad_1'),
  4,
  'other runs and legacy rows without a run id are unaffected'
);

SELECT * FROM finish();
ROLLBACK;
