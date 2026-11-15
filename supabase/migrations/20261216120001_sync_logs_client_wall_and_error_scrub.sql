-- Close the remaining Meta token exposure through sync_logs (audit plan item 0.1).
--
-- 1. Clients no longer read sync_logs at all. No client screen reads the table: the app's sync
--    history goes through the staff-only /sync/history function (service_role), and the only
--    direct read (DataHealthSection) is builder-only and selects account_id, status.
-- 2. api_errors is hidden from anon and authenticated, the same way 20261215140001 hid
--    sync_state. Deno fetch errors include the request URL, and Meta URLs carry access_token=.
--    sync now redacts error text before storing it (_shared/sync-errors.ts), but older rows may
--    still hold a token. service_role keeps full access.
-- 3. Existing rows are scrubbed: credential query parameters in api_errors, and any token left in
--    a saved *_cursor value in sync_state, are replaced with [REDACTED]. Cursors themselves are
--    kept so paused syncs can still resume (sync re-adds the current token when it resumes).
--
-- Production check on 2026-11-15 found one row (a September failed sync on a demo account) with
-- the live token in api_errors, readable only by staff.

DROP POLICY IF EXISTS "Client can view linked sync_logs" ON public.sync_logs;

REVOKE SELECT (api_errors) ON public.sync_logs FROM anon, authenticated;

UPDATE public.sync_logs
   SET api_errors = regexp_replace(
         api_errors,
         '((access_token|token|key|apikey|api_key|client_secret|fb_exchange_token)=)[^&#[:space:]"'']*',
         '\1[REDACTED]',
         'gi')
 WHERE api_errors ~* '(access_token|fb_exchange_token|client_secret)=[^[&#[:space:]"'']';

UPDATE public.sync_logs
   SET sync_state = regexp_replace(
         sync_state::text,
         '(access_token=)[^&#[:space:]"\\]*',
         '\1[REDACTED]',
         'gi')::jsonb
 WHERE sync_state::text ~* 'access_token=[^[&#[:space:]"\\]';
