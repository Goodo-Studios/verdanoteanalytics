-- pgTAP regression test for the 2026-05-26 sync outage.
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Pins the DB-level invariants that broke when 20260526000001 declared
-- claim_sync_continue's p_sync_id as uuid while sync_logs.id is bigint:
--   1. the bigint(text,text) overload exists,
--   2. the stale uuid(text,text) overload is gone (so PostgREST can't resolve
--      to the broken function), and
--   3. a continuation claim invoked with the real bigint id actually rotates
--      claim_id (i.e. the call no longer raises an invalid-uuid cast error).

BEGIN;
SELECT plan(3);

-- The correct, fixed signature must exist.
SELECT has_function(
  'public', 'claim_sync_continue', ARRAY['bigint', 'text', 'text'],
  'claim_sync_continue(bigint, text, text) exists'
);

-- The broken uuid overload must NOT exist (would otherwise still be resolvable).
SELECT hasnt_function(
  'public', 'claim_sync_continue', ARRAY['uuid', 'text', 'text'],
  'stale claim_sync_continue(uuid, text, text) overload is removed'
);

-- End-to-end: a running sync claimed by bigint id rotates its claim_id.
INSERT INTO sync_logs (account_id, sync_type, status, sync_state)
VALUES ('pgtap_test_acct', 'manual', 'running', '{"claim_id":"old-claim"}'::jsonb);

SELECT results_eq(
  $$ SELECT sync_state->>'claim_id'
       FROM claim_sync_continue(
         (SELECT id FROM sync_logs WHERE account_id = 'pgtap_test_acct'),
         'old-claim'::text,
         'new-claim'::text
       ) $$,
  $$ VALUES ('new-claim'::text) $$,
  'continuation claim with bigint id rotates claim_id to new-claim'
);

SELECT * FROM finish();
ROLLBACK;
