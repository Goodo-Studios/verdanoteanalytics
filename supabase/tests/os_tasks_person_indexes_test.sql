-- My work indexes (migration 20261122080001, OS-009).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: os_tasks has one index on each of the three person columns the My work page filters on.

BEGIN;
SELECT plan(3);

SELECT has_index('public', 'os_tasks', 'os_tasks_strategist_id_idx', ARRAY['strategist_id'], 'os_tasks has an index on strategist_id');
SELECT has_index('public', 'os_tasks', 'os_tasks_producer_id_idx', ARRAY['producer_id'], 'os_tasks has an index on producer_id');
SELECT has_index('public', 'os_tasks', 'os_tasks_editor_id_idx', ARRAY['editor_id'], 'os_tasks has an index on editor_id');

SELECT * FROM finish();
ROLLBACK;
