-- pgTAP regression test for audit item 8.4: a second run could take over a sync that was
-- still working.
--
-- claim_sync_continue let a fresh kick (p_old_claim NULL) take over a running sync after
-- 90 seconds without activity. A rate-limit wait inside one invocation can last up to the
-- 110-second phase budget without touching last_activity, so a healthy sync looked dead
-- and two runs worked the same sync at once. The window is now 180 seconds.
--
-- Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(3);

INSERT INTO sync_logs (account_id, sync_type, status, sync_state) VALUES
  ('pgtap_takeover_busy', 'manual', 'running',
   jsonb_build_object('claim_id', 'busy-claim', 'last_activity', (now() - interval '120 seconds')::text)),
  ('pgtap_takeover_dead', 'manual', 'running',
   jsonb_build_object('claim_id', 'dead-claim', 'last_activity', (now() - interval '200 seconds')::text));

SELECT is(
  (SELECT count(*)::int FROM claim_sync_continue(
     (SELECT id FROM sync_logs WHERE account_id = 'pgtap_takeover_busy'), NULL, 'intruder')),
  0,
  'a sync quiet for 120 seconds (inside one rate-limit wait) is not taken over'
);
SELECT is(
  (SELECT sync_state->>'claim_id' FROM sync_logs WHERE account_id = 'pgtap_takeover_busy'),
  'busy-claim',
  'the busy sync keeps its claim'
);
SELECT results_eq(
  $$ SELECT sync_state->>'claim_id' FROM claim_sync_continue(
       (SELECT id FROM sync_logs WHERE account_id = 'pgtap_takeover_dead'), NULL, 'rescuer') $$,
  $$ VALUES ('rescuer'::text) $$,
  'a sync quiet for 200 seconds is still recovered'
);

SELECT * FROM finish();
ROLLBACK;
